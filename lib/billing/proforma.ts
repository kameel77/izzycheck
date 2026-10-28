/**
 * Credit orders paid by bank transfer against a proforma invoice (Fakturownia).
 *
 * No money moves here: the order stays PENDING_PAYMENT and no credits are booked until an admin marks the
 * transfer as received. The proforma is issued synchronously; a proforma that exists in Fakturownia without a
 * usable order is harmless, so there is no outbox. The VAT invoice is not part of this step.
 */
import type { PrismaClient } from "@prisma/client";
import { buildProformaPayload } from "../invoices/fakturownia.ts";
import type { FakturowniaClient } from "../invoices/fakturownia.ts";
import { CheckoutError, prepareOrder } from "./orders.ts";
import { PROFORMA_VALIDITY_DAYS, addDaysToDate, warsawDate, ymdToDbDate } from "./proforma-dates.ts";

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

  // Conditional: never overwrites a status that something else already moved on.
  const markFailed = () =>
    db.order.updateMany({ where: { id: order.id, status: "PENDING_PAYMENT" }, data: { status: "FAILED" } });

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
    await markFailed().catch((markError) => console.error("[PROFORMA_CREATE_ERROR]", order.id, markError));
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
    await markFailed().catch(() => {});
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
    await db.order.update({ where: { id: order.id }, data: { proformaEmailedAt: clock() } });
  } catch (error) {
    console.error("[PROFORMA_EMAIL_ERROR]", { orderId: order.id, message: describeError(error) });
    if (emailed) {
      // Sent, only the bookkeeping failed: the customer did get the e-mail.
      return { orderId: order.id, proformaNumber: created.number, proformaToken: created.token, proformaDueDate, emailed: true };
    }
    await db.order
      .update({ where: { id: order.id }, data: { proformaLastError: describeError(error) } })
      .catch((writeError) => console.error("[PROFORMA_EMAIL_ERROR]", { orderId: order.id, message: describeError(writeError) }));
  }

  return { orderId: order.id, proformaNumber: created.number, proformaToken: created.token, proformaDueDate, emailed };
}
