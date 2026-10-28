/**
 * Issuing invoices for paid orders, retrying failures, tracking the KSeF status and the billing cron.
 *
 * Money/legal-critical rules: an invoice is issued at most once per order. The only way into the ISSUING state
 * is the conditional updateMany in processInvoice (the serialization point for parallel callers: the PayU
 * notification, the order page and the cron); Fakturownia's oid_unique is the second barrier and a duplicate
 * answer parks the order in NEEDS_ATTENTION instead of retrying. Orders with invoiceStatus NOT_REQUIRED are
 * never selected: every candidate query filters by invoiceStatus. Every write after the claim is tied to
 * owning it (status ISSUING and the claimedAt this worker set), so a worker whose claim expired and was taken
 * over cannot overwrite the new owner's state.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { syncOrderWithPayu, type PayuClientLike } from "../billing/orders.ts";
import { buildInvoicePayload, FakturowniaError, getFakturowniaConfig, type FakturowniaClient } from "./fakturownia.ts";

export type FakturowniaClientLike = Pick<FakturowniaClient, "createInvoice" | "sendInvoiceByEmail" | "getInvoiceKsef">;

/** Source of "now". Injected in tests; every unit of work reads it afresh so long runs never use stale times. */
export type Clock = () => Date;
const systemClock: Clock = () => new Date();

/** An ISSUING claim older than this is considered abandoned (the worker died) and may be taken over. */
const CLAIM_TIMEOUT_MS = 10 * 60_000;
const RETRY_BASE_MS = 5 * 60_000;
const RETRY_MAX_MS = 24 * 60 * 60_000;
const MAX_ATTEMPTS = 10;

const CRON_BATCH_SIZE = 20;
/** No new unit of work is started once a cron run has taken this long (checked between units). */
const CRON_BUDGET_MS = 45_000;
/** Minimum pause between two KSeF refreshes / e-mail retries of one invoice, and the PayU sync grace period. */
const CRON_RECHECK_MS = 15 * 60_000;
/** How long after issuing the e-mail is still retried. */
const EMAIL_RETRY_WINDOW_MS = 3 * 24 * 60 * 60_000;
/** How long after issuing the KSeF status is still polled. */
const KSEF_POLL_WINDOW_MS = 30 * 24 * 60 * 60_000;
const PAYU_SYNC_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

const MAX_ERROR_LENGTH = 500;
const DUPLICATE_OID_MESSAGE = "Faktura z tym numerem zamówienia już istnieje w Fakturowni — sprawdź i oznacz ręcznie.";
const GENERIC_ERROR_MESSAGE = "Nieoczekiwany błąd podczas wystawiania faktury.";

/** KSeF statuses that never change any more. */
const FINAL_KSEF_STATUSES = ["ok", "demo_ok", "not_applicable", "duplicate_error", "demo_duplicate_error"];
/** Final statuses in which the invoice can still be e-mailed. */
const FINAL_MAILABLE_KSEF_STATUSES = ["ok", "demo_ok", "not_applicable"];
/** KSeF statuses that mean something is wrong and needs a human. */
const KSEF_ERROR_STATUSES = new Set(["send_error", "blocked_403_error", "not_connected", "offline_error"]);
/** Statuses in which Fakturownia lets an invoice be e-mailed (a KSeF number is assigned or not needed). */
const MAILABLE_KSEF_STATUSES = new Set(["ok", "demo_ok", "not_applicable", "offline", "demo_offline"]);

/** Delay before the next attempt after the given (already counted) failed attempt; null once retries are exhausted. */
export function invoiceRetryDelayMs(attempts: number): number | null {
  if (attempts >= MAX_ATTEMPTS) return null;
  return Math.min(RETRY_BASE_MS * 2 ** (attempts - 1), RETRY_MAX_MS);
}

function describeError(error: unknown): string {
  if (error instanceof FakturowniaError) return error.message.slice(0, MAX_ERROR_LENGTH);
  // Our own invariant errors are plain Errors with Polish messages; Prisma and other errors are not shown.
  if (error instanceof Error && error.name === "Error") return error.message.slice(0, MAX_ERROR_LENGTH);
  return GENERIC_ERROR_MESSAGE;
}

