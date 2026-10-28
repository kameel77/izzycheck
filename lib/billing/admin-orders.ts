import type { InvoiceStatus, OrderStatus, Prisma } from "@prisma/client";
import { INVOICE_STATUS_LABELS, ORDER_STATUS_LABELS } from "./labels.ts";

export const ADMIN_ORDERS_PAGE_SIZE = 50;

export const ADMIN_ORDER_SELECT = {
  id: true,
  status: true,
  totalGrossGrosze: true,
  createdAt: true,
  paidAt: true,
  payuSandbox: true,
  organization: { select: { id: true, name: true } },
  user: { select: { name: true, email: true } },
  items: {
    select: { packageName: true, creditType: true, creditsPerPackage: true, quantity: true, lineGrossGrosze: true },
    orderBy: { id: "asc" },
  },
  invoiceStatus: true,
  invoiceAttempts: true,
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
  organizationId?: string;
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
  const organizationId = params.get("organizationId")?.trim();
  if (organizationId) filters.organizationId = organizationId;
  return filters;
}
