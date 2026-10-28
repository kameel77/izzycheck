/**
 * Credit orders paid by bank transfer against a proforma invoice (Fakturownia).
 *
 * No money moves here: the order stays PENDING_PAYMENT and no credits are booked until an admin marks the
 * transfer as received. The proforma is issued synchronously; a proforma that exists in Fakturownia without a
 * usable order is harmless, so there is no outbox. The admin later marks the transfer as received
 * (markProformaPaid books the credits exactly once and queues the VAT invoice) or cancels the order.
 */
import type { OrderStatus, PrismaClient } from "@prisma/client";
import { buildProformaPayload } from "../invoices/fakturownia.ts";
import type { FakturowniaClient } from "../invoices/fakturownia.ts";
import { CheckoutError, bookOrderCredits, prepareOrder } from "./orders.ts";
import { PROFORMA_VALIDITY_DAYS, addDaysToDate, isValidYmd, warsawDate, ymdToDbDate } from "./proforma-dates.ts";

export type ProformaFakturowniaClient = Pick<FakturowniaClient, "createProforma" | "sendInvoiceByEmail">;

const PROFORMA_CREATE_FAILED = "Nie udało się wystawić proformy. Spróbuj ponownie.";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function createProformaOrder(
  db: PrismaClient,
  args: {
    user: { id: string; email: string; organizationId: string | null };
    items: Array<{ packageId: string; quantity: number }>;
    /** Gross total the buyer saw; when it differs from the freshly priced cart the order is refused. */
    expectedTotalGrossGrosze?: number;
    fakturownia: ProformaFakturowniaClient;
    departmentId: number | null;
    clock?: () => Date;
  },
): Promise<{ orderId: string; proformaNumber: string; proformaToken: string; proformaDueDate: string; emailed: boolean }> {
  const { user, items, expectedTotalGrossGrosze, fakturownia, departmentId } = args;
  const clock = args.clock ?? (() => new Date());

  const { organizationId, organization, priced } = await prepareOrder(db, { user, items, expectedTotalGrossGrosze });

  const issuedAt = clock();
  const proformaDueDate = addDaysToDate(warsawDate(issuedAt), PROFORMA_VALIDITY_DAYS);

  // Nested create: the order and its lines are written atomically.
  const order = await db.order.create({
    data: {
      organizationId,
      userId: user.id,
      status: "PENDING_PAYMENT",
      paymentMethod: "PROFORMA",
      totalNetGrosze: priced.totalNetGrosze,
      totalVatGrosze: priced.totalVatGrosze,
      totalGrossGrosze: priced.totalGrossGrosze,
      currency: "PLN",
      proformaDueDate: ymdToDbDate(proformaDueDate),
      items: { create: priced.lines },
    },
    select: { id: true },
  });

  // Conditional: never overwrites a status that something else already moved on. Best effort: never throws.
  const markFailed = () =>
    db.order
      .updateMany({ where: { id: order.id, status: "PENDING_PAYMENT" }, data: { status: "FAILED" } })
      .catch((markError) => console.error("[PROFORMA_CREATE_ERROR]", order.id, markError));

  let created: { id: string; number: string; token: string };
  try {
    const payload = buildProformaPayload(
      { id: order.id, totalGrossGrosze: priced.totalGrossGrosze, items: priced.lines },
      organization,
      departmentId,
      issuedAt,
    );
    created = await fakturownia.createProforma(payload);
  } catch (error) {
    console.error("[PROFORMA_CREATE_ERROR]", order.id, error);
    await markFailed();
    throw new CheckoutError(502, PROFORMA_CREATE_FAILED);
  }

  try {
    await db.order.update({
      where: { id: order.id },
      data: {
        proformaFakturowniaId: created.id,
        proformaNumber: created.number,
        proformaToken: created.token,
        proformaIssuedAt: issuedAt,
      },
    });
  } catch (error) {
    // The proforma exists in Fakturownia but is not recorded: log it so it can be found and ignored.
    console.error("[PROFORMA_SAVE_ERROR]", { orderId: order.id, proformaId: created.id, proformaNumber: created.number, error });
    await markFailed();
    throw new CheckoutError(502, PROFORMA_CREATE_FAILED);
  }

  // One attempt; a failure never spoils the order (the PDF is available in the app).
  const emailTo = organization.billingEmail.trim();
  const purchaser = user.email.trim();
  const emailCc = purchaser.toLowerCase() === emailTo.toLowerCase() ? [] : [purchaser];
  let emailed = false;
  try {
    await fakturownia.sendInvoiceByEmail(created.id, { emailTo: [emailTo], emailCc });
    emailed = true;
  } catch (error) {
    console.error("[PROFORMA_EMAIL_ERROR]", { orderId: order.id, message: describeError(error) });
    await db.order
      .update({ where: { id: order.id }, data: { proformaLastError: describeError(error) } })
      .catch((writeError) => console.error("[PROFORMA_EMAIL_ERROR]", { orderId: order.id, message: describeError(writeError) }));
  }
  if (emailed) {
    try {
      await db.order.update({ where: { id: order.id }, data: { proformaEmailedAt: clock() } });
    } catch (error) {
      // Sent, only the bookkeeping failed: the customer did get the e-mail, so this is not an e-mail error.
      console.error("[PROFORMA_SAVE_ERROR]", { orderId: order.id, step: "emailedAt", message: describeError(error) });
    }
  }

  return { orderId: order.id, proformaNumber: created.number, proformaToken: created.token, proformaDueDate, emailed };
}

