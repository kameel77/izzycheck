/**
 * How an order's invoice is exposed over the API. Customers get a collapsed state, the number and the PDF link
 * of an ISSUED invoice only once KSeF is fine and final (or the invoice was e-mailed); never the token, errors,
 * attempts or KSeF internals. Admins get the full picture
 * (still without the raw token: only the ready PDF link).
 */
import type { InvoiceStatus } from "@prisma/client";
import { getSharedFakturowniaClient } from "./fakturownia.ts";
import { isInvoiceVisibleToCustomer } from "./ksef.ts";

/** Builds the public PDF link for an invoice token; null when Fakturownia is not configured. */
export type PdfUrlBuilder = (token: string) => string | null;

export function sharedPdfUrlBuilder(): PdfUrlBuilder {
  const client = getSharedFakturowniaClient();
  return (token) => (client ? client.invoicePdfUrl(token) : null);
}

/** NOT_REQUIRED shows "—", ISSUED a number/link, everything else (incl. failures and KSeF in doubt) is "being prepared". */
export type CustomerInvoiceState = "NOT_REQUIRED" | "PENDING" | "ISSUED";

type InvoiceFields = {
  invoiceStatus: InvoiceStatus;
  invoiceNumber: string | null;
  invoiceToken: string | null;
  ksefStatus: string | null;
  invoiceEmailedAt: Date | null;
};

export type WithCustomerInvoice<T extends InvoiceFields> = Omit<T, keyof InvoiceFields> & {
  invoiceStatus: CustomerInvoiceState;
  invoiceNumber: string | null;
  invoicePdfUrl: string | null;
};

export function withCustomerInvoice<T extends InvoiceFields>(row: T, buildPdfUrl: PdfUrlBuilder): WithCustomerInvoice<T> {
  const { invoiceStatus, invoiceNumber, invoiceToken, ksefStatus, invoiceEmailedAt, ...rest } = row;
  if (invoiceStatus === "NOT_REQUIRED") {
    return { ...rest, invoiceStatus: "NOT_REQUIRED", invoiceNumber: null, invoicePdfUrl: null };
  }
  // The PDF of an invoice that KSeF rejected or has not confirmed yet could be a document that gets corrected
  // or replaced: it is shown only with a token and once KSeF is OK and final, or after it was e-mailed.
  if (invoiceStatus !== "ISSUED" || !invoiceToken || !isInvoiceVisibleToCustomer({ ksefStatus, invoiceEmailedAt })) {
    return { ...rest, invoiceStatus: "PENDING", invoiceNumber: null, invoicePdfUrl: null };
  }
  return { ...rest, invoiceStatus: "ISSUED", invoiceNumber, invoicePdfUrl: buildPdfUrl(invoiceToken) };
}

/** Admin: same as the stored row, but the raw token is replaced by the ready PDF link. */
export function withAdminInvoice<T extends { invoiceToken: string | null }>(
  row: T,
  buildPdfUrl: PdfUrlBuilder,
): Omit<T, "invoiceToken"> & { invoicePdfUrl: string | null } {
  const { invoiceToken, ...rest } = row;
  return { ...rest, invoicePdfUrl: invoiceToken ? buildPdfUrl(invoiceToken) : null };
}
