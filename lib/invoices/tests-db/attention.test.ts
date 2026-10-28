import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";
import type { InvoiceStatus, Prisma } from "@prisma/client";
import { buildAdminOrdersWhere, parseAdminOrderFilters } from "../../billing/admin-orders.ts";
import { getOrdersAttention, recordCronHeartbeat } from "../attention.ts";
import { ksefProblem } from "../ksef.ts";
import { createOrg, createUser, resetDb, testPrisma } from "../../test-db/helpers.ts";

beforeEach(async () => {
  await resetDb();
});

after(async () => {
  await testPrisma.$disconnect();
});

const HOUR = 60 * 60_000;
const now = new Date("2026-10-29T12:00:00.000Z");
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * HOUR);

async function createOrder(invoiceStatus: InvoiceStatus, extra: Partial<Prisma.OrderUncheckedCreateInput> = {}) {
  const org = await createOrg();
  const user = await createUser({ organizationId: org.id });
  return testPrisma.order.create({
    data: {
      organizationId: org.id,
      userId: user.id,
      status: "PAID",
      paymentMethod: "PAYU",
      totalNetGrosze: 2000,
      totalVatGrosze: 460,
      totalGrossGrosze: 2460,
      paidAt: now,
      invoiceStatus,
      ...extra,
    },
  });
}

let seq = 0;
const issued = (extra: Partial<Prisma.OrderUncheckedCreateInput>) =>
  createOrder("ISSUED", { fakturowniaInvoiceId: `INV-${++seq}`, invoiceNumber: `FV/${seq}`, invoiceToken: "t", ...extra });

async function seedKsefCases() {
  return {
    ok: await issued({ ksefStatus: "ok", invoiceIssuedAt: hoursAgo(100) }),
    demoOk: await issued({ ksefStatus: "demo_not_applicable", invoiceIssuedAt: hoursAgo(100) }),
    offline: await issued({ ksefStatus: "offline", invoiceIssuedAt: hoursAgo(100) }),
    sendError: await issued({ ksefStatus: "send_error", invoiceIssuedAt: hoursAgo(1) }),
    duplicate: await issued({ ksefStatus: "duplicate_error", invoiceIssuedAt: hoursAgo(100) }),
    demoError: await issued({ ksefStatus: "demo_server_error", invoiceIssuedAt: hoursAgo(1) }),
    staleNull: await issued({ ksefStatus: null, invoiceIssuedAt: hoursAgo(7) }),
    freshNull: await issued({ ksefStatus: null, invoiceIssuedAt: hoursAgo(5) }),
    staleProcessing: await issued({ ksefStatus: "processing", invoiceIssuedAt: hoursAgo(7) }),
    freshProcessing: await issued({ ksefStatus: "demo_processing", invoiceIssuedAt: hoursAgo(2) }),
    // Not tracked in KSeF: issued by hand, or not issued at all.
    manual: await createOrder("ISSUED", { ksefStatus: null, invoiceIssuedAt: hoursAgo(100), invoiceNumber: "FV/ręczna" }),
    failedWithJunk: await createOrder("FAILED", { ksefStatus: "send_error", invoiceNextAttemptAt: null }),
  };
}

describe("ksefProblem filter", () => {
  test("selects exactly the orders for which ksefProblem() is set", async () => {
    const cases = await seedKsefCases();
    const expected = [cases.sendError, cases.duplicate, cases.demoError, cases.staleNull, cases.staleProcessing].map((o) => o.id).sort();

    const rows = await testPrisma.order.findMany({
      where: buildAdminOrdersWhere(parseAdminOrderFilters(new URLSearchParams("ksefProblem=true")), now),
      select: { id: true },
    });
    assert.deepEqual(rows.map((r) => r.id).sort(), expected);

    // The pure function agrees with the query for every seeded order.
    for (const order of await testPrisma.order.findMany()) {
      assert.equal(ksefProblem(order, now) !== null, expected.includes(order.id), order.id);
    }
    assert.equal(ksefProblem(cases.sendError, now), "ERROR");
    assert.equal(ksefProblem(cases.staleNull, now), "STALE");
  });

  test("is combined with the other filters, never replacing them", async () => {
    const cases = await seedKsefCases();
    const where = (query: string) => buildAdminOrdersWhere(parseAdminOrderFilters(new URLSearchParams(query)), now);
    assert.equal(await testPrisma.order.count({ where: where("ksefProblem=true&invoiceStatus=FAILED") }), 0);
    assert.equal(await testPrisma.order.count({ where: where("ksefProblem=true&invoiceStatus=ISSUED") }), 5);
    assert.equal(await testPrisma.order.count({ where: where(`ksefProblem=true&organizationId=${cases.ok.organizationId}`) }), 0);
    assert.equal(await testPrisma.order.count({ where: where("ksefProblem=false") }), 12);
    assert.equal(await testPrisma.order.count({ where: where("") }), 12);
  });
});