export const MAX_PAYMENT_NOTE_LENGTH = 500;

export type OrderPaymentAction = { action: "markPaid"; paidDate: string; note: string | null } | { action: "cancel" };

/** Validates the body of POST /api/admin/orders/:id/payment. */
export function parseOrderPaymentAction(
  body: unknown,
): { ok: true; value: OrderPaymentAction } | { ok: false; error: string } {
  const input = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  switch (input.action) {
    case "cancel":
      return { ok: true, value: { action: "cancel" } };
    case "markPaid": {
      if (typeof input.paidDate !== "string" || !isValidYmd(input.paidDate)) {
        return { ok: false, error: "Nieprawidłowa data wpłaty." };
      }
      if (input.note !== undefined && input.note !== null && typeof input.note !== "string") {
        return { ok: false, error: "Nieprawidłowa notatka." };
      }
      const note = typeof input.note === "string" ? input.note.trim() : "";
      if (note.length > MAX_PAYMENT_NOTE_LENGTH) {
        return { ok: false, error: `Notatka może mieć najwyżej ${MAX_PAYMENT_NOTE_LENGTH} znaków.` };
      }
      return { ok: true, value: { action: "markPaid", paidDate: input.paidDate, note: note === "" ? null : note } };
    }
    default:
      return { ok: false, error: "Nieprawidłowa akcja." };
  }
}

const NOT_FOUND = "Nie znaleziono zamówienia.";
const NOT_A_PROFORMA = "Tę akcję można wykonać tylko dla zamówienia z wystawioną proformą.";
const NOT_MARKABLE = "Zamówienie jest już opłacone albo nie można go oznaczyć.";
const BAD_PAID_DATE = "Data wpłaty nie może być w przyszłości ani przed datą zamówienia.";
const NOT_CANCELABLE = "Anulować można tylko proformę oczekującą na wpłatę.";

/** The transfer came in even for a canceled order (R4), so CANCELED is payable; PAID and FAILED are not. */
const MARKABLE_STATUSES: OrderStatus[] = ["PENDING_PAYMENT", "CANCELED"];

/**
 * Admin confirms the transfer: PAID + credits + VAT invoice outbox (invoiceStatus PENDING) in ONE transaction.
 * The row lock serializes parallel clicks; the guarded updateMany is the second barrier, so the credits are
 * booked exactly once (and the idempotency key of every ledger entry is the third). Throws only on database
 * errors, which roll everything back.
 */
export async function markProformaPaid(
  db: PrismaClient,
  args: { orderId: string; paidDate: string; note: string | null; now: Date },
): Promise<{ ok: true } | { ok: false; status: 400 | 404 | 409; error: string }> {
  const { orderId, paidDate, note, now } = args;

  return db.$transaction(async (tx) => {
    // Row lock first: everything below acts on the state committed at the moment the lock was granted.
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
    if (locked.length === 0) return { ok: false as const, status: 404 as const, error: NOT_FOUND };

    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        id: true,
        organizationId: true,
        userId: true,
        paymentMethod: true,
        proformaFakturowniaId: true,
        proformaNumber: true,
        createdAt: true,
        items: { select: { creditType: true, creditsPerPackage: true, quantity: true }, orderBy: { id: "asc" } },
      },
    });
    if (order.paymentMethod !== "PROFORMA" || !order.proformaFakturowniaId) {
      return { ok: false as const, status: 409 as const, error: NOT_A_PROFORMA };
    }

    if (!isValidYmd(paidDate)) return { ok: false as const, status: 400 as const, error: "Nieprawidłowa data wpłaty." };
    if (paidDate < warsawDate(order.createdAt) || paidDate > warsawDate(now)) {
      return { ok: false as const, status: 400 as const, error: BAD_PAID_DATE };
    }

    const { count } = await tx.order.updateMany({
      where: { id: orderId, paymentMethod: "PROFORMA", status: { in: MARKABLE_STATUSES } },
      data: {
        status: "PAID",
        paidAt: new Date(`${paidDate}T12:00:00.000Z`),
        paymentNote: note,
        invoiceStatus: "PENDING",
        invoiceNextAttemptAt: now,
      },
    });
    if (count === 0) return { ok: false as const, status: 409 as const, error: NOT_MARKABLE };

    await bookOrderCredits(tx, order, `Zakup: proforma ${order.proformaNumber ?? order.proformaFakturowniaId} (przelew)`);
    return { ok: true as const };
  });
}

/** PROFORMA + PENDING_PAYMENT -> CANCELED. Fakturownia is not touched; a late transfer can still be marked paid. */
export async function cancelProformaOrder(
  db: PrismaClient,
  orderId: string,
): Promise<{ ok: true } | { ok: false; status: 404 | 409; error: string }> {
  const { count } = await db.order.updateMany({
    where: { id: orderId, paymentMethod: "PROFORMA", status: "PENDING_PAYMENT", proformaFakturowniaId: { not: null } },
    data: { status: "CANCELED" },
  });
  if (count === 1) return { ok: true };

  const exists = await db.order.findUnique({ where: { id: orderId }, select: { id: true } });
  return exists ? { ok: false, status: 409, error: NOT_CANCELABLE } : { ok: false, status: 404, error: NOT_FOUND };
}