function dueWhere(now: Date): Prisma.OrderWhereInput {
  return {
    OR: [
      { invoiceStatus: { in: ["PENDING", "FAILED"] }, invoiceNextAttemptAt: { lte: now } },
      { invoiceStatus: "ISSUING", invoiceClaimedAt: { lt: new Date(now.getTime() - CLAIM_TIMEOUT_MS) } },
    ],
  };
}

export type ProcessInvoiceResult = "ISSUED" | "SKIPPED" | "FAILED" | "NEEDS_ATTENTION" | "NOT_CONFIGURED";

export async function processInvoice(
  db: PrismaClient,
  orderId: string,
  deps: {
    client: FakturowniaClientLike | null;
    clock?: Clock;
    /** Defaults to FAKTUROWNIA_DEPARTMENT_ID from the environment. */
    departmentId?: number | null;
  },
): Promise<ProcessInvoiceResult> {
  const { client } = deps;
  if (!client) return "NOT_CONFIGURED";
  const clock = deps.clock ?? systemClock;

  // The conditional claim decides who issues: parallel callers get count 0 and leave.
  const claimedAt = clock();
  const claim = await db.order.updateMany({
    where: { id: orderId, ...dueWhere(claimedAt) },
    data: { invoiceStatus: "ISSUING", invoiceClaimedAt: claimedAt, invoiceAttempts: { increment: 1 } },
  });
  if (claim.count === 0) return "SKIPPED";
  // Proof of ownership for every later write: a takeover changes invoiceClaimedAt.
  const owned: Prisma.OrderWhereInput = { id: orderId, invoiceStatus: "ISSUING", invoiceClaimedAt: claimedAt };

  let created: { id: string; number: string; token: string };
  try {
    const order = await db.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        id: true,
        paidAt: true,
        totalGrossGrosze: true,
        items: {
          select: { packageName: true, quantity: true, vatRate: true, lineGrossGrosze: true },
          orderBy: { id: "asc" },
        },
        organization: {
          select: { name: true, nip: true, street: true, postalCode: true, city: true, country: true, billingEmail: true },
        },
      },
    });
    const departmentId = deps.departmentId !== undefined ? deps.departmentId : (getFakturowniaConfig()?.departmentId ?? null);
    const payload = buildInvoicePayload(order, order.organization, departmentId, clock());
    created = await client.createInvoice(payload);
  } catch (error) {
    return recordIssueFailure(db, orderId, owned, error, clock);
  }

  // The invoice exists in Fakturownia from here on: never retry, never lose track of it.
  try {
    const issuedAt = clock();
    const saved = await db.order.updateMany({
      where: { ...owned, fakturowniaInvoiceId: null },
      data: {
        invoiceStatus: "ISSUED",
        fakturowniaInvoiceId: created.id,
        invoiceNumber: created.number,
        invoiceToken: created.token,
        invoiceIssuedAt: issuedAt,
        // The first KSeF check / e-mail retry of the cron comes a full pause after issuing.
        ksefCheckedAt: issuedAt,
        invoiceLastError: null,
        invoiceNextAttemptAt: null,
        invoiceClaimedAt: null,
      },
    });
    if (saved.count === 0) {
      console.error("[INVOICE_CLAIM_LOST]", { orderId, createdInvoiceId: created.id, createdNumber: created.number });
      await parkCreatedInvoice(db, orderId, created.number);
      return "NEEDS_ATTENTION";
    }
  } catch (error) {
    // Logged before any further database work, so the invoice can be reconciled by hand even if the DB is down.
    console.error("[INVOICE_ISSUE_ERROR]", {
      orderId,
      message: describeError(error),
      createdInvoiceId: created.id,
      createdNumber: created.number,
    });
    await parkCreatedInvoice(db, orderId, created.number);
    return "NEEDS_ATTENTION";
  }

  await sendInvoiceEmail(db, orderId, { client, clock });
  return "ISSUED";
}

