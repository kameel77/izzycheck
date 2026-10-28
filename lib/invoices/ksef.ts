/**
 * What a KSeF status means for an order's invoice. Pure and free of runtime imports, so the service, the
 * admin API and the customer views share one definition.
 *
 * Fakturownia reports the status of the invoice in KSeF (gov_status); demo-mode accounts prefix it with
 * `demo_`. Only a handful of statuses are fine; everything else (send_error, server_error, status_check_error,
 * duplicate_error, blocked_403_error, not_connected, offline_error, any demo_* error) needs a human.
 */
import type { Prisma } from "@prisma/client";

const withDemo = (statuses: string[]): string[] => statuses.flatMap((status) => [status, `demo_${status}`]);

/** Healthy statuses: sent and accepted, being processed, issued offline (to be sent later) or not subject to KSeF. */
const OK_KSEF_STATUSES = withDemo(["ok", "processing", "offline", "not_applicable"]);
/** Still in flight: fine for a while, a problem when it lasts. */
const PROCESSING_KSEF_STATUSES = withDemo(["processing"]);
/** Statuses that never change any more (polling stops). duplicate_error is final but still a problem. */
export const FINAL_KSEF_STATUSES = [...withDemo(["ok", "not_applicable", "duplicate_error"])];
/** Final statuses in which the invoice can still be e-mailed. */
export const FINAL_MAILABLE_KSEF_STATUSES = withDemo(["ok", "not_applicable"]);
/** Statuses in which Fakturownia lets an invoice be e-mailed (a KSeF number is assigned or not needed). */
export const MAILABLE_KSEF_STATUSES = new Set(withDemo(["ok", "not_applicable", "offline"]));
/** Statuses in which the customer may be shown the invoice (OK and final enough that the invoice will not change). */
const CUSTOMER_VISIBLE_KSEF_STATUSES = new Set(withDemo(["ok", "offline", "not_applicable"]));

/** A KSeF status that stays null or "processing" for longer than this after issuing is suspicious. */
export const KSEF_STALE_AFTER_MS = 6 * 60 * 60_000;

export type KsefProblem = "ERROR" | "STALE";

export type KsefProblemInput = {
  invoiceStatus: string;
  fakturowniaInvoiceId: string | null;
  ksefStatus: string | null;
  invoiceIssuedAt: Date | null;
};

/** True when the KSeF status alone is an error (null and in-flight statuses are judged by age, see ksefProblem). */
export function isKsefErrorStatus(status: string | null): boolean {
  return status !== null && !OK_KSEF_STATUSES.includes(status);
}

/**
 * ERROR: KSeF reported a failure status. STALE: no status or still "processing" more than 6 h after issuing.
 * Only invoices issued through Fakturownia are tracked; manually marked invoices never have a problem here.
 */
export function ksefProblem(order: KsefProblemInput, now: Date): KsefProblem | null {
  if (order.invoiceStatus !== "ISSUED" || order.fakturowniaInvoiceId === null) return null;
  if (isKsefErrorStatus(order.ksefStatus)) return "ERROR";
  const inFlight = order.ksefStatus === null || PROCESSING_KSEF_STATUSES.includes(order.ksefStatus);
  if (inFlight && order.invoiceIssuedAt !== null && now.getTime() - order.invoiceIssuedAt.getTime() > KSEF_STALE_AFTER_MS) {
    return "STALE";
  }
  return null;
}

/** Database counterpart of ksefProblem: orders for which ksefProblem(order, now) is not null. */
export function ksefProblemWhere(now: Date): Prisma.OrderWhereInput {
  const staleBefore = new Date(now.getTime() - KSEF_STALE_AFTER_MS);
  return {
    invoiceStatus: "ISSUED",
    fakturowniaInvoiceId: { not: null },
    OR: [
      // notIn never matches a NULL status.
      { ksefStatus: { notIn: OK_KSEF_STATUSES } },
      { ksefStatus: null, invoiceIssuedAt: { lt: staleBefore } },
      { ksefStatus: { in: PROCESSING_KSEF_STATUSES }, invoiceIssuedAt: { lt: staleBefore } },
    ],
  };
}

/** The customer sees the invoice number/PDF only once KSeF is fine and final, or after it was e-mailed. */
export function isInvoiceVisibleToCustomer(order: { ksefStatus: string | null; invoiceEmailedAt: Date | null }): boolean {
  return order.invoiceEmailedAt !== null || (order.ksefStatus !== null && CUSTOMER_VISIBLE_KSEF_STATUSES.has(order.ksefStatus));
}
