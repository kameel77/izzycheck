/**
 * Admin actions on an order's invoice (POST /api/admin/orders/:id/invoice). Transitions are conditional
 * updateMany calls: the status AND "nobody is issuing right now" are part of the WHERE, so a click racing the
 * cron or another admin changes nothing and is reported as a conflict.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { CLAIM_TIMEOUT_MS } from "./service.ts";

export const MAX_MANUAL_INVOICE_NUMBER_LENGTH = 64;

export type InvoiceAction =
  | { action: "retry" }
  | { action: "markManual"; invoiceNumber: string }
  | { action: "refreshKsef" }
  | { action: "markEmailed" };

export type InvoiceActionParseResult = { ok: true; value: InvoiceAction } | { ok: false; error: string };

/** Validates the body of an admin invoice action. */
export function parseInvoiceAction(body: unknown): InvoiceActionParseResult {
  const input = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  switch (input.action) {
    case "retry":
      return { ok: true, value: { action: "retry" } };
    case "refreshKsef":
      return { ok: true, value: { action: "refreshKsef" } };
    case "markEmailed":
      return { ok: true, value: { action: "markEmailed" } };
    case "markManual": {
      const invoiceNumber = typeof input.invoiceNumber === "string" ? input.invoiceNumber.trim() : "";
      if (invoiceNumber.length < 1 || invoiceNumber.length > MAX_MANUAL_INVOICE_NUMBER_LENGTH) {
        return { ok: false, error: "Podaj numer faktury (1–64 znaki)." };
      }
      return { ok: true, value: { action: "markManual", invoiceNumber } };
    }
    default:
      return { ok: false, error: "Nieprawidłowa akcja." };
  }
}

export type InvoiceTransitionResult = { ok: true } | { ok: false; status: 404 | 409; error: string };

const LIVE_CLAIM_MESSAGE = "Faktura jest właśnie wystawiana — spróbuj za kilka minut.";
const WRONG_STATUS_MESSAGE = "Ta akcja jest możliwa tylko dla faktur w statusie „Błąd” lub „Wymaga sprawdzenia”.";

/** FAILED / NEEDS_ATTENTION with no live claimant (no claim, or one old enough to be considered abandoned). */
function resolvableWhere(orderId: string, now: Date): Prisma.OrderWhereInput {
  return {
    id: orderId,
    invoiceStatus: { in: ["FAILED", "NEEDS_ATTENTION"] },
    OR: [{ invoiceClaimedAt: null }, { invoiceClaimedAt: { lt: new Date(now.getTime() - CLAIM_TIMEOUT_MS) } }],
  };
}

/** Why a conditional transition matched nothing. */
async function explainRefusal(db: PrismaClient, orderId: string): Promise<InvoiceTransitionResult & { ok: false }> {
  const order = await db.order.findUnique({ where: { id: orderId }, select: { invoiceStatus: true } });
  if (!order) return { ok: false, status: 404, error: "Nie znaleziono zamówienia." };
  if (order.invoiceStatus === "FAILED" || order.invoiceStatus === "NEEDS_ATTENTION") {
    return { ok: false, status: 409, error: LIVE_CLAIM_MESSAGE };
  }
  return { ok: false, status: 409, error: WRONG_STATUS_MESSAGE };
}

/** FAILED/NEEDS_ATTENTION -> PENDING, due now, attempts reset. The caller then runs processInvoice. */
export async function retryInvoice(db: PrismaClient, orderId: string, now: Date): Promise<InvoiceTransitionResult> {
  const updated = await db.order.updateMany({
    where: resolvableWhere(orderId, now),
    data: { invoiceStatus: "PENDING", invoiceNextAttemptAt: now, invoiceAttempts: 0, invoiceLastError: null },
  });
  return updated.count === 1 ? { ok: true } : explainRefusal(db, orderId);
}

/** FAILED/NEEDS_ATTENTION -> ISSUED with a hand-typed number; no token and no Fakturownia id. */
export async function markInvoiceManual(
  db: PrismaClient,
  orderId: string,
  invoiceNumber: string,
  now: Date,
): Promise<InvoiceTransitionResult> {
  const updated = await db.order.updateMany({
    where: resolvableWhere(orderId, now),
    data: {
      invoiceStatus: "ISSUED",
      invoiceNumber,
      invoiceIssuedAt: now,
      invoiceToken: null,
      invoiceLastError: null,
      invoiceNextAttemptAt: null,
      invoiceClaimedAt: null,
    },
  });
  return updated.count === 1 ? { ok: true } : explainRefusal(db, orderId);
}

const EMAILED_REFUSAL_MESSAGE = "E-mail z tą fakturą jest już oznaczony jako wysłany albo faktura nie jest wystawiona.";

/**
 * ISSUED + not yet e-mailed -> invoiceEmailedAt = now: the admin sent the invoice by hand from Fakturownia.
 * The status and the "not e-mailed yet" condition are part of the WHERE, so a click racing the cron's own
 * e-mail (or a second admin) changes nothing and is reported as a conflict. Needs no Fakturownia access and
 * leaves invoiceLastError (extra-invoice notes) alone.
 */
export async function markInvoiceEmailedManually(db: PrismaClient, orderId: string, now: Date): Promise<InvoiceTransitionResult> {
  const updated = await db.order.updateMany({
    where: { id: orderId, invoiceStatus: "ISSUED", invoiceEmailedAt: null },
    data: { invoiceEmailedAt: now },
  });
  if (updated.count === 1) return { ok: true };

  const exists = await db.order.findUnique({ where: { id: orderId }, select: { id: true } });
  return exists ? { ok: false, status: 409, error: EMAILED_REFUSAL_MESSAGE } : { ok: false, status: 404, error: "Nie znaleziono zamówienia." };
}