/** An invoice was created in Fakturownia but could not be recorded: park the order, never overwrite an existing id. */
async function parkCreatedInvoice(db: PrismaClient, orderId: string, invoiceNumber: string): Promise<void> {
  await db.order.updateMany({
    where: { id: orderId, fakturowniaInvoiceId: null },
    data: {
      invoiceStatus: "NEEDS_ATTENTION",
      invoiceLastError: `Faktura ${invoiceNumber} została wystawiona w Fakturowni, ale nie udało się jej zapisać — sprawdź i oznacz ręcznie.`,
      invoiceNextAttemptAt: null,
      invoiceClaimedAt: null,
    },
  });
}

async function recordIssueFailure(
  db: PrismaClient,
  orderId: string,
  owned: Prisma.OrderWhereInput,
  error: unknown,
  clock: Clock,
): Promise<"FAILED" | "NEEDS_ATTENTION" | "SKIPPED"> {
  if (error instanceof FakturowniaError && error.code === "DUPLICATE_OID") {
    console.error("[INVOICE_DUPLICATE_OID]", { orderId });
    const parked = await db.order.updateMany({
      where: owned,
      data: {
        invoiceStatus: "NEEDS_ATTENTION",
        invoiceLastError: DUPLICATE_OID_MESSAGE,
        invoiceNextAttemptAt: null,
        invoiceClaimedAt: null,
      },
    });
    if (parked.count === 0) {
      console.error("[INVOICE_CLAIM_LOST]", { orderId });
      return "SKIPPED";
    }
    return "NEEDS_ATTENTION";
  }

  const message = describeError(error);
  const row = await db.order.findFirst({ where: owned, select: { invoiceAttempts: true } });
  if (!row) {
    console.error("[INVOICE_CLAIM_LOST]", { orderId, message });
    return "SKIPPED";
  }
  console.error("[INVOICE_ISSUE_ERROR]", {
    orderId,
    attempt: row.invoiceAttempts,
    code: error instanceof FakturowniaError ? error.code : undefined,
    message,
  });
  const delay = invoiceRetryDelayMs(row.invoiceAttempts);
  const failed = await db.order.updateMany({
    where: owned,
    data: {
      invoiceStatus: "FAILED",
      invoiceLastError: message,
      invoiceNextAttemptAt: delay === null ? null : new Date(clock().getTime() + delay),
      invoiceClaimedAt: null,
    },
  });
  if (failed.count === 0) {
    console.error("[INVOICE_CLAIM_LOST]", { orderId, message });
    return "SKIPPED";
  }
  return "FAILED";
}

/**
 * E-mails an ISSUED invoice that was not e-mailed yet (billingEmail, purchaser in cc when different). A failure
 * is logged and kept in invoiceLastError; it never throws and never changes the invoice status.
 * Returns true only when the e-mail was sent.
 */
export async function sendInvoiceEmail(
  db: PrismaClient,
  orderId: string,
  deps: { client: FakturowniaClientLike; clock?: Clock },
): Promise<boolean> {
  const clock = deps.clock ?? systemClock;
  try {
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        invoiceStatus: true,
        fakturowniaInvoiceId: true,
        invoiceEmailedAt: true,
        organization: { select: { billingEmail: true } },
        user: { select: { email: true } },
      },
    });
    if (!order || order.invoiceStatus !== "ISSUED" || !order.fakturowniaInvoiceId || order.invoiceEmailedAt) return false;
    const invoiceId = order.fakturowniaInvoiceId;
    // Bookkeeping only for the invoice that was actually e-mailed.
    const sameInvoice = { id: orderId, fakturowniaInvoiceId: invoiceId, invoiceEmailedAt: null };

    const emailTo = order.organization.billingEmail.trim();
    const purchaser = order.user.email.trim();
    const emailCc = purchaser.toLowerCase() === emailTo.toLowerCase() ? [] : [purchaser];
    try {
      await deps.client.sendInvoiceByEmail(invoiceId, { emailTo: [emailTo], emailCc });
    } catch (error) {
      const message = describeError(error);
      console.error("[INVOICE_EMAIL_ERROR]", { orderId, code: error instanceof FakturowniaError ? error.code : undefined, message });
      await db.order.updateMany({ where: sameInvoice, data: { invoiceLastError: message } });
      return false;
    }
    await db.order.updateMany({ where: sameInvoice, data: { invoiceEmailedAt: clock(), invoiceLastError: null } });
    return true;
  } catch (error) {
    console.error("[INVOICE_EMAIL_ERROR]", { orderId, message: describeError(error) });
    return false;
  }
}

