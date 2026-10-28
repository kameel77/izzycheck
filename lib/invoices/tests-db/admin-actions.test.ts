import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, beforeEach, describe, test } from "node:test";
import type { InvoiceStatus, Prisma } from "@prisma/client";
import { markInvoiceEmailedManually, markInvoiceManual, retryInvoice } from "../admin-actions.ts";
import { processInvoice, type FakturowniaClientLike } from "../service.ts";
import { withAdminInvoice, withCustomerInvoice } from "../views.ts";
import { ADMIN_ORDER_SELECT, parseAdminOrderFilters } from "../../billing/admin-orders.ts";
import { createOrg, createUser, resetDb, testPrisma } from "../../test-db/helpers.ts";

beforeEach(async () => {
  await resetDb();
});

after(async () => {
  await testPrisma.$disconnect();
});

const MIN = 60_000;
const buildUrl = (token: string) => `https://shop.fakturownia.pl/invoice/${token}.pdf`;

async function createOrder(invoiceStatus: InvoiceStatus, extra: Partial<Prisma.OrderUncheckedCreateInput> = {}, orgId?: string) {
  const orgIdUsed = orgId ?? (await createOrg()).id;
  const user = await createUser({ organizationId: orgIdUsed });
  const pkg = await testPrisma.creditPackage.create({
    data: { name: "Pakiet wycen 10", creditType: "VALUATION", credits: 10, priceNetGrosze: 1000 },
  });
  return testPrisma.order.create({
    data: {
      organizationId: orgIdUsed,
      userId: user.id,
      status: "PAID",
      paymentMethod: "PAYU",
      totalNetGrosze: 2000,
      totalVatGrosze: 460,
      totalGrossGrosze: 2460,
      paidAt: new Date(),
      invoiceStatus,
      items: {
        create: [
          {
            packageId: pkg.id,
            packageName: "Pakiet wycen 10",
            creditType: "VALUATION",
            creditsPerPackage: 10,
            quantity: 2,
            unitNetGrosze: 1000,
            unitGrossGrosze: 1230,
            vatRate: 23,
            lineNetGrosze: 2000,
            lineVatGrosze: 460,
            lineGrossGrosze: 2460,
          },
        ],
      },
      ...extra,
    },
  });
}

const read = (id: string) => testPrisma.order.findUniqueOrThrow({ where: { id } });

const customerSelect = {
  invoiceStatus: true,
  invoiceNumber: true,
  invoiceToken: true,
  fakturowniaInvoiceId: true,
  ksefStatus: true,
  invoiceEmailedAt: true,
} as const;

