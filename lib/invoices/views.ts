/**
 * How an order's invoice is exposed over the API. Customers get a collapsed state, the number and the PDF link
 * of an ISSUED invoice only once KSeF is fine and final (or the invoice was e-mailed); never the token, errors,
 * attempts or KSeF internals. Admins get the full picture
 * (still without the raw token: only the ready PDF link).
 */
import type { InvoiceStatus } from "@prisma/client";
import { getSharedFakturowniaClient } from "./fakturownia.ts";
import { dbDateToYmd } from "../billing/proforma-dates.ts";
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
  fakturowniaInvoiceId: string | null;
  ksefStatus: string | null;
  invoiceEmailedAt: Date | null;
};

export type WithCustomerInvoice<T extends InvoiceFields> = Omit<T, keyof InvoiceFields> & {
  invoiceStatus: CustomerInvoiceState;
  invoiceNumber: string | null;
  invoicePdfUrl: string | null;
};

export function withCustomerInvoice<T extends InvoiceFields>(row: T, buildPdfUrl: PdfUrlBuilder): WithCustomerInvoice<T> {
  const { invoiceStatus, invoiceNumber, invoiceToken, fakturowniaInvoiceId, ksefStatus, invoiceEmailedAt, ...rest } = row;
  if (invoiceStatus === "NOT_REQUIRED") {
    return { ...rest, invoiceStatus: "NOT_REQUIRED", invoiceNumber: null, invoicePdfUrl: null };
  }
  // Issued by hand (no Fakturownia id): the admin sends the document himself, the customer sees the number only.
  if (invoiceStatus === "ISSUED" && fakturowniaInvoiceId === null) {
    return { ...rest, invoiceStatus: "ISSUED", invoiceNumber, invoicePdfUrl: null };
  }
  // The PDF of an invoice that KSeF rejected or has not confirmed yet could be a document that gets corrected
  // or replaced: it is shown only with a token and once KSeF is OK and final, or after it was e-mailed.
  if (invoiceStatus !== "ISSUED" || !invoiceToken || !isInvoiceVisibleToCustomer({ ksefStatus, invoiceEmailedAt })) {
    return { ...rest, invoiceStatus: "PENDING", invoiceNumber: null, invoicePdfUrl: null };
  }
  return { ...rest, invoiceStatus: "ISSUED", invoiceNumber, invoicePdfUrl: buildPdfUrl(invoiceToken) };
}

type ProformaFields = {
  proformaNumber: string | null;
  proformaToken: string | null;
  proformaFakturowniaId: string | null;
  proformaDueDate: Date | string | null;
  proformaEmailedAt: Date | null;
  proformaLastError: string | null;
};

export type WithCustomerProforma<T extends ProformaFields> = Omit<T, keyof ProformaFields> & {
  proformaNumber: string | null;
  proformaPdfUrl: string | null;
  /** YYYY-MM-DD */
  proformaDueDate: string | null;
};

/** Customer: the proforma's number, PDF link and due date only; never the token, the Fakturownia id, errors or e-mail state. */
export function withCustomerProforma<T extends ProformaFields>(row: T, buildPdfUrl: PdfUrlBuilder): WithCustomerProforma<T> {
  const { proformaNumber, proformaToken, proformaDueDate, proformaFakturowniaId, proformaEmailedAt, proformaLastError, ...rest } = row;
  return {
    ...rest,
    proformaNumber,
    proformaPdfUrl: proformaToken ? buildPdfUrl(proformaToken) : null,
    proformaDueDate:
      proformaDueDate === null
        ? null
        : typeof proformaDueDate === "string"
          ? proformaDueDate.slice(0, 10)
          : dbDateToYmd(proformaDueDate),
  };
}

/** Admin: same as the stored row, but the raw invoice and proforma tokens are replaced by the ready PDF links. */
export function withAdminInvoice<T extends { invoiceToken: string | null; proformaToken: string | null }>(
  row: T,
  buildPdfUrl: PdfUrlBuilder,
): Omit<T, "invoiceToken" | "proformaToken"> & { invoicePdfUrl: string | null; proformaPdfUrl: string | null } {
  const { invoiceToken, proformaToken, ...rest } = row;
  return {
    ...rest,
    invoicePdfUrl: invoiceToken ? buildPdfUrl(invoiceToken) : null,
    proformaPdfUrl: proformaToken ? buildPdfUrl(proformaToken) : null,
  };
}
