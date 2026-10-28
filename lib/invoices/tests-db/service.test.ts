import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, beforeEach, describe, mock, test } from "node:test";
import type { InvoiceStatus, OrderStatus, Prisma } from "@prisma/client";
import { FakturowniaError, createFakturowniaClient, type FakturowniaInvoiceInput } from "../fakturownia.ts";
import {
  invoiceRetryDelayMs,
  processInvoice,
  refreshKsefStatus,
  runBillingCron,
  sendInvoiceEmail,
  type FakturowniaClientLike,
} from "../service.ts";
import type { PayuClientLike } from "../../billing/orders.ts";
import { createOrg, createUser, resetDb, testPrisma } from "../../test-db/helpers.ts";

beforeEach(async () => {
  await resetDb();
});

after(async () => {
  await testPrisma.$disconnect();
});

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

type Calls = {
  created: FakturowniaInvoiceInput[];
  emails: Array<{ id: string; emailTo: string[]; emailCc: string[] }>;
  ksef: string[];
};

function stubClient(overrides: Partial<FakturowniaClientLike> = {}) {
  const calls: Calls = { created: [], emails: [], ksef: [] };
  let seq = 0;
  const client: FakturowniaClientLike = {
    createInvoice:
      overrides.createInvoice ??
      (async (invoice) => {
        calls.created.push(invoice);
        seq += 1;
        return { id: `INV-${randomUUID()}`, number: `FV/${seq}/10/2026`, token: `token-${seq}` };
      }),
    sendInvoiceByEmail:
      overrides.sendInvoiceByEmail ??
      (async (id, recipients) => {
        calls.emails.push({ id, ...recipients });
      }),
    getInvoiceKsef:
      overrides.getInvoiceKsef ??
      (async (id) => {
        calls.ksef.push(id);
        return { govStatus: "ok", govId: "KSEF-123", verificationLink: "https://ksef.example.test/verify", errors: [] };
      }),
  };
  return { client, calls };
}

/** Silences and records console output while fn runs. */
async function captured<T>(fn: () => Promise<T>) {
  const error = mock.method(console, "error", () => {});
  const warn = mock.method(console, "warn", () => {});
  const info = mock.method(console, "info", () => {});
  const log = mock.method(console, "log", () => {});
  try {
    const result = await fn();
    return {
      result,
      errors: error.mock.calls.map((c) => c.arguments),
      logs: [...info.mock.calls, ...log.mock.calls, ...warn.mock.calls].map((c) => c.arguments),
    };
  } finally {
    error.mock.restore();
    warn.mock.restore();
    info.mock.restore();
    log.mock.restore();
  }
}

type Seed = {
  org: { id: string };
  user: { id: string };
};

async function seed(): Promise<Seed> {
  const org = await createOrg();
  const user = await createUser({ organizationId: org.id });
  return { org, user };
}

async function createOrder(
  ctx: Seed,
  opts: {
    status?: OrderStatus;
    invoiceStatus?: InvoiceStatus;
    paidAt?: Date | null;
    payuOrderId?: string | null;
    extra?: Partial<Prisma.OrderUncheckedCreateInput>;
    lineGrossGrosze?: number;
  } = {},
) {
  const pkg = await testPrisma.creditPackage.create({
    data: { name: "Pakiet wycen 10", creditType: "VALUATION", credits: 10, priceNetGrosze: 1000 },
  });
  const lineGross = opts.lineGrossGrosze ?? 2460;
  const status = opts.status ?? "PAID";
  return testPrisma.order.create({
    data: {
      organizationId: ctx.org.id,
      userId: ctx.user.id,
      status,
      paymentMethod: "PAYU",
      totalNetGrosze: 2000,
      totalVatGrosze: 460,
      totalGrossGrosze: 2460,
      payuOrderId: opts.payuOrderId ?? null,
      paidAt: opts.paidAt === undefined ? (status === "PAID" ? new Date() : null) : opts.paidAt,
      invoiceStatus: opts.invoiceStatus ?? "PENDING",
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
            lineGrossGrosze: lineGross,
          },
        ],
      },
      ...opts.extra,
    },
  });
}

const read = (id: string) => testPrisma.order.findUniqueOrThrow({ where: { id } });

describe("invoiceRetryDelayMs", () => {
  test("5 min doubling per attempt, null after the 10th attempt", () => {
    assert.equal(invoiceRetryDelayMs(1), 5 * MIN);
    assert.equal(invoiceRetryDelayMs(2), 10 * MIN);
    assert.equal(invoiceRetryDelayMs(3), 20 * MIN);
    assert.equal(invoiceRetryDelayMs(9), 1280 * MIN);
    assert.equal(invoiceRetryDelayMs(10), null);
    assert.equal(invoiceRetryDelayMs(11), null);
  });
});

