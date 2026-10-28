import assert from "node:assert/strict";
import { after, beforeEach, describe, mock, test } from "node:test";
import type { CreditType } from "@prisma/client";
import { CheckoutError } from "../orders.ts";
import { createProformaOrder, type ProformaFakturowniaClient } from "../proforma.ts";
import type { FakturowniaProformaInput } from "../../invoices/fakturownia.ts";
import { createOrg, createUser, resetDb, testPrisma } from "../../test-db/helpers.ts";

beforeEach(async () => {
  await resetDb();
});

after(async () => {
  await testPrisma.$disconnect();
});

type Calls = {
  created: FakturowniaProformaInput[];
  emails: Array<{ id: string; emailTo: string[]; emailCc: string[] }>;
};

function stubFakturownia(overrides: Partial<ProformaFakturowniaClient> = {}) {
  const calls: Calls = { created: [], emails: [] };
  const client: ProformaFakturowniaClient = {
    createProforma:
      overrides.createProforma ??
      (async (proforma) => {
        calls.created.push(proforma);
        return { id: "9001", number: "PRO/1/10/2026", token: "proforma-token" };
      }),
    sendInvoiceByEmail:
      overrides.sendInvoiceByEmail ??
      (async (id, recipients) => {
        calls.emails.push({ id, ...recipients });
      }),
  };
  return { client, calls };
}

async function createPackage(opts: { creditType: CreditType; credits: number; priceNetGrosze: number }) {
  return testPrisma.creditPackage.create({
    data: {
      name: `Pakiet ${opts.creditType} ${opts.credits}`,
      creditType: opts.creditType,
      credits: opts.credits,
      priceNetGrosze: opts.priceNetGrosze,
    },
  });
}

