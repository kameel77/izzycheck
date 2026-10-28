import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, beforeEach, describe, mock, test } from "node:test";
import type { CreditType, PrismaClient } from "@prisma/client";
import {
  applyPayuStatus,
  CheckoutError,
  createCheckout,
  handlePayuNotification,
  syncOrderWithPayu,
  type PayuClientLike,
} from "../orders.ts";
import { priceCart } from "../pricing.ts";
import type { CreateOrderInput } from "../../payments/payu.ts";
import { PayuError } from "../../payments/payu.ts";
import { createOrg, createUser, resetDb, setBalance, testPrisma } from "../../test-db/helpers.ts";

const SECOND_KEY = "test-second-key";
const APP_URL = "https://app.example.test";

beforeEach(async () => {
  await resetDb();
});

after(async () => {
  await testPrisma.$disconnect();
});

type Stub = PayuClientLike & { created: CreateOrderInput[]; fetched: string[] };

function stubPayu(opts: {
  createOrder?: PayuClientLike["createOrder"];
  getOrder?: PayuClientLike["getOrder"];
} = {}): Stub {
  const created: CreateOrderInput[] = [];
  const fetched: string[] = [];
  return {
    created,
    fetched,
    createOrder:
      opts.createOrder ??
      (async (input) => {
        created.push(input);
        return { payuOrderId: `PAYU-${randomUUID()}`, redirectUri: "https://pay.example.test/redirect" };
      }),
    getOrder:
      opts.getOrder ??
      (async (id) => {
        fetched.push(id);
        throw new Error("getOrder not stubbed");
      }),
  };
}

async function readBalance(organizationId: string, creditType: CreditType): Promise<number> {
  const row = await testPrisma.creditBalance.findUnique({
    where: { organizationId_creditType: { organizationId, creditType } },
  });
  return row?.balance ?? 0;
}

async function createPackage(opts: {
  creditType: CreditType;
  credits: number;
  priceNetGrosze: number;
  isActive?: boolean;
  name?: string;
}) {
  return testPrisma.creditPackage.create({
    data: {
      name: opts.name ?? `Pakiet ${opts.creditType} ${opts.credits}`,
      creditType: opts.creditType,
      credits: opts.credits,
      priceNetGrosze: opts.priceNetGrosze,
      isActive: opts.isActive ?? true,
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

function checkoutArgs(ctx: Ctx, payu: PayuClientLike, items?: Array<{ packageId: string; quantity: number }>) {
  return {
    user: {
      id: ctx.user.id,
      email: ctx.user.email,
      name: "Jan Kowalski Nowak",
      organizationId: ctx.user.organizationId,
    },
    items: items ?? [
      { packageId: ctx.claims.id, quantity: 1 },
      { packageId: ctx.valuation.id, quantity: 25 },
    ],
    customerIp: "203.0.113.5",
    payu,
    appUrl: APP_URL,
    sandbox: false,
  };
}

async function placeOrder(ctx: Ctx) {
  const payu = stubPayu();
  const { orderId } = await createCheckout(testPrisma, checkoutArgs(ctx, payu));
  const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId } });
  return order;
}

function completed(order: { id: string; totalGrossGrosze: number; payuOrderId: string | null }, overrides = {}) {
  return {
    orderId: order.id,
    payuOrderId: order.payuOrderId ?? undefined,
    status: "COMPLETED",
    totalAmount: order.totalGrossGrosze,
    currencyCode: "PLN",
    ...overrides,
  };
}

/** Captures console.error / console.warn calls made while fn runs. */
async function captureConsole<T>(fn: () => Promise<T>) {
  const error = mock.method(console, "error", () => {});
  const warn = mock.method(console, "warn", () => {});
  try {
    const result = await fn();
    return {
      result,
      errors: error.mock.calls.map((c) => c.arguments),
      warns: warn.mock.calls.map((c) => c.arguments),
    };
  } finally {
    error.mock.restore();
    warn.mock.restore();
  }
}

async function expectCheckoutError(promise: Promise<unknown>, status: number, message: string) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof CheckoutError);
    assert.equal(err.status, status);
    assert.equal(err.message, message);
    return true;
  });
}