describe("processInvoice", () => {
  test("issues the invoice, stores its data and e-mails billingEmail with the purchaser in cc", async () => {
    const ctx = await seed();
    const order = await createOrder(ctx, { extra: { invoiceNextAttemptAt: new Date(Date.now() - MIN) } });
    const { client, calls } = stubClient();
    const now = new Date();

    assert.equal(await processInvoice(testPrisma, order.id, { client, clock: () => now }), "ISSUED");

    assert.equal(calls.created.length, 1);
    assert.equal(calls.created[0].oid, order.id);
    const row = await read(order.id);
    assert.equal(row.invoiceStatus, "ISSUED");
    assert.equal(row.invoiceAttempts, 1);
    assert.ok(row.fakturowniaInvoiceId?.startsWith("INV-"));
    assert.equal(row.invoiceNumber, "FV/1/10/2026");
    assert.equal(row.invoiceToken, "token-1");
    assert.equal(row.invoiceIssuedAt?.getTime(), now.getTime());
    assert.equal(row.invoiceLastError, null);
    assert.equal(row.invoiceNextAttemptAt, null);
    assert.equal(row.invoiceEmailedAt?.getTime(), now.getTime());

    const org = await testPrisma.organization.findUniqueOrThrow({ where: { id: ctx.org.id } });
    const user = await testPrisma.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
    assert.deepEqual(calls.emails, [{ id: row.fakturowniaInvoiceId, emailTo: [org.billingEmail], emailCc: [user.email] }]);
  });

  test("no cc when the purchaser has the billing e-mail", async () => {
    const ctx = await seed();
    const org = await testPrisma.organization.findUniqueOrThrow({ where: { id: ctx.org.id } });
    await testPrisma.user.update({ where: { id: ctx.user.id }, data: { email: org.billingEmail.toUpperCase() } });
    const order = await createOrder(ctx, { extra: { invoiceNextAttemptAt: new Date(Date.now() - MIN) } });
    const { client, calls } = stubClient();
    await processInvoice(testPrisma, order.id, { client, clock: () => new Date() });
    assert.deepEqual(calls.emails[0].emailCc, []);
  });

  test("passes the department id to the payload", async () => {
    const ctx = await seed();
    const order = await createOrder(ctx, { extra: { invoiceNextAttemptAt: new Date(Date.now() - MIN) } });
    const { client, calls } = stubClient();
    await processInvoice(testPrisma, order.id, { client, clock: () => new Date(), departmentId: 4242 });
    assert.equal(calls.created[0].department_id, 4242);
  });

  test("5 parallel calls create exactly one invoice", async () => {
    const ctx = await seed();
    const order = await createOrder(ctx, { extra: { invoiceNextAttemptAt: new Date(Date.now() - MIN) } });
    let created = 0;
    const { client } = stubClient({
      createInvoice: async () => {
        created += 1;
        await new Promise((resolve) => setTimeout(resolve, 80));
        return { id: "INV-ONE", number: "FV/1/10/2026", token: "tok" };
      },
    });
    const now = new Date();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => processInvoice(testPrisma, order.id, { client, clock: () => now })),
    );
    assert.equal(created, 1);
    assert.equal(results.filter((r) => r === "ISSUED").length, 1);
    assert.equal(results.filter((r) => r === "SKIPPED").length, 4);
    assert.equal((await read(order.id)).invoiceAttempts, 1);
  });

  test("a SERVER error leaves FAILED with attempt 1 and a retry in 5 minutes", async () => {
    const ctx = await seed();
    const order = await createOrder(ctx, { extra: { invoiceNextAttemptAt: new Date(Date.now() - MIN) } });
    const { client } = stubClient({
      createInvoice: async () => {
        throw new FakturowniaError("Fakturownia: coś poszło nie tak (HTTP 500)", { status: 500, code: "SERVER" });
      },
    });
    const now = new Date();
    const { result, errors } = await captured(() => processInvoice(testPrisma, order.id, { client, clock: () => now }));
    assert.equal(result, "FAILED");
    const row = await read(order.id);
    assert.equal(row.invoiceStatus, "FAILED");
    assert.equal(row.invoiceAttempts, 1);
    assert.equal(row.invoiceNextAttemptAt?.getTime(), now.getTime() + 5 * MIN);
    assert.match(row.invoiceLastError ?? "", /HTTP 500/);
    assert.equal(row.fakturowniaInvoiceId, null);
    assert.equal(errors.filter((a) => a[0] === "[INVOICE_ISSUE_ERROR]").length, 1);
  });

  test("AUTH, TIMEOUT and VALIDATION errors are retried with backoff too", async () => {
    for (const code of ["AUTH", "TIMEOUT", "VALIDATION"] as const) {
      const ctx = await seed();
      const order = await createOrder(ctx, { extra: { invoiceNextAttemptAt: new Date(Date.now() - MIN) } });
      const { client } = stubClient({
        createInvoice: async () => {
          throw new FakturowniaError(`blad ${code}`, { code });
        },
      });
      const now = new Date();
      const { result } = await captured(() => processInvoice(testPrisma, order.id, { client, clock: () => now }));
      assert.equal(result, "FAILED", code);
      const row = await read(order.id);
      assert.equal(row.invoiceStatus, "FAILED", code);
      assert.equal(row.invoiceNextAttemptAt?.getTime(), now.getTime() + 5 * MIN, code);
    }
  });

  test("backoff doubles with the attempt number", async () => {
    const ctx = await seed();
    const order = await createOrder(ctx, {
      invoiceStatus: "FAILED",
      extra: { invoiceAttempts: 3, invoiceNextAttemptAt: new Date(Date.now() - MIN) },
    });
    const { client } = stubClient({
      createInvoice: async () => {
        throw new FakturowniaError("x", { code: "SERVER" });
      },
    });
    const now = new Date();
    await captured(() => processInvoice(testPrisma, order.id, { client, clock: () => now }));
    const row = await read(order.id);
    assert.equal(row.invoiceAttempts, 4);
    assert.equal(row.invoiceNextAttemptAt?.getTime(), now.getTime() + 40 * MIN);
  });

  test("the 10th failed attempt stops the retries", async () => {
    const ctx = await seed();
    const order = await createOrder(ctx, {
      invoiceStatus: "FAILED",
      extra: { invoiceAttempts: 9, invoiceNextAttemptAt: new Date(Date.now() - MIN) },
    });
    const { client } = stubClient({
      createInvoice: async () => {
        throw new FakturowniaError("x", { code: "SERVER" });
      },
    });
    await captured(() => processInvoice(testPrisma, order.id, { client, clock: () => new Date() }));
    const row = await read(order.id);
    assert.equal(row.invoiceStatus, "FAILED");
    assert.equal(row.invoiceAttempts, 10);
    assert.equal(row.invoiceNextAttemptAt, null);
  });

  test("DUPLICATE_OID goes to NEEDS_ATTENTION without a retry", async () => {
    const ctx = await seed();
    const order = await createOrder(ctx, { extra: { invoiceNextAttemptAt: new Date(Date.now() - MIN) } });
    const { client } = stubClient({
      createInvoice: async () => {
        throw new FakturowniaError("dup", { status: 422, code: "DUPLICATE_OID" });
      },
    });
    const { result, errors } = await captured(() => processInvoice(testPrisma, order.id, { client, clock: () => new Date() }));
    assert.equal(result, "NEEDS_ATTENTION");
    const row = await read(order.id);
    assert.equal(row.invoiceStatus, "NEEDS_ATTENTION");
    assert.equal(row.invoiceNextAttemptAt, null);
    assert.equal(row.invoiceLastError, "Faktura z tym numerem zamówienia już istnieje w Fakturowni — sprawdź i oznacz ręcznie.");
    assert.equal(errors.filter((a) => a[0] === "[INVOICE_DUPLICATE_OID]").length, 1);
  });

  test("a non-Fakturownia error (broken order data) is FAILED with backoff", async () => {
    const ctx = await seed();
    // Lines do not add up to the order total: buildInvoicePayload throws a plain Error.
    const order = await createOrder(ctx, {
      lineGrossGrosze: 1,
      extra: { invoiceNextAttemptAt: new Date(Date.now() - MIN) },
    });
    const { client, calls } = stubClient();
    const now = new Date();
    const { result, errors } = await captured(() => processInvoice(testPrisma, order.id, { client, clock: () => now }));
    assert.equal(result, "FAILED");
    assert.equal(calls.created.length, 0);
    const row = await read(order.id);
    assert.equal(row.invoiceStatus, "FAILED");
    assert.equal(row.invoiceNextAttemptAt?.getTime(), now.getTime() + 5 * MIN);
    assert.ok(row.invoiceLastError);
    assert.equal(errors.filter((a) => a[0] === "[INVOICE_ISSUE_ERROR]").length, 1);
  });

  test("an e-mail failure keeps the invoice ISSUED and records the message", async () => {
    const ctx = await seed();
    const order = await createOrder(ctx, { extra: { invoiceNextAttemptAt: new Date(Date.now() - MIN) } });
    const { client } = stubClient({
      sendInvoiceByEmail: async () => {
        throw new FakturowniaError("Fakturownia: nie udało się wysłać faktury e-mailem (HTTP 422)", { code: "VALIDATION" });
      },
    });
    const { result, errors } = await captured(() => processInvoice(testPrisma, order.id, { client, clock: () => new Date() }));
    assert.equal(result, "ISSUED");
    const row = await read(order.id);
    assert.equal(row.invoiceStatus, "ISSUED");
    assert.ok(row.fakturowniaInvoiceId);
    assert.equal(row.invoiceEmailedAt, null);
    assert.match(row.invoiceLastError ?? "", /e-mailem/);
    assert.equal(errors.filter((a) => a[0] === "[INVOICE_EMAIL_ERROR]").length, 1);
  });

  test("an expired ISSUING claim (older than 10 min) is taken over", async () => {
    const ctx = await seed();
    const now = new Date();
    const order = await createOrder(ctx, {
      invoiceStatus: "ISSUING",
      extra: { invoiceAttempts: 1, invoiceClaimedAt: new Date(now.getTime() - 11 * MIN) },
    });
    const { client, calls } = stubClient();
    assert.equal(await processInvoice(testPrisma, order.id, { client, clock: () => now }), "ISSUED");
    assert.equal(calls.created.length, 1);
    assert.equal((await read(order.id)).invoiceAttempts, 2);
  });

  test("a fresh ISSUING claim is left alone", async () => {
    const ctx = await seed();
    const now = new Date();
    const order = await createOrder(ctx, {
      invoiceStatus: "ISSUING",
      extra: { invoiceAttempts: 1, invoiceClaimedAt: new Date(now.getTime() - 5 * MIN) },
    });
    const { client, calls } = stubClient();
    assert.equal(await processInvoice(testPrisma, order.id, { client, clock: () => now }), "SKIPPED");
    assert.equal(calls.created.length, 0);
    assert.equal((await read(order.id)).invoiceAttempts, 1);
  });

  test("orders that are not due are SKIPPED without calling Fakturownia", async () => {
    const ctx = await seed();
    const now = new Date();
    const { client, calls } = stubClient();
    const cases: Array<{ invoiceStatus: InvoiceStatus; next: Date | null }> = [
      { invoiceStatus: "NOT_REQUIRED", next: new Date(now.getTime() - MIN) },
      { invoiceStatus: "ISSUED", next: null },
      { invoiceStatus: "NEEDS_ATTENTION", next: null },
      { invoiceStatus: "FAILED", next: null },
      { invoiceStatus: "PENDING", next: new Date(now.getTime() + 5 * MIN) },
    ];
    for (const c of cases) {
      const order = await createOrder(ctx, { invoiceStatus: c.invoiceStatus, extra: { invoiceNextAttemptAt: c.next } });
      assert.equal(await processInvoice(testPrisma, order.id, { client, clock: () => now }), "SKIPPED", c.invoiceStatus);
      assert.equal((await read(order.id)).invoiceAttempts, 0);
    }
    assert.equal(await processInvoice(testPrisma, randomUUID(), { client, clock: () => now }), "SKIPPED");
    assert.equal(calls.created.length, 0);
  });

  test("without a client nothing changes (NOT_CONFIGURED)", async () => {
    const ctx = await seed();
    const order = await createOrder(ctx, { extra: { invoiceNextAttemptAt: new Date(Date.now() - MIN) } });
    const before = await read(order.id);
    assert.equal(await processInvoice(testPrisma, order.id, { client: null }), "NOT_CONFIGURED");
    assert.deepEqual(await read(order.id), before);
  });
});