describe("retryInvoice", () => {
  test("FAILED and NEEDS_ATTENTION go back to PENDING, due now, attempts reset, error cleared", async () => {
    const now = new Date();
    for (const status of ["FAILED", "NEEDS_ATTENTION"] as const) {
      const order = await createOrder(status, {
        invoiceAttempts: 10,
        invoiceLastError: "boom",
        invoiceNextAttemptAt: null,
        invoiceClaimedAt: null,
      });
      assert.deepEqual(await retryInvoice(testPrisma, order.id, now), { ok: true });
      const row = await read(order.id);
      assert.equal(row.invoiceStatus, "PENDING", status);
      assert.equal(row.invoiceNextAttemptAt?.getTime(), now.getTime(), status);
      assert.equal(row.invoiceAttempts, 0, status);
      assert.equal(row.invoiceLastError, null, status);
    }
  });

  test("an abandoned claim (older than 10 min) does not block a retry", async () => {
    const now = new Date();
    const order = await createOrder("FAILED", { invoiceClaimedAt: new Date(now.getTime() - 11 * MIN) });
    assert.deepEqual(await retryInvoice(testPrisma, order.id, now), { ok: true });
    assert.equal((await read(order.id)).invoiceStatus, "PENDING");
  });

  test("a live claim (younger than 10 min) is a 409 and changes nothing", async () => {
    const now = new Date();
    const order = await createOrder("NEEDS_ATTENTION", {
      invoiceClaimedAt: new Date(now.getTime() - 2 * MIN),
      invoiceAttempts: 3,
      invoiceLastError: "stary błąd",
    });
    const before = await read(order.id);
    assert.deepEqual(await retryInvoice(testPrisma, order.id, now), {
      ok: false,
      status: 409,
      error: "Faktura jest właśnie wystawiana — spróbuj za kilka minut.",
    });
    assert.deepEqual(await read(order.id), before);
  });

  test("any other status is a 409 and changes nothing", async () => {
    for (const status of ["NOT_REQUIRED", "PENDING", "ISSUING", "ISSUED"] as const) {
      const order = await createOrder(status);
      const before = await read(order.id);
      const result = await retryInvoice(testPrisma, order.id, new Date());
      assert.equal(result.ok, false, status);
      if (!result.ok) assert.equal(result.status, 409, status);
      assert.deepEqual(await read(order.id), before, status);
    }
  });

  test("an unknown order is a 404", async () => {
    const result = await retryInvoice(testPrisma, randomUUID(), new Date());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 404);
  });

  test("two parallel retries: exactly one wins", async () => {
    const order = await createOrder("FAILED");
    const results = await Promise.all([retryInvoice(testPrisma, order.id, new Date()), retryInvoice(testPrisma, order.id, new Date())]);
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(results.filter((r) => !r.ok).length, 1);
  });

  test("the retried order is issued by processInvoice", async () => {
    const order = await createOrder("FAILED", { invoiceAttempts: 10, invoiceLastError: "boom" });
    const now = new Date();
    assert.deepEqual(await retryInvoice(testPrisma, order.id, now), { ok: true });
    let created = 0;
    const client: FakturowniaClientLike = {
      createInvoice: async () => {
        created += 1;
        return { id: "INV-1", number: "FV/1/10/2026", token: "tok" };
      },
      sendInvoiceByEmail: async () => {},
      getInvoiceKsef: async () => ({ govStatus: null, govId: null, verificationLink: null, errors: [] }),
    };
    const outcome = await processInvoice(testPrisma, order.id, { client, clock: () => new Date(now.getTime() + 1000) });
    assert.equal(outcome, "ISSUED");
    assert.equal(created, 1);
    const row = await read(order.id);
    assert.equal(row.invoiceStatus, "ISSUED");
    assert.equal(row.invoiceAttempts, 1);
  });
});

