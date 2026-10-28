import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";
import type { InvoiceStatus, Prisma } from "@prisma/client";
import { buildAdminOrdersWhere, parseAdminOrderFilters } from "../../billing/admin-orders.ts";
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