async function issuedOrder(ctx: Seed, extra: Partial<Prisma.OrderUncheckedCreateInput> = {}) {
  return createOrder(ctx, {
    invoiceStatus: "ISSUED",
    extra: {
      fakturowniaInvoiceId: `INV-${randomUUID()}`,
      invoiceNumber: "FV/1",
      invoiceToken: "t",
      invoiceIssuedAt: new Date(),
      ...extra,
    },
  });
}

describe("sendInvoiceEmail", () => {
  test("sends once, marks invoiceEmailedAt and clears invoiceLastError", async () => {
    const ctx = await seed();
    const order = await issuedOrder(ctx, { invoiceLastError: "stary błąd" });
    const { client, calls } = stubClient();
    const now = new Date();
    assert.equal(await sendInvoiceEmail(testPrisma, order.id, { client, clock: () => now }), true);
    const row = await read(order.id);
    assert.equal(row.invoiceEmailedAt?.getTime(), now.getTime());
    assert.equal(row.invoiceLastError, null);
    // Already e-mailed: not sent again.
    assert.equal(await sendInvoiceEmail(testPrisma, order.id, { client, clock: () => now }), false);
    assert.equal(calls.emails.length, 1);
  });

  test("does nothing for an order that is not ISSUED", async () => {
    const ctx = await seed();
    const order = await createOrder(ctx, { invoiceStatus: "FAILED" });
    const { client, calls } = stubClient();
    assert.equal(await sendInvoiceEmail(testPrisma, order.id, { client }), false);
    assert.equal(calls.emails.length, 0);
  });
});