describe("markInvoiceManual", () => {
  test("FAILED and NEEDS_ATTENTION become ISSUED with the number, without token or Fakturownia id", async () => {
    const now = new Date();
    for (const status of ["FAILED", "NEEDS_ATTENTION"] as const) {
      const order = await createOrder(status, {
        invoiceLastError: "boom",
        invoiceNextAttemptAt: new Date(now.getTime() + MIN),
        invoiceAttempts: 4,
      });
      assert.deepEqual(await markInvoiceManual(testPrisma, order.id, "FV/ręczna/7", now), { ok: true });
      const row = await read(order.id);
      assert.equal(row.invoiceStatus, "ISSUED", status);
      assert.equal(row.invoiceNumber, "FV/ręczna/7", status);
      assert.equal(row.invoiceIssuedAt?.getTime(), now.getTime(), status);
      assert.equal(row.invoiceToken, null, status);
      assert.equal(row.fakturowniaInvoiceId, null, status);
      assert.equal(row.invoiceLastError, null, status);
      assert.equal(row.invoiceNextAttemptAt, null, status);
      assert.equal(row.invoiceAttempts, 4, status);
    }
  });

  test("a customer sees a manual invoice's number without a link", async () => {
    const order = await createOrder("NEEDS_ATTENTION");
    await markInvoiceManual(testPrisma, order.id, "FV/ręczna/7", new Date());
    const row = await testPrisma.order.findUniqueOrThrow({ where: { id: order.id }, select: customerSelect });
    const view = withCustomerInvoice(row, buildUrl);
    assert.equal(view.invoiceStatus, "ISSUED");
    assert.equal(view.invoiceNumber, "FV/ręczna/7");
    assert.equal(view.invoicePdfUrl, null);
  });

  test("a live claim is a 409 and changes nothing", async () => {
    const now = new Date();
    const order = await createOrder("FAILED", { invoiceClaimedAt: new Date(now.getTime() - 2 * MIN) });
    const before = await read(order.id);
    assert.deepEqual(await markInvoiceManual(testPrisma, order.id, "FV/1", now), {
      ok: false,
      status: 409,
      error: "Faktura jest właśnie wystawiana — spróbuj za kilka minut.",
    });
    assert.deepEqual(await read(order.id), before);
  });

  test("any other status is a 409 and changes nothing (an issued invoice is never overwritten)", async () => {
    for (const status of ["NOT_REQUIRED", "PENDING", "ISSUING", "ISSUED"] as const) {
      const order = await createOrder(status, status === "ISSUED" ? { invoiceNumber: "FV/real", invoiceToken: "tok" } : {});
      const before = await read(order.id);
      const result = await markInvoiceManual(testPrisma, order.id, "FV/ręczna/7", new Date());
      assert.equal(result.ok, false, status);
      if (!result.ok) assert.equal(result.status, 409, status);
      assert.deepEqual(await read(order.id), before, status);
    }
  });

  test("an unknown order is a 404", async () => {
    const result = await markInvoiceManual(testPrisma, randomUUID(), "FV/1", new Date());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 404);
  });
});

describe("invoice exposure over the API views", () => {
  test("customer: ISSUED with a token gets number and link; NEEDS_ATTENTION gets neither", async () => {
    const issued = await createOrder("ISSUED", {
      invoiceNumber: "FV/1/10/2026",
      invoiceToken: "tok-1",
      fakturowniaInvoiceId: "INV-1",
      ksefStatus: "ok",
    });
    const attention = await createOrder("NEEDS_ATTENTION", { invoiceNumber: "FV/leak", invoiceToken: "tok-leak", invoiceLastError: "x" });
    const issuedView = withCustomerInvoice(
      await testPrisma.order.findUniqueOrThrow({ where: { id: issued.id }, select: customerSelect }),
      buildUrl,
    );
    assert.deepEqual(issuedView, {
      invoiceStatus: "ISSUED",
      invoiceNumber: "FV/1/10/2026",
      invoicePdfUrl: "https://shop.fakturownia.pl/invoice/tok-1.pdf",
    });
    const attentionView = withCustomerInvoice(
      await testPrisma.order.findUniqueOrThrow({ where: { id: attention.id }, select: customerSelect }),
      buildUrl,
    );
    assert.deepEqual(attentionView, { invoiceStatus: "PENDING", invoiceNumber: null, invoicePdfUrl: null });
    assert.ok(!("invoiceToken" in issuedView) && !("invoiceToken" in attentionView));
    assert.ok(!JSON.stringify(attentionView).includes("tok-leak") && !JSON.stringify(attentionView).includes("FV/leak"));
  });

  test("admin list: filters, newest first, organization and sandbox flag, no raw token", async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    const older = await createOrder("FAILED", { invoiceLastError: "boom", invoiceAttempts: 2, createdAt: new Date(Date.now() - 5 * MIN) }, orgA.id);
    const newer = await createOrder(
      "ISSUED",
      { invoiceNumber: "FV/2", invoiceToken: "tok-2", fakturowniaInvoiceId: "INV-2", payuSandbox: true, ksefStatus: "ok", ksefId: "K-1" },
      orgA.id,
    );
    await createOrder("ISSUED", { invoiceNumber: "FV/3", fakturowniaInvoiceId: "INV-3" }, orgB.id);

    const list = async (query: string) =>
      (
        await testPrisma.order.findMany({
          where: parseAdminOrderFilters(new URLSearchParams(query)),
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: ADMIN_ORDER_SELECT,
        })
      ).map((row) => withAdminInvoice(row, buildUrl));

    const forOrgA = await list(`organizationId=${orgA.id}`);
    assert.deepEqual(forOrgA.map((o) => o.id), [newer.id, older.id]);
    assert.equal(forOrgA[0].organization.id, orgA.id);
    assert.equal(forOrgA[0].payuSandbox, true);
    assert.equal(forOrgA[0].invoicePdfUrl, "https://shop.fakturownia.pl/invoice/tok-2.pdf");
    assert.equal(forOrgA[0].ksefId, "K-1");
    assert.equal(forOrgA[1].invoiceLastError, "boom");
    assert.equal(forOrgA[1].invoiceAttempts, 2);
    assert.ok(forOrgA.every((o) => !("invoiceToken" in o)));

    assert.deepEqual((await list(`invoiceStatus=FAILED`)).map((o) => o.id), [older.id]);
    assert.equal((await list("")).length, 3);
    assert.equal((await list("status=PENDING_PAYMENT")).length, 0);
    assert.equal((await list("invoiceStatus=bogus")).length, 3);
  });
});