async function setup(opts: { billingMode?: "PREPAID" | "UNLIMITED" } = {}) {
  const org = await createOrg({ billingMode: opts.billingMode });
  const created = await createUser({ organizationId: org.id });
  const user = await testPrisma.user.findUniqueOrThrow({ where: { id: created.id } });
  const claims = await createPackage({ creditType: "CLAIM_DETAILS", credits: 10, priceNetGrosze: 5000 });
  const valuation = await createPackage({ creditType: "VALUATION", credits: 1, priceNetGrosze: 1000 });
  return { org, user, claims, valuation };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

function orderArgs(ctx: Ctx, client: ProformaFakturowniaClient, extra: { expectedTotalGrossGrosze?: number } = {}) {
  return {
    user: { id: ctx.user.id, email: ctx.user.email, organizationId: ctx.user.organizationId },
    items: [
      { packageId: ctx.claims.id, quantity: 1 },
      { packageId: ctx.valuation.id, quantity: 25 },
    ],
    fakturownia: client,
    departmentId: 77,
    // 22:30 UTC is 23:30 in Warsaw (CET) on the same day.
    clock: () => new Date("2026-10-30T22:30:00.000Z"),
    ...extra,
  };
}

async function silenced<T>(fn: () => Promise<T>) {
  const error = mock.method(console, "error", () => {});
  try {
    const result = await fn();
    return { result, errors: error.mock.calls.map((c) => c.arguments) };
  } finally {
    error.mock.restore();
  }
}

async function creditRows() {
  return {
    ledger: await testPrisma.creditLedgerEntry.count(),
    balances: await testPrisma.creditBalance.count(),
  };
}

describe("createProformaOrder", () => {
  test("success: pending PROFORMA order with the proforma recorded, due in 14 days, nothing booked", async () => {
    const ctx = await setup();
    const { client, calls } = stubFakturownia();

    const result = await createProformaOrder(testPrisma, orderArgs(ctx, client));

    // The clock is 2026-10-30 in Warsaw; +14 calendar days.
    assert.equal(result.proformaDueDate, "2026-11-13");
    assert.equal(result.proformaNumber, "PRO/1/10/2026");
    assert.equal(result.proformaToken, "proforma-token");
    assert.equal(result.emailed, true);

    const order = await testPrisma.order.findUniqueOrThrow({ where: { id: result.orderId }, include: { items: true } });
    assert.equal(order.status, "PENDING_PAYMENT");
    assert.equal(order.paymentMethod, "PROFORMA");
    assert.equal(order.invoiceStatus, "NOT_REQUIRED");
    assert.equal(order.paidAt, null);
    assert.equal(order.proformaFakturowniaId, "9001");
    assert.equal(order.proformaNumber, "PRO/1/10/2026");
    assert.equal(order.proformaToken, "proforma-token");
    assert.equal(order.proformaIssuedAt?.toISOString(), "2026-10-30T22:30:00.000Z");
    assert.equal(order.proformaDueDate?.toISOString().slice(0, 10), "2026-11-13");
    assert.ok(order.proformaEmailedAt);
    assert.equal(order.proformaLastError, null);
    assert.equal(order.items.length, 2);
    assert.deepEqual(await creditRows(), { ledger: 0, balances: 0 });

    assert.equal(calls.created.length, 1);
    assert.equal(calls.created[0].oid, `proforma-${order.id}`);
    assert.equal(calls.created[0].department_id, 77);
    assert.equal(calls.created[0].issue_date, "2026-10-30");
    assert.equal(calls.created[0].payment_to, "2026-11-13");
  });

  test("e-mail goes to the billing e-mail with the purchaser in cc", async () => {
    const ctx = await setup();
    const { client, calls } = stubFakturownia();

    await createProformaOrder(testPrisma, orderArgs(ctx, client));

    assert.deepEqual(calls.emails, [{ id: "9001", emailTo: ["test@example.com"], emailCc: [ctx.user.email] }]);
  });

  test("no cc when the purchaser is the billing e-mail (case-insensitive)", async () => {
    const ctx = await setup();
    const { client, calls } = stubFakturownia();

    await createProformaOrder(testPrisma, {
      ...orderArgs(ctx, client),
      user: { id: ctx.user.id, email: "Test@Example.com", organizationId: ctx.org.id },
    });

    assert.deepEqual(calls.emails[0].emailCc, []);
  });

  test("createProforma failure: order FAILED, 502, no credits", async () => {
    const ctx = await setup();
    const { client, calls } = stubFakturownia({
      createProforma: async () => {
        throw new Error("Fakturownia down");
      },
    });

    const { result, errors } = await silenced(() =>
      createProformaOrder(testPrisma, orderArgs(ctx, client)).then(
        () => null,
        (error: unknown) => error,
      ),
    );

    assert.ok(result instanceof CheckoutError);
    assert.equal(result.status, 502);
    assert.equal(result.message, "Nie udało się wystawić proformy. Spróbuj ponownie.");
    assert.ok(errors.some((args) => args[0] === "[PROFORMA_CREATE_ERROR]"));
    const orders = await testPrisma.order.findMany();
    assert.equal(orders.length, 1);
    assert.equal(orders[0].status, "FAILED");
    assert.equal(orders[0].proformaFakturowniaId, null);
    assert.deepEqual(await creditRows(), { ledger: 0, balances: 0 });
    assert.equal(calls.emails.length, 0);
  });

  test("failure to save the proforma: logged with id and number, order FAILED, 502", async () => {
    const ctx = await setup();
    const { client } = stubFakturownia();
    // A db whose order.update fails exactly for the write that stores the proforma.
    const order = new Proxy(testPrisma.order, {
      get(target, prop, receiver) {
        if (prop !== "update") return Reflect.get(target, prop, receiver);
        return (args: { data: Record<string, unknown> }) =>
          "proformaFakturowniaId" in args.data
            ? Promise.reject(new Error("db write failed"))
            : target.update(args as never);
      },
    });
    const failingDb = new Proxy(testPrisma, {
      get: (target, prop, receiver) => (prop === "order" ? order : Reflect.get(target, prop, receiver)),
    });

    const { result, errors } = await silenced(() =>
      createProformaOrder(failingDb, orderArgs(ctx, client)).then(
        () => null,
        (error: unknown) => error,
      ),
    );
    assert.ok(result instanceof CheckoutError);
    assert.equal(result.status, 502);
    const saveLog = errors.find((args) => args[0] === "[PROFORMA_SAVE_ERROR]");
    assert.ok(saveLog);
    assert.equal((saveLog[1] as { proformaId: string }).proformaId, "9001");
    assert.equal((saveLog[1] as { proformaNumber: string }).proformaNumber, "PRO/1/10/2026");

    const orders = await testPrisma.order.findMany();
    assert.equal(orders.length, 1);
    assert.equal(orders[0].status, "FAILED");
  });

  test("e-mail failure: order unchanged, proformaLastError set, emailed false", async () => {
    const ctx = await setup();
    const { client } = stubFakturownia({
      sendInvoiceByEmail: async () => {
        throw new Error("smtp refused");
      },
    });

    const { result, errors } = await silenced(() => createProformaOrder(testPrisma, orderArgs(ctx, client)));

    assert.equal(result.emailed, false);
    assert.ok(errors.some((args) => args[0] === "[PROFORMA_EMAIL_ERROR]"));
    const order = await testPrisma.order.findUniqueOrThrow({ where: { id: result.orderId } });
    assert.equal(order.status, "PENDING_PAYMENT");
    assert.equal(order.proformaNumber, "PRO/1/10/2026");
    assert.equal(order.proformaEmailedAt, null);
    assert.match(order.proformaLastError ?? "", /smtp refused/);
  });

  test("incomplete company data: same CheckoutError as PayU, nothing sent to Fakturownia", async () => {
    const ctx = await setup();
    await testPrisma.organization.update({ where: { id: ctx.org.id }, data: { street: " " } });
    const { client, calls } = stubFakturownia();

    await assert.rejects(createProformaOrder(testPrisma, orderArgs(ctx, client)), (error: unknown) => {
      assert.ok(error instanceof CheckoutError);
      assert.equal(error.status, 409);
      assert.match(error.message, /Uzupełnij dane firmy/);
      return true;
    });
    assert.equal(calls.created.length, 0);
    assert.equal(calls.emails.length, 0);
    assert.equal(await testPrisma.order.count(), 0);
  });

  test("UNLIMITED organization: refused, nothing sent to Fakturownia", async () => {
    const ctx = await setup({ billingMode: "UNLIMITED" });
    const { client, calls } = stubFakturownia();

    await assert.rejects(createProformaOrder(testPrisma, orderArgs(ctx, client)), (error: unknown) => {
      assert.ok(error instanceof CheckoutError);
      assert.equal(error.status, 409);
      assert.equal(error.message, "Twoja organizacja nie jest rozliczana kredytami.");
      return true;
    });
    assert.equal(calls.created.length, 0);
    assert.equal(await testPrisma.order.count(), 0);
  });

  test("expected total differs: 409, nothing sent to Fakturownia, no order", async () => {
    const ctx = await setup();
    const { client, calls } = stubFakturownia();

    await assert.rejects(
      createProformaOrder(testPrisma, orderArgs(ctx, client, { expectedTotalGrossGrosze: 1 })),
      (error: unknown) => {
        assert.ok(error instanceof CheckoutError);
        assert.equal(error.status, 409);
        assert.equal(error.message, "Ceny zostały zaktualizowane. Sprawdź podsumowanie i spróbuj ponownie.");
        return true;
      },
    );
    assert.equal(calls.created.length, 0);
    assert.equal(calls.emails.length, 0);
    assert.equal(await testPrisma.order.count(), 0);
  });

  test("matching expected total is accepted", async () => {
    const ctx = await setup();
    const { client } = stubFakturownia();
    // 6150 (claims, 50.00 net + 23%) + 25 * 1230 (valuations, 10.00 net + 23%).
    const expected = 6150 + 25 * 1230;
    const result = await createProformaOrder(testPrisma, orderArgs(ctx, client, { expectedTotalGrossGrosze: expected }));
    const order = await testPrisma.order.findUniqueOrThrow({ where: { id: result.orderId } });
    assert.equal(order.totalGrossGrosze, expected);
  });
});