describe("createCheckout", () => {
  test("UNLIMITED organization is rejected with 409", async () => {
    const ctx = await setup({ billingMode: "UNLIMITED" });
    const payu = stubPayu();
    await expectCheckoutError(
      createCheckout(testPrisma, checkoutArgs(ctx, payu)),
      409,
      "Twoja organizacja nie jest rozliczana kredytami.",
    );
    assert.equal(payu.created.length, 0);
    assert.equal(await testPrisma.order.count(), 0);
  });

  test("inactive organization is rejected with 409", async () => {
    const ctx = await setup();
    await testPrisma.organization.update({ where: { id: ctx.org.id }, data: { isActive: false } });
    await expectCheckoutError(
      createCheckout(testPrisma, checkoutArgs(ctx, stubPayu())),
      409,
      "Twoja organizacja nie jest rozliczana kredytami.",
    );
  });

  test("user without an organization is rejected with 409", async () => {
    const ctx = await setup();
    const args = checkoutArgs(ctx, stubPayu());
    await expectCheckoutError(
      createCheckout(testPrisma, { ...args, user: { ...args.user, organizationId: null } }),
      409,
      "Twoja organizacja nie jest rozliczana kredytami.",
    );
  });

  test("inactive package is rejected with 400", async () => {
    const ctx = await setup();
    const inactive = await createPackage({ creditType: "VALUATION", credits: 5, priceNetGrosze: 4000, isActive: false });
    const payu = stubPayu();
    await expectCheckoutError(
      createCheckout(testPrisma, checkoutArgs(ctx, payu, [{ packageId: inactive.id, quantity: 1 }])),
      400,
      "Pakiet jest niedostępny.",
    );
    assert.equal(payu.created.length, 0);
    assert.equal(await testPrisma.order.count(), 0);
  });

  test("unknown package id and empty cart are rejected with 400", async () => {
    const ctx = await setup();
    await expectCheckoutError(
      createCheckout(testPrisma, checkoutArgs(ctx, stubPayu(), [{ packageId: randomUUID(), quantity: 1 }])),
      400,
      "Pakiet jest niedostępny.",
    );
    await expectCheckoutError(createCheckout(testPrisma, checkoutArgs(ctx, stubPayu(), [])), 400, "Koszyk jest pusty.");
    await expectCheckoutError(
      createCheckout(testPrisma, checkoutArgs(ctx, stubPayu(), "nope" as unknown as [])),
      400,
      "Koszyk jest pusty.",
    );
  });

  test("order above 1 000 000 000 grosze is rejected with 400", async () => {
    const ctx = await setup();
    const huge = await createPackage({ creditType: "VALUATION", credits: 1, priceNetGrosze: 100_000_000 });
    await expectCheckoutError(
      createCheckout(testPrisma, checkoutArgs(ctx, stubPayu(), [{ packageId: huge.id, quantity: 100 }])),
      400,
      "Kwota zamówienia jest zbyt wysoka.",
    );
    assert.equal(await testPrisma.order.count(), 0);
  });

  test("valid cart creates a PENDING_PAYMENT order priced like priceCart and calls PayU", async () => {
    const ctx = await setup();
    const payu = stubPayu();
    const { orderId, redirectUri } = await createCheckout(testPrisma, checkoutArgs(ctx, payu));
    assert.equal(redirectUri, "https://pay.example.test/redirect");

    const priced = priceCart(
      [ctx.claims, ctx.valuation],
      [
        { packageId: ctx.claims.id, quantity: 1 },
        { packageId: ctx.valuation.id, quantity: 25 },
      ],
    );
    assert.ok(!("error" in priced));

    const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
    assert.equal(order.status, "PENDING_PAYMENT");
    assert.equal(order.paymentMethod, "PAYU");
    assert.equal(order.currency, "PLN");
    assert.equal(order.organizationId, ctx.org.id);
    assert.equal(order.userId, ctx.user.id);
    assert.equal(order.totalNetGrosze, priced.totalNetGrosze);
    assert.equal(order.totalVatGrosze, priced.totalVatGrosze);
    assert.equal(order.totalGrossGrosze, priced.totalGrossGrosze);
    assert.ok(order.payuOrderId);
    assert.equal(order.payuRedirectUri, "https://pay.example.test/redirect");
    assert.equal(order.items.length, 2);
    for (const line of priced.lines) {
      const stored = order.items.find((i) => i.packageId === line.packageId);
      assert.ok(stored);
      assert.deepEqual(
        { ...stored, id: undefined, orderId: undefined },
        { ...line, id: undefined, orderId: undefined },
      );
    }

    assert.equal(payu.created.length, 1);
    const sent = payu.created[0];
    assert.equal(sent.totalAmount, order.totalGrossGrosze);
    assert.equal(sent.extOrderId, order.id);
    assert.equal(sent.description, `IzzyCheck: kredyty, zamówienie ${order.id.slice(0, 8)}`);
    assert.equal(sent.customerIp, "203.0.113.5");
    assert.equal(sent.notifyUrl, `${APP_URL}/api/payments/payu/notify`);
    assert.equal(sent.continueUrl, `${APP_URL}/credits/payment-return?orderId=${order.id}`);
    assert.deepEqual(sent.buyer, { email: ctx.user.email, firstName: "Jan", lastName: "Kowalski Nowak" });
    assert.equal(
      sent.products.reduce((sum, p) => sum + p.unitPrice * p.quantity, 0),
      sent.totalAmount,
    );
    assert.deepEqual(
      sent.products.map((p) => p.quantity).sort((a, b) => a - b),
      [1, 25],
    );
  });

  test("incomplete company data is rejected with 409 before any order or PayU call", async () => {
    for (const field of ["nip", "street", "postalCode", "city", "billingEmail"] as const) {
      for (const value of ["", "   "]) {
        const ctx = await setup();
        await testPrisma.organization.update({ where: { id: ctx.org.id }, data: { [field]: value } });
        const payu = stubPayu();
        await expectCheckoutError(
          createCheckout(testPrisma, checkoutArgs(ctx, payu)),
          409,
          "Uzupełnij dane firmy (NIP, adres, e-mail do faktur), aby kupić kredyty. Skontaktuj się z opiekunem Izzy Lease.",
        );
        assert.equal(payu.created.length, 0, `${field}="${value}"`);
        assert.equal(await testPrisma.order.count(), 0, `${field}="${value}"`);
        await resetDb();
      }
    }
  });

  test("expectedTotalGrossGrosze mismatch is rejected with 409 before any order or PayU call", async () => {
    const ctx = await setup();
    const payu = stubPayu();
    const args = checkoutArgs(ctx, payu);
    const priced = priceCart(
      [ctx.claims, ctx.valuation],
      args.items,
    );
    assert.ok(!("error" in priced));

    await expectCheckoutError(
      createCheckout(testPrisma, { ...args, expectedTotalGrossGrosze: priced.totalGrossGrosze - 1 }),
      409,
      "Ceny zostały zaktualizowane. Sprawdź podsumowanie i spróbuj ponownie.",
    );
    assert.equal(payu.created.length, 0);
    assert.equal(await testPrisma.order.count(), 0);

    const { orderId } = await createCheckout(testPrisma, { ...args, expectedTotalGrossGrosze: priced.totalGrossGrosze });
    assert.equal((await testPrisma.order.findUniqueOrThrow({ where: { id: orderId } })).totalGrossGrosze, priced.totalGrossGrosze);
    assert.equal(payu.created.length, 1);
  });

  test("sandbox flag is stored on the order", async () => {
    const ctx = await setup();
    const real = await createCheckout(testPrisma, checkoutArgs(ctx, stubPayu()));
    assert.equal((await testPrisma.order.findUniqueOrThrow({ where: { id: real.orderId } })).payuSandbox, false);
    const sandboxed = await createCheckout(testPrisma, { ...checkoutArgs(ctx, stubPayu()), sandbox: true });
    assert.equal((await testPrisma.order.findUniqueOrThrow({ where: { id: sandboxed.orderId } })).payuSandbox, true);
  });

  test("single-word name is sent as first name only", async () => {
    const ctx = await setup();
    const payu = stubPayu();
    const args = checkoutArgs(ctx, payu);
    await createCheckout(testPrisma, { ...args, user: { ...args.user, name: "Madonna" } });
    assert.equal(payu.created[0].buyer.firstName, "Madonna");
    assert.equal(payu.created[0].buyer.lastName, undefined);
  });

  test("duplicate packageIds are merged into one order line", async () => {
    const ctx = await setup();
    const { orderId } = await createCheckout(
      testPrisma,
      checkoutArgs(ctx, stubPayu(), [
        { packageId: ctx.valuation.id, quantity: 2 },
        { packageId: ctx.valuation.id, quantity: 3 },
      ]),
    );
    const items = await testPrisma.orderItem.findMany({ where: { orderId } });
    assert.equal(items.length, 1);
    assert.equal(items[0].quantity, 5);
  });

  test("PayU failure marks the order FAILED and returns 502", async () => {
    const ctx = await setup();
    const payu = stubPayu({
      createOrder: async () => {
        throw new PayuError("PayU: boom", { status: 500 });
      },
    });
    await expectCheckoutError(
      createCheckout(testPrisma, checkoutArgs(ctx, payu)),
      502,
      "Nie udało się rozpocząć płatności. Spróbuj ponownie.",
    );
    const orders = await testPrisma.order.findMany();
    assert.equal(orders.length, 1);
    assert.equal(orders[0].status, "FAILED");
    assert.equal(orders[0].payuOrderId, null);
  });

  test("network error (non-PayuError) also marks the order FAILED and returns 502", async () => {
    const ctx = await setup();
    const payu = stubPayu({
      createOrder: async () => {
        throw new TypeError("fetch failed");
      },
    });
    await expectCheckoutError(
      createCheckout(testPrisma, checkoutArgs(ctx, payu)),
      502,
      "Nie udało się rozpocząć płatności. Spróbuj ponownie.",
    );
    assert.equal((await testPrisma.order.findFirstOrThrow()).status, "FAILED");
  });
});