export type RefreshKsefResult = {
  /** SKIPPED: nothing to do (not ISSUED, or the KSeF status is already final). ERROR: Fakturownia call failed. */
  result: "REFRESHED" | "SKIPPED" | "ERROR";
  /** The KSeF status known after the call (stored one when nothing was fetched). */
  ksefStatus: string | null;
};

export async function refreshKsefStatus(
  db: PrismaClient,
  orderId: string,
  deps: { client: FakturowniaClientLike; clock?: Clock },
): Promise<RefreshKsefResult> {
  const clock = deps.clock ?? systemClock;
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { invoiceStatus: true, fakturowniaInvoiceId: true, ksefStatus: true },
  });
  const stored = order?.ksefStatus ?? null;
  if (!order || order.invoiceStatus !== "ISSUED" || !order.fakturowniaInvoiceId) return { result: "SKIPPED", ksefStatus: stored };
  if (stored !== null && FINAL_KSEF_STATUSES.includes(stored)) return { result: "SKIPPED", ksefStatus: stored };

  try {
    const info = await deps.client.getInvoiceKsef(order.fakturowniaInvoiceId);
    await db.order.update({
      where: { id: orderId },
      data: {
        ksefStatus: info.govStatus,
        ksefId: info.govId,
        ksefVerificationLink: info.verificationLink,
        ksefCheckedAt: clock(),
      },
    });
    if (info.govStatus !== null && KSEF_ERROR_STATUSES.has(info.govStatus)) {
      console.error("[INVOICE_KSEF_ERROR]", {
        orderId,
        govStatus: info.govStatus,
        errors: info.errors.slice(0, 5).map((message) => message.slice(0, 300)),
      });
    }
    return { result: "REFRESHED", ksefStatus: info.govStatus };
  } catch (error) {
    console.error("[INVOICE_KSEF_ERROR]", { orderId, message: describeError(error) });
    // Bump the check time so a failing invoice is not hammered on every cron run.
    await db.order.updateMany({ where: { id: orderId }, data: { ksefCheckedAt: clock() } }).catch(() => {});
    return { result: "ERROR", ksefStatus: stored };
  }
}

export type BillingCronResult = {
  invoicesProcessed: number;
  ksefRefreshed: number;
  emailsSent: number;
  ordersSynced: number;
  /** True when the run stopped early because its time budget ran out; the rest waits for the next pass. */
  budgetExhausted: boolean;
};

/**
 * One billing cron pass. Each step is independent and skipped when its client is not configured:
 * (a) issue/retry due invoices, (b) refresh KSeF statuses and retry invoice e-mails, (c) poll PayU for lost
 * payments (an order paid here gets its invoice on the next pass). No new unit of work starts after 45 s.
 */