describe("markInvoiceEmailedManually", () => {
  const ALREADY = "E-mail z tą fakturą jest już oznaczony jako wysłany albo faktura nie jest wystawiona.";

  test("an ISSUED invoice that was not e-mailed gets invoiceEmailedAt and nothing else changes", async () => {
    const now = new Date("2026-10-30T10:00:00.000Z");
    const order = await createOrder("ISSUED", {
      invoiceNumber: "FV/1",
      fakturowniaInvoiceId: "INV-1",
      invoiceToken: "tok",
      invoiceLastError: "Dodatkowa faktura: uwaga",
    });

    assert.deepEqual(await markInvoiceEmailedManually(testPrisma, order.id, now), { ok: true });

    const after = await read(order.id);
    assert.equal(after.invoiceEmailedAt?.toISOString(), now.toISOString());
    assert.equal(after.invoiceStatus, "ISSUED");
    assert.equal(after.invoiceNumber, "FV/1");
    assert.equal(after.invoiceLastError, "Dodatkowa faktura: uwaga");
  });

  test("works for a manually issued invoice (no Fakturownia id)", async () => {
    const order = await createOrder("ISSUED", { invoiceNumber: "FV/ręczna" });
    assert.deepEqual(await markInvoiceEmailedManually(testPrisma, order.id, new Date()), { ok: true });
    assert.notEqual((await read(order.id)).invoiceEmailedAt, null);
  });

  test("an already e-mailed invoice is 409 and the timestamp is not overwritten", async () => {
    const sentAt = new Date("2026-10-27T08:00:00.000Z");
    const order = await createOrder("ISSUED", { fakturowniaInvoiceId: "INV-2", invoiceEmailedAt: sentAt });

    const result = await markInvoiceEmailedManually(testPrisma, order.id, new Date("2026-10-30T10:00:00.000Z"));

    assert.deepEqual(result, { ok: false, status: 409, error: ALREADY });
    assert.equal((await read(order.id)).invoiceEmailedAt?.toISOString(), sentAt.toISOString());
  });

  test("an invoice that is not ISSUED is 409 and untouched", async () => {
    for (const status of ["PENDING", "FAILED", "NEEDS_ATTENTION", "NOT_REQUIRED"] as const) {
      const order = await createOrder(status);
      const result = await markInvoiceEmailedManually(testPrisma, order.id, new Date());
      assert.deepEqual(result, { ok: false, status: 409, error: ALREADY }, status);
      assert.equal((await read(order.id)).invoiceEmailedAt, null, status);
    }
  });

  test("an unknown order is 404", async () => {
    assert.deepEqual(await markInvoiceEmailedManually(testPrisma, randomUUID(), new Date()), {
      ok: false,
      status: 404,
      error: "Nie znaleziono zamówienia.",
    });
  });
});