describe("refreshKsefStatus", () => {
  test("stores status, id, link and check time", async () => {
    const ctx = await seed();
    const order = await issuedOrder(ctx);
    const { client, calls } = stubClient();
    const now = new Date();
    const res = await refreshKsefStatus(testPrisma, order.id, { client, clock: () => now });
    assert.deepEqual(res, { result: "REFRESHED", ksefStatus: "ok" });
    assert.deepEqual(calls.ksef, [order.fakturowniaInvoiceId]);
    const row = await read(order.id);
    assert.equal(row.ksefStatus, "ok");
    assert.equal(row.ksefId, "KSEF-123");
    assert.equal(row.ksefVerificationLink, "https://ksef.example.test/verify");
    assert.equal(row.ksefCheckedAt?.getTime(), now.getTime());
  });

  test("skips final statuses and invoices that are not ISSUED", async () => {
    const ctx = await seed();
    const { client, calls } = stubClient();
    for (const ksefStatus of ["ok", "demo_ok", "not_applicable", "duplicate_error"]) {
      const order = await issuedOrder(ctx, { ksefStatus });
      assert.deepEqual(await refreshKsefStatus(testPrisma, order.id, { client }), { result: "SKIPPED", ksefStatus });
    }
    const failed = await createOrder(ctx, { invoiceStatus: "FAILED" });
    assert.equal((await refreshKsefStatus(testPrisma, failed.id, { client })).result, "SKIPPED");
    assert.equal(calls.ksef.length, 0);
  });

  test("keeps refreshing non-final statuses and logs KSeF errors", async () => {
    const ctx = await seed();
    const order = await issuedOrder(ctx, { ksefStatus: "processing" });
    const { client } = stubClient({
      getInvoiceKsef: async () => ({ govStatus: "send_error", govId: null, verificationLink: null, errors: ["Błąd 21405"] }),
    });
    const { result, errors } = await captured(() => refreshKsefStatus(testPrisma, order.id, { client, clock: () => new Date() }));
    assert.deepEqual(result, { result: "REFRESHED", ksefStatus: "send_error" });
    assert.equal((await read(order.id)).ksefStatus, "send_error");
    assert.equal(errors.filter((a) => a[0] === "[INVOICE_KSEF_ERROR]").length, 1);
  });

  test("an API failure is logged, the check time is bumped and the stored status is kept", async () => {
    const ctx = await seed();
    const order = await issuedOrder(ctx, { ksefStatus: "processing" });
    const { client } = stubClient({
      getInvoiceKsef: async () => {
        throw new FakturowniaError("boom", { code: "SERVER" });
      },
    });
    const now = new Date();
    const { result, errors } = await captured(() => refreshKsefStatus(testPrisma, order.id, { client, clock: () => now }));
    assert.deepEqual(result, { result: "ERROR", ksefStatus: "processing" });
    const row = await read(order.id);
    assert.equal(row.ksefStatus, "processing");
    assert.equal(row.ksefCheckedAt?.getTime(), now.getTime());
    assert.equal(errors.filter((a) => a[0] === "[INVOICE_KSEF_ERROR]").length, 1);
  });
});

function stubPayu(getOrder: PayuClientLike["getOrder"]): PayuClientLike {
  return {
    createOrder: async () => {
      throw new Error("not used");
    },
    getOrder,
  };
}

