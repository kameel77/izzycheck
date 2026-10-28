/**
 * Proactive signals for the admin: how many invoices need a human, when the billing cron last ran, and
 * configuration warnings. The cron writes a heartbeat row after every run; the panel turns a missing or old
 * heartbeat into a red "cron is not running" notice.
 */
import type { PrismaClient } from "@prisma/client";
import { ksefProblemWhere } from "./ksef.ts";
import { EMAIL_RETRY_WINDOW_MS, type BillingCronResult } from "./service.ts";

export const BILLING_CRON_JOB = "billing-cron";

export type OrdersAttention = {
  /** Invoices parked in NEEDS_ATTENTION. */
  needsAttention: number;
  /** FAILED invoices whose automatic retries ran out: only a manual retry helps. */
  failedManualOnly: number;
  /** ISSUED invoices with a KSeF problem (error status or no confirmation after 6 h). */
  ksefProblems: number;
  /** ISSUED invoices still not e-mailed after the whole e-mail retry window: the cron gave up, send them by hand. */
  emailOverdue: number;
  lastCronRunAt: string | null;
};

export async function getOrdersAttention(db: PrismaClient, now: Date): Promise<OrdersAttention> {
  const [needsAttention, failedManualOnly, ksefProblems, emailOverdue, heartbeat] = await Promise.all([
    db.order.count({ where: { invoiceStatus: "NEEDS_ATTENTION" } }),
    db.order.count({ where: { invoiceStatus: "FAILED", invoiceNextAttemptAt: null } }),
    db.order.count({ where: ksefProblemWhere(now) }),
    db.order.count({
      where: {
        invoiceStatus: "ISSUED",
        fakturowniaInvoiceId: { not: null },
        invoiceEmailedAt: null,
        invoiceIssuedAt: { lt: new Date(now.getTime() - EMAIL_RETRY_WINDOW_MS) },
      },
    }),
    db.jobHeartbeat.findUnique({ where: { name: BILLING_CRON_JOB }, select: { lastRunAt: true } }),
  ]);
  return {
    needsAttention,
    failedManualOnly,
    ksefProblems,
    emailOverdue,
    lastCronRunAt: heartbeat ? heartbeat.lastRunAt.toISOString() : null,
  };
}

/** Remembers that the billing cron just ran (and what it did). A failure here never fails the run. */
export async function recordCronHeartbeat(db: PrismaClient, result: BillingCronResult, now: Date): Promise<void> {
  try {
    const lastResultJson = JSON.stringify(result);
    await db.jobHeartbeat.upsert({
      where: { name: BILLING_CRON_JOB },
      create: { name: BILLING_CRON_JOB, lastRunAt: now, lastResultJson },
      update: { lastRunAt: now, lastResultJson },
    });
  } catch (error) {
    console.error("[BILLING_CRON]", { step: "heartbeat", message: error instanceof Error ? error.message : "unknown" });
  }
}

const SANDBOX_IN_PRODUCTION_WARNING =
  "Produkcja z włączonym sandboxem PayU (PAYU_ALLOW_SANDBOX=true) i fakturowaniem zamówień testowych (INVOICE_SANDBOX_ORDERS=true): płatności testowe wystawiają prawdziwe faktury. Wyłącz jedną z tych flag.";

let sandboxWarningLogged = false;

/** Configuration problems worth showing to an admin; the dangerous ones are also logged once per process. */
export function getInvoiceConfigWarnings(env: Record<string, string | undefined> = process.env): string[] {
  const warnings: string[] = [];
  if (env.NODE_ENV === "production" && env.PAYU_ALLOW_SANDBOX === "true" && env.INVOICE_SANDBOX_ORDERS === "true") {
    if (!sandboxWarningLogged) {
      sandboxWarningLogged = true;
      console.error("[INVOICE_SANDBOX_IN_PRODUCTION]", "PAYU_ALLOW_SANDBOX=true i INVOICE_SANDBOX_ORDERS=true na produkcji.");
    }
    warnings.push(SANDBOX_IN_PRODUCTION_WARNING);
  }
  return warnings;
}