describe("applyPayuStatus COMPLETED", () => {
  test("credits per credit type exactly once and writes PURCHASE entries linked to the order", async () => {
    const ctx = await setup();
    const order = await placeOrder(ctx);

    assert.equal(await applyPayuStatus(testPrisma, completed(order)), "PAID_NOW");

    const paid = await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(paid.status, "PAID");
    assert.ok(paid.paidAt);
    assert.equal(await readBalance(ctx.org.id, "CLAIM_DETAILS"), 10);
    assert.equal(await readBalance(ctx.org.id, "VALUATION"), 25);

    const entries = (await testPrisma.creditLedgerEntry.findMany({ where: { orderId: order.id } })).sort((a, b) =>
      a.creditType.localeCompare(b.creditType),
    );
    assert.equal(entries.length, 2);
    for (const entry of entries) {
      assert.equal(entry.type, "PURCHASE");
      assert.equal(entry.organizationId, ctx.org.id);
      assert.equal(entry.userId, ctx.user.id);
      assert.equal(entry.note, "Zakup online (PayU)");
      assert.equal(entry.idempotencyKey, `purchase:${order.id}:${entry.creditType}`);
    }
    assert.deepEqual(
      entries.map((e) => [e.creditType, e.amount]),
      [
        ["CLAIM_DETAILS", 10],
        ["VALUATION", 25],
      ],
    );
  });

  test("sums credits across several lines of the same credit type", async () => {
    const ctx = await setup();
    const small = await createPackage({ creditType: "VALUATION", credits: 5, priceNetGrosze: 4000 });
    const { orderId } = await createCheckout(
      testPrisma,
      checkoutArgs(ctx, stubPayu(), [
        { packageId: ctx.valuation.id, quantity: 3 },
        { packageId: small.id, quantity: 2 },
      ]),
    );
    const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId } });
    assert.equal(await applyPayuStatus(testPrisma, completed(order)), "PAID_NOW");
    assert.equal(await readBalance(ctx.org.id, "VALUATION"), 3 * 1 + 2 * 5);
    assert.equal(await testPrisma.creditLedgerEntry.count({ where: { orderId } }), 1);
  });

  test("second delivery returns ALREADY_PAID and leaves balances unchanged", async () => {
    const ctx = await setup();
    const order = await placeOrder(ctx);
    assert.equal(await applyPayuStatus(testPrisma, completed(order)), "PAID_NOW");
    assert.equal(await applyPayuStatus(testPrisma, completed(order)), "ALREADY_PAID");
    assert.equal(await readBalance(ctx.org.id, "CLAIM_DETAILS"), 10);
    assert.equal(await readBalance(ctx.org.id, "VALUATION"), 25);
    assert.equal(await testPrisma.creditLedgerEntry.count({ where: { orderId: order.id } }), 2);
  });

  test("5 parallel deliveries produce exactly one PAID_NOW and credit once", async () => {
    const ctx = await setup();
    const order = await placeOrder(ctx);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => applyPayuStatus(testPrisma, completed(order))),
    );
    assert.equal(results.filter((r) => r === "PAID_NOW").length, 1);
    assert.equal(results.filter((r) => r === "ALREADY_PAID").length, 4);
    assert.equal(await readBalance(ctx.org.id, "CLAIM_DETAILS"), 10);
    assert.equal(await readBalance(ctx.org.id, "VALUATION"), 25);
    assert.equal(await testPrisma.creditLedgerEntry.count({ where: { orderId: order.id } }), 2);
  });

  test("CANCELED then COMPLETED still credits (the money arrived)", async () => {
    const ctx = await setup();
    const order = await placeOrder(ctx);
    assert.equal(await applyPayuStatus(testPrisma, completed(order, { status: "CANCELED" })), "CANCELED");
    assert.equal((await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "CANCELED");
    assert.equal(await readBalance(ctx.org.id, "VALUATION"), 0);

    assert.equal(await applyPayuStatus(testPrisma, completed(order)), "PAID_NOW");
    assert.equal(await readBalance(ctx.org.id, "VALUATION"), 25);
    assert.equal(await readBalance(ctx.org.id, "CLAIM_DETAILS"), 10);
  });

  test("REJECTED then COMPLETED still credits", async () => {
    const ctx = await setup();
    const order = await placeOrder(ctx);
    assert.equal(await applyPayuStatus(testPrisma, completed(order, { status: "REJECTED" })), "FAILED");
    assert.equal((await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "FAILED");
    assert.equal(await applyPayuStatus(testPrisma, completed(order)), "PAID_NOW");
    assert.equal(await readBalance(ctx.org.id, "VALUATION"), 25);
  });

  test("a FAILED order from a failed checkout is paid and credited when COMPLETED arrives", async () => {
    const ctx = await setup();
    const payu = stubPayu({
      createOrder: async () => {
        throw new PayuError("timeout");
      },
    });
    await assert.rejects(createCheckout(testPrisma, checkoutArgs(ctx, payu)), CheckoutError);
    const order = await testPrisma.order.findFirstOrThrow();
    assert.equal(order.status, "FAILED");
    assert.equal(await applyPayuStatus(testPrisma, completed(order, { payuOrderId: "PAYU-LATE" })), "PAID_NOW");
    const paid = await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(paid.status, "PAID");
    assert.equal(paid.payuOrderId, "PAYU-LATE");
    assert.equal(await readBalance(ctx.org.id, "VALUATION"), 25);
  });

  test("paying a CANCELED order logs [PAYU_PAID_AFTER_CANCEL] with the previous status", async () => {
    const ctx = await setup();
    const order = await placeOrder(ctx);
    await applyPayuStatus(testPrisma, completed(order, { status: "CANCELED" }));
    const { result, errors } = await captureConsole(() => applyPayuStatus(testPrisma, completed(order)));
    assert.equal(result, "PAID_NOW");
    const logs = errors.filter((a) => a[0] === "[PAYU_PAID_AFTER_CANCEL]");
    assert.equal(logs.length, 1);
    assert.deepEqual(logs[0][1], {
      orderId: order.id,
      previousStatus: "CANCELED",
      payuOrderId: order.payuOrderId,
      totalAmount: order.totalGrossGrosze,
    });
  });

  test("paying a FAILED order logs [PAYU_PAID_AFTER_CANCEL] with previousStatus FAILED", async () => {
    const ctx = await setup();
    const order = await placeOrder(ctx);
    await applyPayuStatus(testPrisma, completed(order, { status: "REJECTED" }));
    const { errors } = await captureConsole(() => applyPayuStatus(testPrisma, completed(order)));
    const logs = errors.filter((a) => a[0] === "[PAYU_PAID_AFTER_CANCEL]");
    assert.equal(logs.length, 1);
    assert.equal((logs[0][1] as { previousStatus: string }).previousStatus, "FAILED");
  });

  test("a normal payment and a repeated delivery do not log [PAYU_PAID_AFTER_CANCEL]", async () => {
    const ctx = await setup();
    const order = await placeOrder(ctx);
    const { errors } = await captureConsole(async () => {
      await applyPayuStatus(testPrisma, completed(order));
      await applyPayuStatus(testPrisma, completed(order));
    });
    assert.equal(errors.filter((a) => a[0] === "[PAYU_PAID_AFTER_CANCEL]").length, 0);
  });

  test("concurrent payments with reversed line order don't deadlock", async () => {
    const ctx = await setup();
    // Existing balance rows, so every payment locks the same two rows (the deadlock-prone case).
    await setBalance(ctx.org.id, "VALUATION", 0);
    await setBalance(ctx.org.id, "CLAIM_DETAILS", 0);

    const forward = [
      { packageId: ctx.valuation.id, quantity: 2 },
      { packageId: ctx.claims.id, quantity: 1 },
    ];
    const reversed = [...forward].reverse();
    const orders = [];
    for (let i = 0; i < 40; i += 1) {
      const { orderId } = await createCheckout(testPrisma, checkoutArgs(ctx, stubPayu(), i % 2 === 0 ? forward : reversed));
      orders.push(await testPrisma.order.findUniqueOrThrow({ where: { id: orderId } }));
    }

    const settled = await Promise.allSettled(orders.map((order) => applyPayuStatus(testPrisma, completed(order))));
    const failures = settled.filter((r) => r.status === "rejected");
    assert.equal(failures.length, 0, `failed: ${failures.map((f) => String((f as PromiseRejectedResult).reason)).slice(0, 2).join(" | ")}`);
    assert.ok(settled.every((r) => r.status === "fulfilled" && r.value === "PAID_NOW"));
    assert.equal(await readBalance(ctx.org.id, "VALUATION"), 40 * 2);
    assert.equal(await readBalance(ctx.org.id, "CLAIM_DETAILS"), 40 * 10);
  });

  test("a failure while crediting rolls back the PAID status (no PAID without credits)", async () => {
    const ctx = await setup();
    const order = await placeOrder(ctx);
    // Oversized line: amount = 2 * 2_000_000_000 overflows the Int ledger column, so addCredits throws.
    await testPrisma.orderItem.update({
      where: { id: (await testPrisma.orderItem.findFirstOrThrow({ where: { orderId: order.id, creditType: "CLAIM_DETAILS" } })).id },
      data: { creditsPerPackage: 2_000_000_000, quantity: 2 },
    });

    await assert.rejects(applyPayuStatus(testPrisma, completed(order)));

    const after = await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(after.status, "PENDING_PAYMENT");
    assert.equal(after.paidAt, null);
    assert.equal(await readBalance(ctx.org.id, "VALUATION"), 0);
    assert.equal(await readBalance(ctx.org.id, "CLAIM_DETAILS"), 0);
    assert.equal(await testPrisma.creditLedgerEntry.count({ where: { orderId: order.id } }), 0);
  });

  test("an order without items is never marked PAID", async () => {
    const ctx = await setup();
    const order = await placeOrder(ctx);
    await testPrisma.orderItem.deleteMany({ where: { orderId: order.id } });
    await assert.rejects(applyPayuStatus(testPrisma, completed(order)));
    assert.equal((await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "PENDING_PAYMENT");
  });
});

describe("applyPayuStatus invoice outbox", () => {
  async function placeSandboxOrder(ctx: Ctx) {
    const { orderId } = await createCheckout(testPrisma, { ...checkoutArgs(ctx, stubPayu()), sandbox: true });
    return testPrisma.order.findUniqueOrThrow({ where: { id: orderId } });
  }

  test("new orders start with NOT_REQUIRED invoice status and no attempts", async () => {
    const order = await placeOrder(await setup());
    assert.equal(order.invoiceStatus, "NOT_REQUIRED");
    assert.equal(order.invoiceAttempts, 0);
    assert.equal(order.invoiceNextAttemptAt, null);
  });

  test("a paid order gets invoiceStatus PENDING and invoiceNextAttemptAt set", async () => {
    const order = await placeOrder(await setup());
    const before = Date.now();
    assert.equal(await applyPayuStatus(testPrisma, completed(order)), "PAID_NOW");
    const paid = await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(paid.invoiceStatus, "PENDING");
    assert.ok(paid.invoiceNextAttemptAt);
    assert.ok(paid.invoiceNextAttemptAt.getTime() >= before - 1000);
    assert.ok(paid.invoiceNextAttemptAt.getTime() <= Date.now() + 1000);
    assert.equal(paid.invoiceAttempts, 0);
  });

  test("a sandbox order stays NOT_REQUIRED when paid", async () => {
    const order = await placeSandboxOrder(await setup());
    assert.equal(await applyPayuStatus(testPrisma, completed(order)), "PAID_NOW");
    const paid = await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(paid.status, "PAID");
    assert.equal(paid.invoiceStatus, "NOT_REQUIRED");
  });

  test("a sandbox order is invoiced when INVOICE_SANDBOX_ORDERS=true", async () => {
    const previous = process.env.INVOICE_SANDBOX_ORDERS;
    process.env.INVOICE_SANDBOX_ORDERS = "true";
    try {
      const order = await placeSandboxOrder(await setup());
      assert.equal(await applyPayuStatus(testPrisma, completed(order)), "PAID_NOW");
      const paid = await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } });
      assert.equal(paid.invoiceStatus, "PENDING");
      assert.ok(paid.invoiceNextAttemptAt);
    } finally {
      if (previous === undefined) delete process.env.INVOICE_SANDBOX_ORDERS;
      else process.env.INVOICE_SANDBOX_ORDERS = previous;
    }
  });

  test("ALREADY_PAID does not touch the invoice fields", async () => {
    const order = await placeOrder(await setup());
    assert.equal(await applyPayuStatus(testPrisma, completed(order)), "PAID_NOW");
    const marker = new Date("2026-01-02T03:04:05.000Z");
    await testPrisma.order.update({
      where: { id: order.id },
      data: { invoiceStatus: "ISSUING", invoiceAttempts: 3, invoiceNextAttemptAt: marker },
    });
    assert.equal(await applyPayuStatus(testPrisma, completed(order)), "ALREADY_PAID");
    const after = await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(after.invoiceStatus, "ISSUING");
    assert.equal(after.invoiceAttempts, 3);
    assert.equal(after.invoiceNextAttemptAt?.getTime(), marker.getTime());
  });

  test("CANCELED then COMPLETED sets PENDING", async () => {
    const order = await placeOrder(await setup());
    await applyPayuStatus(testPrisma, completed(order, { status: "CANCELED" }));
    assert.equal(
      (await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } })).invoiceStatus,
      "NOT_REQUIRED",
    );
    assert.equal(await applyPayuStatus(testPrisma, completed(order)), "PAID_NOW");
    const paid = await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(paid.invoiceStatus, "PENDING");
    assert.ok(paid.invoiceNextAttemptAt);
  });
});