describe("runBillingCron", () => {
  test("processes only qualifying invoices, KSeF checks and PayU syncs", async () => {
    const ctx = await seed();
    const now = new Date();
    const old = (minutes: number) => new Date(now.getTime() - minutes * MIN);
    const issuedExtra = (extra: Partial<Prisma.OrderUncheckedCreateInput>) => ({
      fakturowniaInvoiceId: `INV-${randomUUID()}`,
      invoiceNumber: "FV/1",
      invoiceToken: "t",
      invoiceIssuedAt: old(60),
      invoiceEmailedAt: old(59),
      ...extra,
    });

    // (a) invoices
    const duePending = await createOrder(ctx, { extra: { invoiceNextAttemptAt: old(1) } });
    const dueFailed = await createOrder(ctx, { invoiceStatus: "FAILED", extra: { invoiceAttempts: 2, invoiceNextAttemptAt: old(1) } });
    const staleIssuing = await createOrder(ctx, { invoiceStatus: "ISSUING", extra: { invoiceAttempts: 1, invoiceClaimedAt: old(11) } });
    const futurePending = await createOrder(ctx, { extra: { invoiceNextAttemptAt: new Date(now.getTime() + 5 * MIN) } });
    const freshIssuing = await createOrder(ctx, { invoiceStatus: "ISSUING", extra: { invoiceClaimedAt: old(2) } });
    const exhausted = await createOrder(ctx, { invoiceStatus: "FAILED", extra: { invoiceAttempts: 10, invoiceNextAttemptAt: null } });
    const attention = await createOrder(ctx, { invoiceStatus: "NEEDS_ATTENTION" });
    const notRequired = await createOrder(ctx, { invoiceStatus: "NOT_REQUIRED", extra: { invoiceNextAttemptAt: old(1) } });

    // (b) KSeF refresh
    const ksefDue = await issuedOrder(ctx, issuedExtra({ ksefStatus: "processing", ksefCheckedAt: old(20) }));
    const ksefNeverChecked = await issuedOrder(ctx, issuedExtra({}));
    const ksefRecentlyChecked = await issuedOrder(ctx, issuedExtra({ ksefStatus: "processing", ksefCheckedAt: old(5) }));
    const ksefFinal = await issuedOrder(ctx, issuedExtra({ ksefStatus: "ok", ksefCheckedAt: old(500) }));

    // (c) PayU sync
    const mkPending = (createdMinutes: number, updatedMinutes: number, payuOrderId: string | null = `PAYU-${randomUUID()}`) =>
      createOrder(ctx, {
        status: "PENDING_PAYMENT",
        invoiceStatus: "NOT_REQUIRED",
        payuOrderId,
        extra: { createdAt: old(createdMinutes), updatedAt: old(updatedMinutes) },
      });
    const lost = await mkPending(60, 60);
    const tooYoung = await mkPending(5, 5);
    const tooOld = await mkPending(8 * 24 * 60, 8 * 24 * 60);
    const recentlyTouched = await mkPending(60, 5);
    const noPayuId = await mkPending(60, 60, null);

    const polled: string[] = [];
    const payu = stubPayu(async (payuOrderId) => {
      polled.push(payuOrderId);
      return { status: "COMPLETED", totalAmount: 2460, currencyCode: "PLN", extOrderId: lost.id };
    });

    const { client, calls } = stubClient();
    const { result } = await captured(() => runBillingCron(testPrisma, { invoiceClient: client, payuClient: payu, clock: () => now }));

    // (a) three due invoices
    assert.equal(result.invoicesProcessed, 3);
    assert.equal(calls.created.length, 3);
    for (const o of [duePending, dueFailed, staleIssuing]) assert.equal((await read(o.id)).invoiceStatus, "ISSUED", o.id);
    assert.equal((await read(futurePending.id)).invoiceStatus, "PENDING");
    assert.equal((await read(exhausted.id)).invoiceStatus, "FAILED");
    assert.equal((await read(exhausted.id)).invoiceAttempts, 10);
    assert.equal((await read(attention.id)).invoiceStatus, "NEEDS_ATTENTION");
    assert.equal((await read(freshIssuing.id)).invoiceStatus, "ISSUING");
    assert.equal((await read(notRequired.id)).invoiceStatus, "NOT_REQUIRED");
    assert.equal((await read(notRequired.id)).invoiceAttempts, 0);

    // (b) never-checked and stale-checked invoices are refreshed; recently checked and final ones are not,
    // and neither are the invoices just issued in (a) (their first KSeF check is a full pause away)
    const checked = new Set(calls.ksef);
    assert.equal(checked.size, 2);
    assert.ok(checked.has(ksefDue.fakturowniaInvoiceId!));
    assert.ok(checked.has(ksefNeverChecked.fakturowniaInvoiceId!));
    assert.equal((await read(ksefDue.id)).ksefStatus, "ok");
    assert.equal((await read(ksefRecentlyChecked.id)).ksefStatus, "processing");
    assert.equal(result.ksefRefreshed, 2);
    assert.equal(result.emailsSent, 0);

    // (c) only the old PENDING_PAYMENT order with a PayU id was polled
    assert.equal(result.ordersSynced, 1);
    assert.deepEqual(polled, [lost.payuOrderId]);
    // paid by the sync; its invoice is issued on the next pass
    const paidLost = await read(lost.id);
    assert.equal(paidLost.status, "PAID");
    assert.equal(paidLost.invoiceStatus, "PENDING");
    for (const o of [tooYoung, tooOld, recentlyTouched, noPayuId]) {
      assert.equal((await read(o.id)).status, "PENDING_PAYMENT", o.id);
    }
  });

  test("NOT_REQUIRED orders are never picked", async () => {
    const ctx = await seed();
    const now = new Date();
    const order = await createOrder(ctx, {
      invoiceStatus: "NOT_REQUIRED",
      extra: { invoiceNextAttemptAt: new Date(now.getTime() - MIN), invoiceClaimedAt: new Date(now.getTime() - 30 * MIN) },
    });
    const { client, calls } = stubClient();
    const { result } = await captured(() => runBillingCron(testPrisma, { invoiceClient: client, payuClient: null, clock: () => now }));
    assert.deepEqual(result, { invoicesProcessed: 0, ksefRefreshed: 0, emailsSent: 0, ordersSynced: 0, budgetExhausted: false });
    assert.equal(calls.created.length, 0);
    assert.equal((await read(order.id)).invoiceStatus, "NOT_REQUIRED");
    assert.equal((await read(order.id)).invoiceAttempts, 0);
  });

  test("e-mail failure, then the cron retries once KSeF reports ok", async () => {
    const ctx = await seed();
    const order = await createOrder(ctx, { extra: { invoiceNextAttemptAt: new Date(Date.now() - MIN) } });
    let failMail = true;
    const { client, calls } = stubClient({
      sendInvoiceByEmail: async (id, recipients) => {
        if (failMail) throw new FakturowniaError("Fakturownia: nie udało się wysłać faktury e-mailem", { code: "VALIDATION" });
        calls.emails.push({ id, ...recipients });
      },
    });
    const issuedAt = new Date();
    await captured(() => processInvoice(testPrisma, order.id, { client, clock: () => issuedAt }));
    assert.equal((await read(order.id)).invoiceEmailedAt, null);

    failMail = false;
    const later = new Date(issuedAt.getTime() + 20 * MIN);
    const { result } = await captured(() => runBillingCron(testPrisma, { invoiceClient: client, payuClient: null, clock: () => later }));
    assert.equal(result.emailsSent, 1);
    assert.equal(result.ksefRefreshed, 1);
    const row = await read(order.id);
    assert.equal(row.ksefStatus, "ok");
    assert.equal(row.invoiceEmailedAt?.getTime(), later.getTime());
    assert.equal(row.invoiceLastError, null);
    assert.equal(calls.emails.length, 1);
  });

  test("e-mail is not retried while KSeF is still processing", async () => {
    const ctx = await seed();
    const order = await createOrder(ctx, { extra: { invoiceNextAttemptAt: new Date(Date.now() - MIN) } });
    const { client } = stubClient({
      sendInvoiceByEmail: async () => {
        throw new FakturowniaError("zablokowane do czasu nadania numeru KSeF", { code: "VALIDATION" });
      },
      getInvoiceKsef: async () => ({ govStatus: "processing", govId: null, verificationLink: null, errors: [] }),
    });
    const issuedAt = new Date();
    await captured(() => processInvoice(testPrisma, order.id, { client, clock: () => issuedAt }));

    let mailAttempts = 0;
    const counting: FakturowniaClientLike = {
      ...client,
      sendInvoiceByEmail: async () => {
        mailAttempts += 1;
      },
    };
    const later = new Date(issuedAt.getTime() + 20 * MIN);
    const { result } = await captured(() => runBillingCron(testPrisma, { invoiceClient: counting, payuClient: null, clock: () => later }));
    assert.equal(result.ksefRefreshed, 1);
    assert.equal(result.emailsSent, 0);
    assert.equal(mailAttempts, 0);
    assert.equal((await read(order.id)).ksefStatus, "processing");
    assert.equal((await read(order.id)).invoiceEmailedAt, null);
  });

  test("e-mail retries stop 3 days after the invoice was issued", async () => {
    const ctx = await seed();
    const now = new Date();
    const order = await issuedOrder(ctx, { invoiceIssuedAt: new Date(now.getTime() - 4 * DAY), ksefStatus: "ok" });
    let mailAttempts = 0;
    const { client } = stubClient({
      sendInvoiceByEmail: async () => {
        mailAttempts += 1;
      },
    });
    const { result } = await captured(() => runBillingCron(testPrisma, { invoiceClient: client, payuClient: null, clock: () => now }));
    assert.equal(result.emailsSent, 0);
    assert.equal(mailAttempts, 0);
    assert.equal((await read(order.id)).invoiceEmailedAt, null);
  });

  test("a failing e-mail with a final KSeF status is retried at most every 15 minutes", async () => {
    const ctx = await seed();
    const now = new Date();
    const order = await issuedOrder(ctx, { invoiceIssuedAt: new Date(now.getTime() - 60 * MIN), ksefStatus: "ok" });
    let mailAttempts = 0;
    const { client } = stubClient({
      sendInvoiceByEmail: async () => {
        mailAttempts += 1;
        throw new FakturowniaError("nie działa", { code: "SERVER" });
      },
    });
    await captured(() => runBillingCron(testPrisma, { invoiceClient: client, payuClient: null, clock: () => now }));
    await captured(() => runBillingCron(testPrisma, { invoiceClient: client, payuClient: null, clock: () => new Date(now.getTime() + 5 * MIN) }));
    assert.equal(mailAttempts, 1);
    await captured(() => runBillingCron(testPrisma, { invoiceClient: client, payuClient: null, clock: () => new Date(now.getTime() + 16 * MIN) }));
    assert.equal(mailAttempts, 2);
    assert.equal((await read(order.id)).invoiceEmailedAt, null);
  });

  test("skips the steps whose client is not configured", async () => {
    const ctx = await seed();
    const pending = await createOrder(ctx, { extra: { invoiceNextAttemptAt: new Date(Date.now() - MIN) } });
    const lost = await createOrder(ctx, {
      status: "PENDING_PAYMENT",
      invoiceStatus: "NOT_REQUIRED",
      payuOrderId: `PAYU-${randomUUID()}`,
      extra: { createdAt: new Date(Date.now() - 60 * MIN), updatedAt: new Date(Date.now() - 60 * MIN) },
    });
    const { result } = await captured(() => runBillingCron(testPrisma, { invoiceClient: null, payuClient: null }));
    assert.deepEqual(result, { invoicesProcessed: 0, ksefRefreshed: 0, emailsSent: 0, ordersSynced: 0, budgetExhausted: false });
    assert.equal((await read(pending.id)).invoiceStatus, "PENDING");
    assert.equal((await read(lost.id)).status, "PENDING_PAYMENT");
  });

  test("an order still waiting for payment is polled at most every 15 minutes", async () => {
    const ctx = await seed();
    const now = new Date();
    const waiting = await createOrder(ctx, {
      status: "PENDING_PAYMENT",
      invoiceStatus: "NOT_REQUIRED",
      payuOrderId: `PAYU-${randomUUID()}`,
      extra: { createdAt: new Date(now.getTime() - 60 * MIN), updatedAt: new Date(now.getTime() - 60 * MIN) },
    });
    let polls = 0;
    const payu = stubPayu(async () => {
      polls += 1;
      return { status: "PENDING", totalAmount: 2460, currencyCode: "PLN", extOrderId: waiting.id };
    });
    await captured(() => runBillingCron(testPrisma, { invoiceClient: null, payuClient: payu, clock: () => now }));
    await captured(() => runBillingCron(testPrisma, { invoiceClient: null, payuClient: payu, clock: () => new Date(now.getTime() + 5 * MIN) }));
    assert.equal(polls, 1);
    await captured(() => runBillingCron(testPrisma, { invoiceClient: null, payuClient: payu, clock: () => new Date(now.getTime() + 16 * MIN) }));
    assert.equal(polls, 2);
    assert.equal((await read(waiting.id)).status, "PENDING_PAYMENT");
  });

  test("PayU sync still runs when Fakturownia is not configured", async () => {
    const ctx = await seed();
    const lost = await createOrder(ctx, {
      status: "PENDING_PAYMENT",
      invoiceStatus: "NOT_REQUIRED",
      payuOrderId: `PAYU-${randomUUID()}`,
      extra: { createdAt: new Date(Date.now() - 60 * MIN), updatedAt: new Date(Date.now() - 60 * MIN) },
    });
    const payu = stubPayu(async () => ({ status: "COMPLETED", totalAmount: 2460, currencyCode: "PLN", extOrderId: lost.id }));
    const { result } = await captured(() => runBillingCron(testPrisma, { invoiceClient: null, payuClient: payu }));
    assert.equal(result.ordersSynced, 1);
    assert.equal(result.invoicesProcessed, 0);
    const row = await read(lost.id);
    assert.equal(row.status, "PAID");
    assert.equal(row.invoiceStatus, "PENDING");
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("waitFor timed out");
}

type Created = { id: string; number: string; token: string };

describe("claim ownership", () => {
  /** A claims at T, stalls inside createInvoice; B takes the stale claim over at T+11 min. */
  async function staleClaimScenario() {
    const ctx = await seed();
    const T = new Date();
    const tB = new Date(T.getTime() + 11 * MIN);
    const order = await createOrder(ctx, { extra: { invoiceNextAttemptAt: new Date(T.getTime() - MIN) } });
    const started: string[] = [];
    const gateA = deferred<Created>();
    const gateB = deferred<Created>();
    const emailsA: string[] = [];
    const clientA: FakturowniaClientLike = {
      ...stubClient().client,
      createInvoice: async () => {
        started.push("A");
        return gateA.promise;
      },
      sendInvoiceByEmail: async (id) => {
        emailsA.push(id);
      },
    };
    const clientB: FakturowniaClientLike = {
      ...stubClient().client,
      createInvoice: async () => {
        started.push("B");
        return gateB.promise;
      },
    };
    // One console capture for the whole scenario: the two workers overlap in time.
    const errorLog = mock.method(console, "error", () => {});
    const pA = processInvoice(testPrisma, order.id, { client: clientA, clock: () => T });
    await waitFor(() => started.includes("A"));
    const pB = processInvoice(testPrisma, order.id, { client: clientB, clock: () => tB });
    await waitFor(() => started.includes("B"));
    return {
      order,
      T,
      tB,
      gateA,
      gateB,
      pA,
      pB,
      emailsA,
      errors: () => errorLog.mock.calls.map((c) => c.arguments),
      restore: () => errorLog.mock.restore(),
    };
  }

  test("a late failure of the old owner does not touch the new owner's claim", async () => {
    const s = await staleClaimScenario();
    try {
      s.gateA.reject(new FakturowniaError("late", { code: "SERVER" }));
      assert.equal(await s.pA, "SKIPPED");
      assert.equal(s.errors().filter((e) => e[0] === "[INVOICE_CLAIM_LOST]").length, 1);

      const mid = await read(s.order.id);
      assert.equal(mid.invoiceStatus, "ISSUING");
      assert.equal(mid.invoiceClaimedAt?.getTime(), s.tB.getTime());
      assert.equal(mid.invoiceAttempts, 2);
      // untouched by the late failure: no backoff from A
      assert.equal(mid.invoiceNextAttemptAt?.getTime(), s.order.invoiceNextAttemptAt?.getTime());
      assert.equal(mid.invoiceLastError, null);

      s.gateB.resolve({ id: "INV-B", number: "FV/B", token: "tok-b" });
      assert.equal(await s.pB, "ISSUED");
      const row = await read(s.order.id);
      assert.equal(row.invoiceStatus, "ISSUED");
      assert.equal(row.fakturowniaInvoiceId, "INV-B");
    } finally {
      s.restore();
    }
  });

  test("a late DUPLICATE_OID of the old owner does not touch the new owner's claim", async () => {
    const s = await staleClaimScenario();
    try {
      s.gateA.reject(new FakturowniaError("dup", { code: "DUPLICATE_OID" }));
      assert.equal(await s.pA, "SKIPPED");
      assert.equal((await read(s.order.id)).invoiceStatus, "ISSUING");
      s.gateB.resolve({ id: "INV-B", number: "FV/B", token: "tok-b" });
      assert.equal(await s.pB, "ISSUED");
    } finally {
      s.restore();
    }
  });

  test("a late success of the old owner never overwrites the new owner's issued invoice", async () => {
    const s = await staleClaimScenario();
    try {
      s.gateB.resolve({ id: "INV-B", number: "FV/B", token: "tok-b" });
      assert.equal(await s.pB, "ISSUED");

      s.gateA.resolve({ id: "INV-A", number: "FV/A", token: "tok-a" });
      assert.equal(await s.pA, "NEEDS_ATTENTION");
      const lost = s.errors().filter((e) => e[0] === "[INVOICE_CLAIM_LOST]");
      assert.equal(lost.length, 1);
      assert.deepEqual(lost[0][1], { orderId: s.order.id, createdInvoiceId: "INV-A", createdNumber: "FV/A" });

      const row = await read(s.order.id);
      assert.equal(row.invoiceStatus, "ISSUED");
      assert.equal(row.fakturowniaInvoiceId, "INV-B");
      assert.equal(row.invoiceNumber, "FV/B");
      assert.equal(row.invoiceToken, "tok-b");
      assert.deepEqual(s.emailsA, []);
    } finally {
      s.restore();
    }
  });

  test("a late success of the old owner while the new owner is still in flight parks the order", async () => {
    const s = await staleClaimScenario();
    try {
      s.gateA.resolve({ id: "INV-A", number: "FV/A", token: "tok-a" });
      assert.equal(await s.pA, "NEEDS_ATTENTION");
      const row = await read(s.order.id);
      assert.equal(row.invoiceStatus, "NEEDS_ATTENTION");
      assert.equal(row.fakturowniaInvoiceId, null);
      assert.match(row.invoiceLastError ?? "", /FV\/A/);

      // The new owner's own success write is refused as well: two invoices may exist, a human decides.
      s.gateB.resolve({ id: "INV-B", number: "FV/B", token: "tok-b" });
      assert.equal(await s.pB, "NEEDS_ATTENTION");
      assert.equal((await read(s.order.id)).fakturowniaInvoiceId, null);
    } finally {
      s.restore();
    }
  });

  test("a database error after createInvoice logs the invoice and parks the order instead of retrying", async () => {
    const ctx = await seed();
    const order = await createOrder(ctx, { extra: { invoiceNextAttemptAt: new Date(Date.now() - MIN) } });
    const { client, calls } = stubClient();
    // 1 = claim, 2 = the success write (fails), 3 = parking the order
    let call = 0;
    const flakyDb = new Proxy(testPrisma, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target);
        if (prop !== "order") return value;
        return new Proxy(value, {
          get(orderTarget, orderProp) {
            const member = Reflect.get(orderTarget, orderProp, orderTarget);
            if (orderProp !== "updateMany") return typeof member === "function" ? member.bind(orderTarget) : member;
            return (args: unknown) => {
              call += 1;
              if (call === 2) throw new Error("db down");
              return member.call(orderTarget, args);
            };
          },
        });
      },
    });
    const outcome = await captured(() => processInvoice(flakyDb, order.id, { client }));
    assert.equal(outcome.result, "NEEDS_ATTENTION");
    assert.equal(calls.created.length, 1);
    const issueErrors = outcome.errors.filter((e) => e[0] === "[INVOICE_ISSUE_ERROR]");
    assert.equal(issueErrors.length, 1);
    const logged = issueErrors[0][1] as { createdInvoiceId: string; createdNumber: string };
    assert.ok(logged.createdInvoiceId.startsWith("INV-"));
    assert.equal(logged.createdNumber, "FV/1/10/2026");
    const row = await read(order.id);
    assert.equal(row.invoiceStatus, "NEEDS_ATTENTION");
    assert.equal(row.invoiceNextAttemptAt, null);
    assert.equal(row.fakturowniaInvoiceId, null);
    assert.match(row.invoiceLastError ?? "", /FV\/1\/10\/2026/);
  });
});

