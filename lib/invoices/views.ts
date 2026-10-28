/**
 * How an order's invoice is exposed over the API. Customers get a collapsed state, the number and the PDF link
 * of an ISSUED invoice only; never the token, errors, attempts or KSeF internals. Admins get the full picture
 * (still without the raw token: only the ready PDF link).
 */
import type { InvoiceStatus } from "@prisma/client";
import { getSharedFakturowniaClient } from "./fakturownia.ts";

/** Builds the public PDF link for an invoice token; null when Fakturownia is not configured. */
export type PdfUrlBuilder = (token: string) => string | null;

export function sharedPdfUrlBuilder(): PdfUrlBuilder {
  const client = getSharedFakturowniaClient();
  return (token) => (client ? client.invoicePdfUrl(token) : null);
}

/** NOT_REQUIRED shows "—", ISSUED a number/link, everything else (incl. failures) is just "being prepared". */
export type CustomerInvoiceState = "NOT_REQUIRED" | "PENDING" | "ISSUED";

type InvoiceFields = { invoiceStatus: InvoiceStatus; invoiceNumber: string | null; invoiceToken: string | null };

export type WithCustomerInvoice<T extends InvoiceFields> = Omit<T, keyof InvoiceFields> & {
  invoiceStatus: CustomerInvoiceState;
  invoiceNumber: string | null;
  invoicePdfUrl: string | null;
};

export function withCustomerInvoice<T extends InvoiceFields>(row: T, buildPdfUrl: PdfUrlBuilder): WithCustomerInvoice<T> {
  const { invoiceStatus, invoiceNumber, invoiceToken, ...rest } = row;
  if (invoiceStatus === "NOT_REQUIRED") {
    return { ...rest, invoiceStatus: "NOT_REQUIRED", invoiceNumber: null, invoicePdfUrl: null };
  }
  if (invoiceStatus !== "ISSUED") {
    return { ...rest, invoiceStatus: "PENDING", invoiceNumber: null, invoicePdfUrl: null };
  }
  // A manually issued invoice has no token: the number is shown without a link.
  return { ...rest, invoiceStatus: "ISSUED", invoiceNumber, invoicePdfUrl: invoiceToken ? buildPdfUrl(invoiceToken) : null };
}

/** Admin: same as the stored row, but the raw token is replaced by the ready PDF link. */
export function withAdminInvoice<T extends { invoiceToken: string | null }>(
  row: T,
  buildPdfUrl: PdfUrlBuilder,
): Omit<T, "invoiceToken"> & { invoicePdfUrl: string | null } {
  const { invoiceToken, ...rest } = row;
  return { ...rest, invoicePdfUrl: invoiceToken ? buildPdfUrl(invoiceToken) : null };
}
