import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, beforeEach, describe, test } from "node:test";
import type { OrderStatus, Prisma } from "@prisma/client";
import { cancelProformaOrder, markProformaPaid } from "../proforma.ts";
import { createOrg, createUser, resetDb, testPrisma } from "../../test-db/helpers.ts";

beforeEach(async () => {
  await resetDb();
});

after(async () => {
  await testPrisma.$disconnect();
});

// Warsaw is on CEST (UTC+2) at CREATED_AT and on CET (UTC+1) at NOW (DST ended on 2026-10-25).
const CREATED_AT = new Date("2026-10-20T10:00:00.000Z");
const NOW = new Date("2026-10-30T10:00:00.000Z");

async function setup() {
  const org = await createOrg();
  const user = await createUser({ organizationId: org.id });
  return { org, user };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

async function createProforma(
  ctx: Ctx,
  extra: Partial<Prisma.OrderUncheckedCreateInput> & { withItems?: boolean } = {},
) {
  const { withItems = true, ...rest } = extra;
  const claims = await testPrisma.creditPackage.create({
    data: { name: "Pakiet szkód", creditType: "CLAIM_DETAILS", credits: 10, priceNetGrosze: 5000 },
  });
  const valuation = await testPrisma.creditPackage.create({
    data: { name: "Pakiet wycen", creditType: "VALUATION", credits: 1, priceNetGrosze: 1000 },
  });
  const line = (pkg: { id: string; name: string }, creditType: "CLAIM_DETAILS" | "VALUATION", per: number, quantity: number) => ({
    packageId: pkg.id,
    packageName: pkg.name,
    creditType,
    creditsPerPackage: per,
    quantity,
    unitNetGrosze: 1000,
    unitGrossGrosze: 1230,
    vatRate: 23,
    lineNetGrosze: 1000 * quantity,
    lineVatGrosze: 230 * quantity,
    lineGrossGrosze: 1230 * quantity,
  });
  return testPrisma.order.create({
    data: {
      organizationId: ctx.org.id,
      userId: ctx.user.id,
      status: "PENDING_PAYMENT",
      paymentMethod: "PROFORMA",
      totalNetGrosze: 3000,
      totalVatGrosze: 690,
      totalGrossGrosze: 3690,
      createdAt: CREATED_AT,
      proformaFakturowniaId: `PF-${randomUUID()}`,
      proformaNumber: "PRO/7/10/2026",
      proformaToken: "tok",
      proformaIssuedAt: CREATED_AT,
      proformaDueDate: new Date("2026-11-03T00:00:00.000Z"),
      ...(withItems ? { items: { create: [line(claims, "CLAIM_DETAILS", 10, 1), line(valuation, "VALUATION", 5, 2)] } } : {}),
      ...rest,
    },
  });
}

const read = (id: string) => testPrisma.order.findUniqueOrThrow({ where: { id } });

async function creditState(organizationId: string) {
  // Sorted by name here: Postgres would order the enum by its declaration order.
  const byType = (a: { creditType: string }, b: { creditType: string }) => (a.creditType < b.creditType ? -1 : 1);
  const balances = (await testPrisma.creditBalance.findMany({ where: { organizationId } })).sort(byType);
  const ledger = (await testPrisma.creditLedgerEntry.findMany({ where: { organizationId } })).sort(byType);
  return { balances, ledger };
}

const mark = (orderId: string, paidDate = "2026-10-28", note: string | null = null) =>
  markProformaPaid(testPrisma, { orderId, paidDate, note, now: NOW });

describe("markProformaPaid", () => {
  test("PAID, credits of both types, invoice PENDING, paidAt at 12:00 UTC of the given date", async () => {
    const ctx = await setup();
    const order = await createProforma(ctx);

    assert.deepEqual(await mark(order.id, "2026-10-28", "przelew z 28.10"), { ok: true });

    const row = await read(order.id);
    assert.equal(row.status, "PAID");
    assert.equal(row.paidAt?.toISOString(), "2026-10-28T12:00:00.000Z");
    assert.equal(row.paymentNote, "przelew z 28.10");
    assert.equal(row.invoiceStatus, "PENDING");
    assert.equal(row.invoiceNextAttemptAt?.toISOString(), NOW.toISOString());

    const { balances, ledger } = await creditState(ctx.org.id);
    assert.deepEqual(
      balances.map((b) => [b.creditType, b.balance]),
      [
        ["CLAIM_DETAILS", 10],
        ["VALUATION", 10],
      ],
    );
    assert.deepEqual(
      ledger.map((e) => [e.creditType, e.amount, e.type, e.idempotencyKey, e.orderId, e.userId, e.note]),
      [
        ["CLAIM_DETAILS", 10, "PURCHASE", `purchase:${order.id}:CLAIM_DETAILS`, order.id, ctx.user.id, "Zakup: proforma PRO/7/10/2026 (przelew)"],
        ["VALUATION", 10, "PURCHASE", `purchase:${order.id}:VALUATION`, order.id, ctx.user.id, "Zakup: proforma PRO/7/10/2026 (przelew)"],
      ],
    );
  });

  test("a second marking is refused with 409 and changes nothing", async () => {
    const ctx = await setup();
    const order = await createProforma(ctx);
    await mark(order.id);
    const before = await creditState(ctx.org.id);

    const second = await mark(order.id, "2026-10-29", "drugi raz");

    assert.deepEqual(second, { ok: false, status: 409, error: "Zamówienie jest już opłacone albo nie można go oznaczyć." });
    assert.deepEqual(await creditState(ctx.org.id), before);
    const row = await read(order.id);
    assert.equal(row.paidAt?.toISOString(), "2026-10-28T12:00:00.000Z");
    assert.equal(row.paymentNote, null);
  });

  test("two parallel markings: exactly one succeeds and the credits are booked once", async () => {
    const ctx = await setup();
    const order = await createProforma(ctx);

    const results = await Promise.all([mark(order.id, "2026-10-28", "a"), mark(order.id, "2026-10-28", "b")]);

    assert.equal(results.filter((r) => r.ok).length, 1);
    const loser = results.find((r) => !r.ok);
    assert.ok(loser && !loser.ok);
    assert.equal(loser.status, 409);

    const { balances, ledger } = await creditState(ctx.org.id);
    assert.deepEqual(
      balances.map((b) => [b.creditType, b.balance]),
      [
        ["CLAIM_DETAILS", 10],
        ["VALUATION", 10],
      ],
    );
    assert.equal(ledger.length, 2);
    assert.equal((await read(order.id)).status, "PAID");
  });

  test("a PayU order is refused: nothing booked", async () => {
    const ctx = await setup();
    const order = await createProforma(ctx, { paymentMethod: "PAYU", payuOrderId: "PAYU-1" });

    const result = await mark(order.id);

    assert.deepEqual(result, { ok: false, status: 409, error: "Tę akcję można wykonać tylko dla zamówienia z wystawioną proformą." });
    assert.equal((await read(order.id)).status, "PENDING_PAYMENT");
    assert.deepEqual(await creditState(ctx.org.id), { balances: [], ledger: [] });
  });

  test("a FAILED proforma without a proforma in Fakturownia is refused", async () => {
    const ctx = await setup();
    const order = await createProforma(ctx, {
      status: "FAILED",
      proformaFakturowniaId: null,
      proformaNumber: null,
      proformaToken: null,
    });

    const result = await mark(order.id);

    assert.deepEqual(result, { ok: false, status: 409, error: "Tę akcję można wykonać tylko dla zamówienia z wystawioną proformą." });
    assert.equal((await read(order.id)).status, "FAILED");
    assert.deepEqual(await creditState(ctx.org.id), { balances: [], ledger: [] });
  });

  test("a FAILED order that does have a proforma id is still refused by the status guard", async () => {
    const ctx = await setup();
    const order = await createProforma(ctx, { status: "FAILED" });

    const result = await mark(order.id);

    assert.deepEqual(result, { ok: false, status: 409, error: "Zamówienie jest już opłacone albo nie można go oznaczyć." });
    assert.equal((await read(order.id)).status, "FAILED");
    assert.deepEqual(await creditState(ctx.org.id), { balances: [], ledger: [] });
  });

  test("a CANCELED proforma order can be marked paid (the transfer came in anyway)", async () => {
    const ctx = await setup();
    const order = await createProforma(ctx, { status: "CANCELED" });

    assert.deepEqual(await mark(order.id), { ok: true });

    assert.equal((await read(order.id)).status, "PAID");
    assert.equal((await creditState(ctx.org.id)).ledger.length, 2);
  });

  test("an expired proforma (due date in the past) can be marked paid", async () => {
    const ctx = await setup();
    const order = await createProforma(ctx, { proformaDueDate: new Date("2026-10-25T00:00:00.000Z") });

    assert.deepEqual(await mark(order.id), { ok: true });

    assert.equal((await read(order.id)).status, "PAID");
  });

  test("paidDate tomorrow (Warsaw) is refused with 400", async () => {
    const ctx = await setup();
    const order = await createProforma(ctx);

    const result = await mark(order.id, "2026-10-31");

    assert.deepEqual(result, { ok: false, status: 400, error: "Data wpłaty nie może być w przyszłości ani przed datą zamówienia." });
    assert.equal((await read(order.id)).status, "PENDING_PAYMENT");
    assert.deepEqual(await creditState(ctx.org.id), { balances: [], ledger: [] });
  });

  test("paidDate today and on the order's creation day are accepted", async () => {
    const ctx = await setup();
    const today = await createProforma(ctx);
    const creationDay = await createProforma(ctx);

    assert.deepEqual(await mark(today.id, "2026-10-30"), { ok: true });
    assert.deepEqual(await mark(creationDay.id, "2026-10-20"), { ok: true });
  });

  test("paidDate before the order's creation day is refused with 400", async () => {
    const ctx = await setup();
    const order = await createProforma(ctx);

    const result = await mark(order.id, "2026-10-19");

    assert.deepEqual(result, { ok: false, status: 400, error: "Data wpłaty nie może być w przyszłości ani przed datą zamówienia." });
    assert.equal((await read(order.id)).status, "PENDING_PAYMENT");
  });

  test("bounds use the Warsaw calendar day, not UTC", async () => {
    const ctx = await setup();
    // 22:30 UTC on the 19th is already the 20th in Warsaw.
    const lateEvening = await createProforma(ctx, { createdAt: new Date("2026-10-19T22:30:00.000Z") });

    assert.deepEqual(await mark(lateEvening.id, "2026-10-19"), {
      ok: false,
      status: 400,
      error: "Data wpłaty nie może być w przyszłości ani przed datą zamówienia.",
    });
    assert.deepEqual(await mark(lateEvening.id, "2026-10-20"), { ok: true });

    // 23:30 UTC "now" is already the next Warsaw day (CET), so that day is not the future.
    const later = await createProforma(ctx);
    const result = await markProformaPaid(testPrisma, {
      orderId: later.id,
      paidDate: "2026-10-31",
      note: null,
      now: new Date("2026-10-30T23:30:00.000Z"),
    });
    assert.deepEqual(result, { ok: true });
  });

  test("an invalid calendar date is refused with 400", async () => {
    const ctx = await setup();
    const order = await createProforma(ctx);

    for (const paidDate of ["2026-02-30", "not-a-date", ""]) {
      assert.deepEqual(await mark(order.id, paidDate), { ok: false, status: 400, error: "Nieprawidłowa data wpłaty." }, paidDate);
    }
    assert.equal((await read(order.id)).status, "PENDING_PAYMENT");
  });

  test("an unknown order is 404", async () => {
    assert.deepEqual(await mark(randomUUID()), { ok: false, status: 404, error: "Nie znaleziono zamówienia." });
  });

  test("a failure while booking credits rolls the whole marking back", async () => {
    const ctx = await setup();
    // No lines: bookOrderCredits throws after the status was already changed inside the transaction.
    const order = await createProforma(ctx, { withItems: false });

    await assert.rejects(mark(order.id));

    const row = await read(order.id);
    assert.equal(row.status, "PENDING_PAYMENT");
    assert.equal(row.paidAt, null);
    assert.equal(row.invoiceStatus, "NOT_REQUIRED");
    assert.deepEqual(await creditState(ctx.org.id), { balances: [], ledger: [] });
  });
});

describe("cancelProformaOrder", () => {
  test("PENDING_PAYMENT becomes CANCELED, the second cancel is 409", async () => {
    const ctx = await setup();
    const order = await createProforma(ctx);

    assert.deepEqual(await cancelProformaOrder(testPrisma, order.id, NOW), { ok: true });
    assert.equal((await read(order.id)).status, "CANCELED");

    const second = await cancelProformaOrder(testPrisma, order.id, NOW);
    assert.deepEqual(second, { ok: false, status: 409, error: "Anulować można tylko proformę oczekującą na wpłatę." });
  });

  test("a PAID order is refused and stays paid", async () => {
    const ctx = await setup();
    const order = await createProforma(ctx);
    await mark(order.id);

    const result = await cancelProformaOrder(testPrisma, order.id, NOW);

    assert.deepEqual(result, { ok: false, status: 409, error: "Anulować można tylko proformę oczekującą na wpłatę." });
    assert.equal((await read(order.id)).status, "PAID");
  });

  test("a pending PayU order is refused", async () => {
    const ctx = await setup();
    const order = await createProforma(ctx, { paymentMethod: "PAYU", payuOrderId: "PAYU-2" });

    const result = await cancelProformaOrder(testPrisma, order.id, NOW);

    assert.deepEqual(result, { ok: false, status: 409, error: "Anulować można tylko proformę oczekującą na wpłatę." });
    assert.equal((await read(order.id)).status, "PENDING_PAYMENT" satisfies OrderStatus);
  });

  test("a proforma still being created (no Fakturownia id, 1 minute old) cannot be canceled", async () => {
    const ctx = await setup();
    const order = await createProforma(ctx, {
      proformaFakturowniaId: null,
      proformaNumber: null,
      proformaToken: null,
      createdAt: new Date(NOW.getTime() - 60_000),
    });

    const result = await cancelProformaOrder(testPrisma, order.id, NOW);

    assert.deepEqual(result, { ok: false, status: 409, error: "Anulować można tylko proformę oczekującą na wpłatę." });
    assert.equal((await read(order.id)).status, "PENDING_PAYMENT" satisfies OrderStatus);
  });

  test("a stuck proforma (no Fakturownia id, 11 minutes old) can be canceled", async () => {
    const ctx = await setup();
    const order = await createProforma(ctx, {
      proformaFakturowniaId: null,
      proformaNumber: null,
      proformaToken: null,
      createdAt: new Date(NOW.getTime() - 11 * 60_000),
    });

    assert.deepEqual(await cancelProformaOrder(testPrisma, order.id, NOW), { ok: true });
    assert.equal((await read(order.id)).status, "CANCELED" satisfies OrderStatus);
  });

  test("the stuck-order boundary is 10 minutes, and a stuck PayU or FAILED order is still refused", async () => {
    const ctx = await setup();
    const at = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
    const noProforma = { proformaFakturowniaId: null, proformaNumber: null, proformaToken: null };

    const justUnder = await createProforma(ctx, { ...noProforma, createdAt: at(9.9) });
    assert.equal((await cancelProformaOrder(testPrisma, justUnder.id, NOW)).ok, false);

    const justOver = await createProforma(ctx, { ...noProforma, createdAt: at(10.1) });
    assert.deepEqual(await cancelProformaOrder(testPrisma, justOver.id, NOW), { ok: true });

    const payu = await createProforma(ctx, { ...noProforma, paymentMethod: "PAYU", payuOrderId: "PAYU-3", createdAt: at(60) });
    assert.equal((await cancelProformaOrder(testPrisma, payu.id, NOW)).ok, false);
    assert.equal((await read(payu.id)).status, "PENDING_PAYMENT" satisfies OrderStatus);

    const failed = await createProforma(ctx, { ...noProforma, status: "FAILED", createdAt: at(60) });
    assert.equal((await cancelProformaOrder(testPrisma, failed.id, NOW)).ok, false);
    assert.equal((await read(failed.id)).status, "FAILED" satisfies OrderStatus);
  });

  test("an unknown order is 404", async () => {
    assert.deepEqual(await cancelProformaOrder(testPrisma, randomUUID(), NOW), { ok: false, status: 404, error: "Nie znaleziono zamówienia." });
  });
});