export async function runBillingCron(
  db: PrismaClient,
  deps: {
    invoiceClient: FakturowniaClientLike | null;
    payuClient: PayuClientLike | null;
    clock?: Clock;
    departmentId?: number | null;
  },
): Promise<BillingCronResult> {
  const { invoiceClient, payuClient } = deps;
  const clock = deps.clock ?? systemClock;
  const startedAt = clock().getTime();
  const result: BillingCronResult = { invoicesProcessed: 0, ksefRefreshed: 0, emailsSent: 0, ordersSynced: 0, budgetExhausted: false };

  /** True (and remembered) once the budget is used up; checked between units of work, across all steps. */
  const outOfBudget = (): boolean => {
    if (!result.budgetExhausted && clock().getTime() - startedAt >= CRON_BUDGET_MS) result.budgetExhausted = true;
    return result.budgetExhausted;
  };

  if (invoiceClient) {
    const due = await db.order.findMany({
      where: dueWhere(clock()),
      select: { id: true },
      orderBy: { updatedAt: "asc" },
      take: CRON_BATCH_SIZE,
    });
    for (const { id } of due) {
      if (outOfBudget()) break;
      try {
        const outcome = await processInvoice(db, id, { client: invoiceClient, clock, departmentId: deps.departmentId });
        if (outcome === "ISSUED" || outcome === "FAILED" || outcome === "NEEDS_ATTENTION") result.invoicesProcessed += 1;
      } catch (error) {
        console.error("[BILLING_CRON]", { step: "invoice", orderId: id, message: describeError(error) });
      }
    }
  }

  if (invoiceClient && !outOfBudget()) {
    const listedAt = clock();
    const emailWindowStart = new Date(listedAt.getTime() - EMAIL_RETRY_WINDOW_MS);
    const issued = await db.order.findMany({
      where: {
        invoiceStatus: "ISSUED",
        fakturowniaInvoiceId: { not: null },
        invoiceIssuedAt: { gte: new Date(listedAt.getTime() - KSEF_POLL_WINDOW_MS) },
        AND: [
          { OR: [{ ksefCheckedAt: null }, { ksefCheckedAt: { lt: new Date(listedAt.getTime() - CRON_RECHECK_MS) } }] },
          {
            OR: [
              { ksefStatus: null },
              { ksefStatus: { notIn: FINAL_KSEF_STATUSES } },
              // Final status: only worth a visit while an e-mail is still pending and possible.
              { ksefStatus: { in: FINAL_MAILABLE_KSEF_STATUSES }, invoiceEmailedAt: null, invoiceIssuedAt: { gte: emailWindowStart } },
            ],
          },
        ],
      },
      select: { id: true, invoiceEmailedAt: true, invoiceIssuedAt: true },
      orderBy: { ksefCheckedAt: { sort: "asc", nulls: "first" } },
      take: CRON_BATCH_SIZE,
    });
    for (const order of issued) {
      if (outOfBudget()) break;
      try {
        // Claim the visit: parallel runs and the 15 min pause both hinge on this conditional bump.
        const claimedAt = clock();
        const claim = await db.order.updateMany({
          where: {
            id: order.id,
            invoiceStatus: "ISSUED",
            OR: [{ ksefCheckedAt: null }, { ksefCheckedAt: { lt: new Date(claimedAt.getTime() - CRON_RECHECK_MS) } }],
          },
          data: { ksefCheckedAt: claimedAt },
        });
        if (claim.count === 0) continue;

        const refresh = await refreshKsefStatus(db, order.id, { client: invoiceClient, clock });
        if (refresh.result === "REFRESHED") result.ksefRefreshed += 1;

        const wantsEmail =
          order.invoiceEmailedAt === null && order.invoiceIssuedAt !== null && order.invoiceIssuedAt >= emailWindowStart;
        const mailable = refresh.ksefStatus === null || MAILABLE_KSEF_STATUSES.has(refresh.ksefStatus);
        if (wantsEmail && refresh.result !== "ERROR" && mailable) {
          if (await sendInvoiceEmail(db, order.id, { client: invoiceClient, clock })) result.emailsSent += 1;
        }
      } catch (error) {
        console.error("[BILLING_CRON]", { step: "ksef", orderId: order.id, message: describeError(error) });
      }
    }
  }

  if (payuClient && !outOfBudget()) {
    const listedAt = clock();
    const lost = await db.order.findMany({
      where: {
        status: "PENDING_PAYMENT",
        payuOrderId: { not: null },
        createdAt: { lt: new Date(listedAt.getTime() - CRON_RECHECK_MS), gt: new Date(listedAt.getTime() - PAYU_SYNC_MAX_AGE_MS) },
        updatedAt: { lt: new Date(listedAt.getTime() - CRON_RECHECK_MS) },
      },
      select: { id: true },
      orderBy: { updatedAt: "asc" },
      take: CRON_BATCH_SIZE,
    });
    for (const { id } of lost) {
      if (outOfBudget()) break;
      try {
        // Unpaid orders stay PENDING_PAYMENT and would be polled on every pass (starving newer ones): touching
        // updatedAt first both rotates the batch and enforces the 15 min pause between polls of one order.
        await db.order.updateMany({ where: { id, status: "PENDING_PAYMENT" }, data: { updatedAt: clock() } });
        const sync = await syncOrderWithPayu(db, id, payuClient);
        if (sync.synced) result.ordersSynced += 1;
      } catch (error) {
        console.error("[BILLING_CRON]", { step: "payu-sync", orderId: id, message: describeError(error) });
      }
    }
  }

  return result;
}