describe("per-item clock", () => {
  test("claim, issue time and backoff use the time of each step, not the start of a run", async () => {
    const ctx = await seed();
    let t = Date.now();
    const clock = () => new Date(t);
    const first = await createOrder(ctx, { extra: { invoiceNextAttemptAt: new Date(t - MIN) } });
    const second = await createOrder(ctx, { extra: { invoiceNextAttemptAt: new Date(t - MIN) } });
    const start = t;
    let n = 0;
    const { client } = stubClient({
      createInvoice: async (invoice) => {
        t += 10_000;
        n += 1;
        if (invoice.oid === second.id) throw new FakturowniaError("x", { code: "SERVER" });
        return { id: `INV-${n}`, number: `FV/${n}`, token: "t" };
      },
    });
    await captured(() => runBillingCron(testPrisma, { invoiceClient: client, payuClient: null, clock }));
    const rows = await Promise.all([read(first.id), read(second.id)]);
    const issued = rows.find((r) => r.invoiceStatus === "ISSUED")!;
    const failed = rows.find((r) => r.invoiceStatus === "FAILED")!;
    // Whichever ran second claimed 10 s after the run started; the failing one backs off from its failure time.
    assert.ok(issued.invoiceIssuedAt!.getTime() >= start + 10_000);
    assert.equal(failed.invoiceNextAttemptAt!.getTime(), start + (failed.id === first.id ? 10_000 : 20_000) + 5 * MIN);
  });
});