describe("getOrdersAttention and the cron heartbeat", () => {
  test("counts the three kinds separately and reports the last cron run", async () => {
    await seedKsefCases();
    await createOrder("NEEDS_ATTENTION");
    await createOrder("NEEDS_ATTENTION");
    await createOrder("FAILED", { invoiceNextAttemptAt: null });
    await createOrder("FAILED", { invoiceNextAttemptAt: hoursAgo(-1) });
    await createOrder("PENDING", { invoiceNextAttemptAt: now });

    assert.deepEqual(await getOrdersAttention(testPrisma, now), {
      needsAttention: 2,
      // The FAILED order with a stale ksefStatus from seedKsefCases also has no next attempt.
      failedManualOnly: 2,
      ksefProblems: 5,
      // ok, demoOk and offline were issued 100 h ago and never e-mailed; duplicate is a KSeF problem, counted there.
      emailOverdue: 3,
      lastCronRunAt: null,
    });

    const ranAt = new Date("2026-10-29T11:55:00.000Z");
    await recordCronHeartbeat(
      testPrisma,
      { invoicesProcessed: 1, ksefRefreshed: 2, emailsSent: 3, ordersSynced: 4, budgetExhausted: false },
      ranAt,
    );
    assert.equal((await getOrdersAttention(testPrisma, now)).lastCronRunAt, ranAt.toISOString());
  });

  test("nothing to report on an empty database", async () => {
    assert.deepEqual(await getOrdersAttention(testPrisma, now), {
      needsAttention: 0,
      failedManualOnly: 0,
      ksefProblems: 0,
      emailOverdue: 0,
      lastCronRunAt: null,
    });
  });

  test("emailOverdue counts issued invoices not e-mailed 3 days after issuing", async () => {
    const MINUTE = 60_000;
    const threeDaysAgo = (offsetMinutes: number) => new Date(now.getTime() - 3 * 24 * HOUR - offsetMinutes * MINUTE);
    const base = { ksefStatus: "ok" };
    await issued({ ...base, invoiceIssuedAt: threeDaysAgo(1) }); // 3 days + 1 min: counted
    await issued({ ...base, invoiceIssuedAt: threeDaysAgo(-1) }); // 3 days - 1 min: not yet
    await issued({ ...base, invoiceIssuedAt: threeDaysAgo(1), invoiceEmailedAt: hoursAgo(1) }); // already sent
    await createOrder("ISSUED", { ...base, invoiceIssuedAt: threeDaysAgo(1), invoiceNumber: "FV/ręczna" }); // manual: no Fakturownia id
    await createOrder("FAILED", { fakturowniaInvoiceId: "INV-x", invoiceIssuedAt: threeDaysAgo(1), invoiceNextAttemptAt: hoursAgo(-1) });

    assert.equal((await getOrdersAttention(testPrisma, now)).emailOverdue, 1);
  });

  test("emailOverdue never counts an invoice that is already a KSeF problem", async () => {
    const old = hoursAgo(100);
    await issued({ ksefStatus: "ok", invoiceIssuedAt: old }); // overdue only
    await issued({ ksefStatus: "send_error", invoiceIssuedAt: old }); // KSeF error: counted as ksefProblems
    await issued({ ksefStatus: null, invoiceIssuedAt: old }); // KSeF stale: counted as ksefProblems

    const attention = await getOrdersAttention(testPrisma, now);
    assert.equal(attention.emailOverdue, 1);
    assert.equal(attention.ksefProblems, 2);
  });

  test("the emailOverdue list filter returns exactly the counted rows and combines with other filters", async () => {
    const old = hoursAgo(100);
    const overdue = await issued({ ksefStatus: "ok", invoiceIssuedAt: old });
    const overdueDemo = await issued({ ksefStatus: "demo_not_applicable", invoiceIssuedAt: old });
    await issued({ ksefStatus: "send_error", invoiceIssuedAt: old });
    await issued({ ksefStatus: "ok", invoiceIssuedAt: old, invoiceEmailedAt: hoursAgo(1) });
    await issued({ ksefStatus: "ok", invoiceIssuedAt: hoursAgo(1) });
    await createOrder("PENDING");

    const where = (query: string) => buildAdminOrdersWhere(parseAdminOrderFilters(new URLSearchParams(query)), now);
    const ids = async (query: string) =>
      (await testPrisma.order.findMany({ where: where(query), select: { id: true } })).map((r) => r.id).sort();

    assert.deepEqual(await ids("emailOverdue=true"), [overdue.id, overdueDemo.id].sort());
    assert.equal(await testPrisma.order.count({ where: where("emailOverdue=true") }), (await getOrdersAttention(testPrisma, now)).emailOverdue);
    assert.deepEqual(await ids(`emailOverdue=true&organizationId=${overdue.organizationId}`), [overdue.id]);
    assert.deepEqual(await ids("emailOverdue=true&invoiceStatus=FAILED"), []);
    assert.equal((await ids("emailOverdue=false")).length, 6);
  });
});