describe("applyPayuStatus amount, currency and other statuses", () => {
  test("wrong amount returns AMOUNT_MISMATCH and changes nothing", async () => {
    const ctx = await setup();
    const order = await placeOrder(ctx);
    const err = mock.method(console, "error", () => {});
    try {
      assert.equal(
        await applyPayuStatus(testPrisma, completed(order, { totalAmount: order.totalGrossGrosze - 1 })),
        "AMOUNT_MISMATCH",
      );
      assert.ok(err.mock.calls.some((c) => c.arguments[0] === "[PAYU_AMOUNT_MISMATCH]"));
    } finally {
      err.mock.restore();
    }
    const after = await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(after.status, "PENDING_PAYMENT");
    assert.equal(after.paidAt, null);
    assert.equal(await readBalance(ctx.org.id, "VALUATION"), 0);
    assert.equal(await readBalance(ctx.org.id, "CLAIM_DETAILS"), 0);
    assert.equal(await testPrisma.creditLedgerEntry.count(), 0);
  });

  test("wrong currency returns AMOUNT_MISMATCH and changes nothing", async () => {
    const ctx = await setup();
    const order = await placeOrder(ctx);
    const err = mock.method(console, "error", () => {});
    try {
      assert.equal(await applyPayuStatus(testPrisma, completed(order, { currencyCode: "EUR" })), "AMOUNT_MISMATCH");
    } finally {
      err.mock.restore();
    }
    assert.equal((await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "PENDING_PAYMENT");
    assert.equal(await testPrisma.creditLedgerEntry.count(), 0);
  });

  test("amount mismatch blocks every status, including CANCELED and REJECTED", async () => {
    const ctx = await setup();
    const order = await placeOrder(ctx);
    const err = mock.method(console, "error", () => {});
    try {
      for (const status of ["CANCELED", "REJECTED", "COMPLETED", "PENDING"]) {
        assert.equal(await applyPayuStatus(testPrisma, completed(order, { status, totalAmount: 1 })), "AMOUNT_MISMATCH");
      }
      assert.equal(await applyPayuStatus(testPrisma, completed(order, { totalAmount: Number.NaN })), "AMOUNT_MISMATCH");
    } finally {
      err.mock.restore();
    }
    assert.equal((await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "PENDING_PAYMENT");
  });

  test("a PAID order is not reverted by a later CANCELED or REJECTED", async () => {
    const ctx = await setup();
    const order = await placeOrder(ctx);
    assert.equal(await applyPayuStatus(testPrisma, completed(order)), "PAID_NOW");
    await applyPayuStatus(testPrisma, completed(order, { status: "CANCELED" }));
    await applyPayuStatus(testPrisma, completed(order, { status: "REJECTED" }));
    assert.equal((await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "PAID");
    assert.equal(await readBalance(ctx.org.id, "VALUATION"), 25);
  });

  test("PENDING, WAITING_FOR_CONFIRMATION, NEW and unknown statuses are IGNORED", async () => {
    const ctx = await setup();
    const order = await placeOrder(ctx);
    for (const status of ["PENDING", "WAITING_FOR_CONFIRMATION", "NEW", "SOMETHING_ELSE"]) {
      assert.equal(await applyPayuStatus(testPrisma, completed(order, { status })), "IGNORED");
    }
    assert.equal((await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "PENDING_PAYMENT");
  });

  test("unknown order id returns UNKNOWN_ORDER and logs [PAYU_UNKNOWN_ORDER]", async () => {
    const orderId = randomUUID();
    const { result, errors } = await captureConsole(() =>
      applyPayuStatus(testPrisma, {
        orderId,
        payuOrderId: "PAYU-X",
        status: "COMPLETED",
        totalAmount: 100,
        currencyCode: "PLN",
      }),
    );
    assert.equal(result, "UNKNOWN_ORDER");
    const logs = errors.filter((a) => a[0] === "[PAYU_UNKNOWN_ORDER]");
    assert.equal(logs.length, 1);
    assert.deepEqual(logs[0][1], {
      extOrderId: orderId,
      payuOrderId: "PAYU-X",
      status: "COMPLETED",
      totalAmount: 100,
      currencyCode: "PLN",
    });
  });
});

describe("handlePayuNotification", () => {
  function signed(body: object, secondKey = SECOND_KEY) {
    const rawBody = JSON.stringify(body);
    const signature = createHash("md5").update(rawBody + secondKey).digest("hex");
    return { rawBody, signatureHeader: `sender=checkout;signature=${signature};algorithm=MD5;content=DOCUMENT` };
  }
  const config = { secondKey: SECOND_KEY };

  function payload(order: { id: string; totalGrossGrosze: number }, overrides: Record<string, unknown> = {}) {
    return {
      order: {
        orderId: "PAYU-1",
        extOrderId: order.id,
        status: "COMPLETED",
        totalAmount: String(order.totalGrossGrosze),
        currencyCode: "PLN",
        ...overrides,
      },
    };
  }

  test("bad signature returns 400 and changes nothing", async () => {
    const ctx = await setup();
    const order = await placeOrder(ctx);
    const { rawBody } = signed(payload(order));
    const res = await handlePayuNotification(testPrisma, {
      rawBody,
      signatureHeader: "sender=checkout;signature=deadbeef;algorithm=MD5;content=DOCUMENT",
      config,
    });
    assert.equal(res.status, 400);
    assert.equal((await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "PENDING_PAYMENT");
    assert.equal(await readBalance(ctx.org.id, "VALUATION"), 0);
  });

  test("invalid signature is logged as metadata only (no body, no keys)", async () => {
    const ctx = await setup();
    const order = await placeOrder(ctx);
    const { rawBody } = signed(payload(order));
    const withHeader = await captureConsole(() =>
      handlePayuNotification(testPrisma, {
        rawBody,
        signatureHeader: "sender=checkout;signature=deadbeef;algorithm=SHA-256;content=DOCUMENT",
        config,
      }),
    );
    assert.equal(withHeader.result.status, 400);
    assert.deepEqual(withHeader.errors, [
      ["[PAYU_INVALID_SIGNATURE]", { hasHeader: true, algorithm: "SHA-256", bodyLength: rawBody.length }],
    ]);
    const logged = JSON.stringify(withHeader.errors);
    assert.ok(!logged.includes(SECOND_KEY));
    assert.ok(!logged.includes(order.id));

    const noHeader = await captureConsole(() =>
      handlePayuNotification(testPrisma, { rawBody, signatureHeader: null, config }),
    );
    assert.equal(noHeader.result.status, 400);
    assert.deepEqual(noHeader.errors, [
      ["[PAYU_INVALID_SIGNATURE]", { hasHeader: false, algorithm: null, bodyLength: rawBody.length }],
    ]);
  });

  test("missing signature header and signature made with another key return 400", async () => {
    const ctx = await setup();
    const order = await placeOrder(ctx);
    const good = signed(payload(order));
    assert.equal((await handlePayuNotification(testPrisma, { rawBody: good.rawBody, signatureHeader: null, config })).status, 400);
    const other = signed(payload(order), "other-key");
    assert.equal((await handlePayuNotification(testPrisma, { ...other, config })).status, 400);
    assert.equal(await testPrisma.creditLedgerEntry.count(), 0);
  });

  test("valid MD5 signature with COMPLETED returns 200 and credits", async () => {
    const ctx = await setup();
    const order = await placeOrder(ctx);
    const res = await handlePayuNotification(testPrisma, { ...signed(payload(order)), config });
    assert.deepEqual(res, { status: 200, body: { status: "OK" } });
    assert.equal((await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "PAID");
    assert.equal(await readBalance(ctx.org.id, "VALUATION"), 25);
    assert.equal(await readBalance(ctx.org.id, "CLAIM_DETAILS"), 10);

    // PayU retries the same notification: still 200, no double credit.
    const again = await handlePayuNotification(testPrisma, { ...signed(payload(order)), config });
    assert.equal(again.status, 200);
    assert.equal(await readBalance(ctx.org.id, "VALUATION"), 25);
  });

  test("valid SHA-256 signature is accepted too", async () => {
    const ctx = await setup();
    const order = await placeOrder(ctx);
    const rawBody = JSON.stringify(payload(order));
    const signature = createHash("sha256").update(rawBody + SECOND_KEY).digest("hex");
    const res = await handlePayuNotification(testPrisma, {
      rawBody,
      signatureHeader: `sender=checkout;signature=${signature};algorithm=SHA-256;content=DOCUMENT`,
      config,
    });
    assert.equal(res.status, 200);
    assert.equal(await readBalance(ctx.org.id, "VALUATION"), 25);
  });

  test("signed but invalid JSON returns 400", async () => {
    const rawBody = "{not json";
    const signature = createHash("md5").update(rawBody + SECOND_KEY).digest("hex");
    const res = await handlePayuNotification(testPrisma, {
      rawBody,
      signatureHeader: `signature=${signature};algorithm=MD5`,
      config,
    });
    assert.equal(res.status, 400);
  });

  test("signed payload with an order missing status or currency returns 400", async () => {
    const extOrderId = randomUUID();
    for (const order of [{ extOrderId, currencyCode: "PLN" }, { extOrderId, status: "COMPLETED" }, null, "x"]) {
      const res = await handlePayuNotification(testPrisma, { ...signed({ order }), config });
      assert.equal(res.status, 400);
    }
  });

  test("signed order without a string extOrderId returns 200 and warns [PAYU_NOTIFY_NO_EXT_ORDER_ID]", async () => {
    const { result, warns } = await captureConsole(() =>
      handlePayuNotification(testPrisma, {
        ...signed({ order: { orderId: "PAYU-1", status: "COMPLETED", totalAmount: "100", currencyCode: "PLN" } }),
        config,
      }),
    );
    assert.deepEqual(result, { status: 200, body: { status: "OK" } });
    assert.equal(warns.filter((a) => a[0] === "[PAYU_NOTIFY_NO_EXT_ORDER_ID]").length, 1);
    assert.equal(await testPrisma.creditLedgerEntry.count(), 0);
  });

  test("signed notification without an order (e.g. refund) returns 200 and warns [PAYU_NOTIFY_IGNORED] with the keys", async () => {
    const { result, warns } = await captureConsole(() =>
      handlePayuNotification(testPrisma, {
        ...signed({ orderId: "PAYU-1", extOrderId: randomUUID(), refund: { status: "FINALIZED" } }),
        config,
      }),
    );
    assert.deepEqual(result, { status: 200, body: { status: "OK" } });
    const logs = warns.filter((a) => a[0] === "[PAYU_NOTIFY_IGNORED]");
    assert.equal(logs.length, 1);
    assert.deepEqual(logs[0][1], { keys: ["orderId", "extOrderId", "refund"] });
  });

  test("unknown order returns 200", async () => {
    const res = await handlePayuNotification(testPrisma, {
      ...signed(payload({ id: randomUUID(), totalGrossGrosze: 100 })),
      config,
    });
    assert.deepEqual(res, { status: 200, body: { status: "OK" } });
  });

  test("amount mismatch is acknowledged with 200 and credits nothing", async () => {
    const ctx = await setup();
    const order = await placeOrder(ctx);
    const err = mock.method(console, "error", () => {});
    try {
      const res = await handlePayuNotification(testPrisma, {
        ...signed(payload(order, { totalAmount: "1" })),
        config,
      });
      assert.equal(res.status, 200);
    } finally {
      err.mock.restore();
    }
    assert.equal((await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "PENDING_PAYMENT");
    assert.equal(await testPrisma.creditLedgerEntry.count(), 0);
  });

  test("a database exception returns 500 without internal details", async () => {
    const failingDb = {
      order: {
        findUnique: async () => {
          throw new Error("connection refused: secret-host:5432");
        },
      },
    } as unknown as PrismaClient;
    const err = mock.method(console, "error", () => {});
    try {
      const res = await handlePayuNotification(failingDb, {
        ...signed(payload({ id: randomUUID(), totalGrossGrosze: 100 })),
        config,
      });
      assert.equal(res.status, 500);
      assert.ok(!JSON.stringify(res.body).includes("secret-host"));
    } finally {
      err.mock.restore();
    }
  });
});

describe("syncOrderWithPayu", () => {
  async function ageOrder(orderId: string, seconds: number) {
    await testPrisma.order.update({
      where: { id: orderId },
      data: { createdAt: new Date(Date.now() - seconds * 1000) },
    });
  }

  test("credits when PayU reports COMPLETED for an order older than 10 s", async () => {
    const ctx = await setup();
    const order = await placeOrder(ctx);
    await ageOrder(order.id, 60);
    const payu = stubPayu({
      getOrder: async (id) => {
        assert.equal(id, order.payuOrderId);
        return { status: "COMPLETED", totalAmount: order.totalGrossGrosze, currencyCode: "PLN", extOrderId: order.id };
      },
    });
    await syncOrderWithPayu(testPrisma, order.id, payu);
    assert.equal((await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "PAID");
    assert.equal(await readBalance(ctx.org.id, "VALUATION"), 25);
    assert.equal(await readBalance(ctx.org.id, "CLAIM_DETAILS"), 10);
  });

  test("does not call PayU for an order younger than 10 s", async () => {
    const ctx = await setup();
    const order = await placeOrder(ctx);
    let calls = 0;
    const payu = stubPayu({
      getOrder: async () => {
        calls += 1;
        return { status: "COMPLETED", totalAmount: order.totalGrossGrosze, currencyCode: "PLN", extOrderId: order.id };
      },
    });
    await syncOrderWithPayu(testPrisma, order.id, payu);
    assert.equal(calls, 0);
    assert.equal((await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "PENDING_PAYMENT");
  });

  test("does not call PayU for orders that are not PENDING_PAYMENT or have no payuOrderId", async () => {
    const ctx = await setup();
    let calls = 0;
    const payu = stubPayu({
      getOrder: async () => {
        calls += 1;
        throw new Error("should not be called");
      },
    });

    const paid = await placeOrder(ctx);
    await applyPayuStatus(testPrisma, completed(paid));
    await ageOrder(paid.id, 60);
    await syncOrderWithPayu(testPrisma, paid.id, payu);

    const noPayuId = await placeOrder(ctx);
    await testPrisma.order.update({ where: { id: noPayuId.id }, data: { payuOrderId: null } });
    await ageOrder(noPayuId.id, 60);
    await syncOrderWithPayu(testPrisma, noPayuId.id, payu);

    await syncOrderWithPayu(testPrisma, randomUUID(), payu);
    assert.equal(calls, 0);
  });

  test("swallows PayU errors and leaves the order untouched", async () => {
    const ctx = await setup();
    const order = await placeOrder(ctx);
    await ageOrder(order.id, 60);
    const payu = stubPayu({
      getOrder: async () => {
        throw new PayuError("PayU down", { status: 503 });
      },
    });
    const err = mock.method(console, "error", () => {});
    try {
      await syncOrderWithPayu(testPrisma, order.id, payu);
    } finally {
      err.mock.restore();
    }
    assert.equal((await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "PENDING_PAYMENT");
  });

  test("skips and logs [PAYU_SYNC_MISMATCH] when PayU returns a different extOrderId", async () => {
    const ctx = await setup();
    const order = await placeOrder(ctx);
    await ageOrder(order.id, 60);
    const payu = stubPayu({
      getOrder: async () => ({
        status: "COMPLETED",
        totalAmount: order.totalGrossGrosze,
        currencyCode: "PLN",
        extOrderId: randomUUID(),
      }),
    });
    const { errors } = await captureConsole(() => syncOrderWithPayu(testPrisma, order.id, payu));
    assert.equal(errors.filter((a) => a[0] === "[PAYU_SYNC_MISMATCH]").length, 1);
    assert.equal((await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "PENDING_PAYMENT");
    assert.equal(await testPrisma.creditLedgerEntry.count(), 0);
  });

  test("a mismatching amount from PayU never credits", async () => {
    const ctx = await setup();
    const order = await placeOrder(ctx);
    await ageOrder(order.id, 60);
    const payu = stubPayu({
      getOrder: async () => ({ status: "COMPLETED", totalAmount: 1, currencyCode: "PLN", extOrderId: order.id }),
    });
    const err = mock.method(console, "error", () => {});
    try {
      await syncOrderWithPayu(testPrisma, order.id, payu);
    } finally {
      err.mock.restore();
    }
    assert.equal((await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "PENDING_PAYMENT");
    assert.equal(await testPrisma.creditLedgerEntry.count(), 0);
  });
});