describe("cron safety", () => {
  test("a successful issue marks ksefCheckedAt so the cron does not touch the invoice in the same window", async () => {
    const ctx = await seed();
    const now = new Date();
    const order = await createOrder(ctx, { extra: { invoiceNextAttemptAt: new Date(now.getTime() - MIN) } });
    const { client, calls } = stubClient();
    await processInvoice(testPrisma, order.id, { client, clock: () => now });
    assert.equal((await read(order.id)).ksefCheckedAt?.getTime(), now.getTime());
    const { result } = await captured(() => runBillingCron(testPrisma, { invoiceClient: client, payuClient: null, clock: () => now }));
    assert.equal(result.ksefRefreshed, 0);
    assert.equal(calls.ksef.length, 0);
    assert.equal(calls.emails.length, 1);
  });

  test("two parallel cron runs send a pending e-mail once", async () => {
    const ctx = await seed();
    const now = new Date();
    const order = await issuedOrder(ctx, { invoiceIssuedAt: new Date(now.getTime() - 60 * MIN), ksefStatus: "ok" });
    let mails = 0;
    const { client } = stubClient({
      sendInvoiceByEmail: async () => {
        mails += 1;
        await new Promise((resolve) => setTimeout(resolve, 80));
      },
    });
    const runs = await captured(() =>
      Promise.all([
        runBillingCron(testPrisma, { invoiceClient: client, payuClient: null, clock: () => now }),
        runBillingCron(testPrisma, { invoiceClient: client, payuClient: null, clock: () => now }),
      ]),
    );
    assert.equal(mails, 1);
    assert.equal(runs.result[0].emailsSent + runs.result[1].emailsSent, 1);
    assert.ok((await read(order.id)).invoiceEmailedAt);
  });

  test("a 200 'status: error' e-mail refusal keeps invoiceEmailedAt null and the cron retries after KSeF ok", async () => {
    const ctx = await seed();
    const order = await createOrder(ctx, { extra: { invoiceNextAttemptAt: new Date(Date.now() - MIN) } });
    let sends = 0;
    const fetchImpl = (async (url: string | URL | Request) => {
      assert.match(String(url), /send_by_email/);
      sends += 1;
      const body = sends === 1 ? { status: "error", message: "Faktura nie może zostać wysłana - brak numeru KSeF" } : { status: "ok" };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const real = createFakturowniaClient({ domain: "izzy-test", apiToken: "tok", departmentId: null }, fetchImpl);
    const client: FakturowniaClientLike = { ...stubClient().client, sendInvoiceByEmail: real.sendInvoiceByEmail };

    const issuedAt = new Date();
    const first = await captured(() => processInvoice(testPrisma, order.id, { client, clock: () => issuedAt }));
    assert.equal(first.result, "ISSUED");
    let row = await read(order.id);
    assert.equal(row.invoiceEmailedAt, null);
    assert.match(row.invoiceLastError ?? "", /brak numeru KSeF/);

    const later = new Date(issuedAt.getTime() + 20 * MIN);
    const { result } = await captured(() => runBillingCron(testPrisma, { invoiceClient: client, payuClient: null, clock: () => later }));
    assert.equal(result.emailsSent, 1);
    assert.equal(sends, 2);
    row = await read(order.id);
    assert.equal(row.invoiceEmailedAt?.getTime(), later.getTime());
    assert.equal(row.invoiceLastError, null);
  });

  test("the time budget stops a run between items and is reported", async () => {
    const ctx = await seed();
    let t = Date.now();
    const clock = () => new Date(t);
    for (let i = 0; i < 3; i++) await createOrder(ctx, { extra: { invoiceNextAttemptAt: new Date(t - MIN) } });
    const { client, calls } = stubClient({
      createInvoice: async () => {
        t += 30_000;
        return { id: `INV-${randomUUID()}`, number: "FV/1", token: "t" };
      },
    });
    const { result } = await captured(() => runBillingCron(testPrisma, { invoiceClient: client, payuClient: null, clock }));
    assert.equal(result.invoicesProcessed, 2);
    assert.equal(result.budgetExhausted, true);
    assert.equal(calls.ksef.length, 0);
    assert.equal(await testPrisma.order.count({ where: { invoiceStatus: "PENDING" } }), 1);
  });

  test("KSeF is polled only for invoices issued within the last 30 days", async () => {
    const ctx = await seed();
    const now = new Date();
    const mk = (days: number) =>
      issuedOrder(ctx, {
        ksefStatus: "processing",
        ksefCheckedAt: new Date(now.getTime() - 60 * MIN),
        invoiceEmailedAt: new Date(now.getTime() - 60 * MIN),
        invoiceIssuedAt: new Date(now.getTime() - days * DAY),
      });
    const recent = await mk(29);
    const stale = await mk(31);
    const { client, calls } = stubClient();
    await captured(() => runBillingCron(testPrisma, { invoiceClient: client, payuClient: null, clock: () => now }));
    assert.deepEqual(calls.ksef, [recent.fakturowniaInvoiceId]);
    assert.equal((await read(stale.id)).ksefStatus, "processing");
  });

  test("invoices with a final non-mailable KSeF status never crowd out other candidates", async () => {
    const ctx = await seed();
    const now = new Date();
    for (let i = 0; i < 22; i++) {
      await issuedOrder(ctx, { ksefStatus: i % 2 ? "duplicate_error" : "demo_duplicate_error", invoiceIssuedAt: new Date(now.getTime() - 60 * MIN) });
    }
    const waiting = await issuedOrder(ctx, {
      ksefStatus: "processing",
      ksefCheckedAt: new Date(now.getTime() - 60 * MIN),
      invoiceIssuedAt: new Date(now.getTime() - 60 * MIN),
      invoiceEmailedAt: new Date(now.getTime() - 60 * MIN),
    });
    const { client, calls } = stubClient();
    const { result } = await captured(() => runBillingCron(testPrisma, { invoiceClient: client, payuClient: null, clock: () => now }));
    assert.deepEqual(calls.ksef, [waiting.fakturowniaInvoiceId]);
    assert.equal(result.ksefRefreshed, 1);
    assert.equal(calls.emails.length, 0);
  });
});
