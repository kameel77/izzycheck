import type { InvoiceStatus, OrderStatus, PaymentMethod, Prisma } from "@prisma/client";
import { emailOverdueWhere } from "../invoices/attention.ts";
import { ksefProblemWhere } from "../invoices/ksef.ts";
import { INVOICE_STATUS_LABELS, ORDER_STATUS_LABELS, PAYMENT_METHOD_LABELS } from "./labels.ts";

export const ADMIN_ORDERS_PAGE_SIZE = 50;

export const ADMIN_ORDER_SELECT = {
  id: true,
  status: true,
  totalGrossGrosze: true,
  createdAt: true,
  paidAt: true,
  payuSandbox: true,
  paymentMethod: true,
  paymentNote: true,
  proformaFakturowniaId: true,
  proformaNumber: true,
  proformaToken: true,
  proformaIssuedAt: true,
  proformaDueDate: true,
  proformaEmailedAt: true,
  proformaLastError: true,
  organization: { select: { id: true, name: true } },
  user: { select: { name: true, email: true } },
  items: {
    select: { packageName: true, creditType: true, creditsPerPackage: true, quantity: true, lineGrossGrosze: true },
    orderBy: { id: "asc" },
  },
  invoiceStatus: true,
  invoiceAttempts: true,
  invoiceNextAttemptAt: true,
  invoiceLastError: true,
  invoiceNumber: true,
  invoiceToken: true,
  invoiceIssuedAt: true,
  invoiceEmailedAt: true,
  fakturowniaInvoiceId: true,
  ksefStatus: true,
  ksefId: true,
  ksefVerificationLink: true,
} as const satisfies Prisma.OrderSelect;

export type AdminOrderFilters = {
  status?: OrderStatus;
  invoiceStatus?: InvoiceStatus;
  paymentMethod?: PaymentMethod;
  organizationId?: string;
  /** Only ISSUED invoices with a KSeF problem (see ksefProblem). */
  ksefProblem?: boolean;
  /** Only ISSUED invoices not e-mailed after the retry window and not already a KSeF problem (see emailOverdueWhere). */
  emailOverdue?: boolean;
};

/** Reads the list filters from the query string; unknown enum values and blank ids are ignored. */
export function parseAdminOrderFilters(params: URLSearchParams): AdminOrderFilters {
  const filters: AdminOrderFilters = {};
  const status = params.get("status");
  if (status !== null && Object.prototype.hasOwnProperty.call(ORDER_STATUS_LABELS, status)) {
    filters.status = status as OrderStatus;
  }
  const invoiceStatus = params.get("invoiceStatus");
  if (invoiceStatus !== null && Object.prototype.hasOwnProperty.call(INVOICE_STATUS_LABELS, invoiceStatus)) {
    filters.invoiceStatus = invoiceStatus as InvoiceStatus;
  }
  const paymentMethod = params.get("paymentMethod");
  if (paymentMethod !== null && Object.prototype.hasOwnProperty.call(PAYMENT_METHOD_LABELS, paymentMethod)) {
    filters.paymentMethod = paymentMethod as PaymentMethod;
  }
  const organizationId = params.get("organizationId")?.trim();
  if (organizationId) filters.organizationId = organizationId;
  if (params.get("ksefProblem") === "true") filters.ksefProblem = true;
  if (params.get("emailOverdue") === "true") filters.emailOverdue = true;
  return filters;
}

/** The database filter for the list; the invoice signal filters are combined with AND so they never clash with invoiceStatus. */
export function buildAdminOrdersWhere(filters: AdminOrderFilters, now: Date): Prisma.OrderWhereInput {
  const { ksefProblem, emailOverdue, ...simple } = filters;
  const extra: Prisma.OrderWhereInput[] = [];
  if (ksefProblem) extra.push(ksefProblemWhere(now));
  if (emailOverdue) extra.push(emailOverdueWhere(now));
  return extra.length > 0 ? { AND: [simple, ...extra] } : simple;
}
