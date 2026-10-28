import { NextResponse } from "next/server";
import { getCurrentUser, getFreshUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { syncOrderWithPayu } from "@/lib/billing/orders";
import { canResumePayment, canViewOrder } from "@/lib/billing/order-access";
import { issueInvoiceAfterResponse } from "@/lib/invoices/background";
import { getSharedPayuClient } from "@/lib/payments/payu";
import { isRateLimited } from "@/lib/rate-limit";
import { sharedPdfUrlBuilder, withCustomerInvoice } from "@/lib/invoices/views";

export const dynamic = "force-dynamic";

const ORDER_SELECT = {
  id: true,
  organizationId: true,
  userId: true,
  status: true,
  totalGrossGrosze: true,
  createdAt: true,
  paidAt: true,
  payuRedirectUri: true,
  invoiceStatus: true,
  invoiceNumber: true,
  invoiceToken: true,
  fakturowniaInvoiceId: true,
  ksefStatus: true,
  invoiceEmailedAt: true,
  items: {
    select: { packageName: true, creditType: true, creditsPerPackage: true, quantity: true, lineGrossGrosze: true },
  },
} as const;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const sessionUser = await getCurrentUser();
    if (!sessionUser) {
      return NextResponse.json({ error: "Brak autoryzacji. Zaloguj się ponownie." }, { status: 401 });
    }

    const freshUser = await getFreshUser(sessionUser.userId);
    if (!freshUser || !freshUser.isActive) {
      return NextResponse.json({ error: "Konto użytkownika jest nieaktywne lub nie istnieje." }, { status: 401 });
    }

    const { id } = await params;
    const notFound = () => NextResponse.json({ error: "Nie znaleziono zamówienia." }, { status: 404 });

    // Everybody who may not view the order gets 404 (existence is not revealed).
    const viewer = { userId: freshUser.id, role: freshUser.role, organizationId: freshUser.organizationId };
    let order = await prisma.order.findUnique({ where: { id }, select: ORDER_SELECT });
    if (!order || !canViewOrder(viewer, order)) return notFound();

    // True only when PayU was really polled; false when the order needed no sync or the poll was throttled.
    let synced = false;
    if (order.status === "PENDING_PAYMENT") {
      const payu = getSharedPayuClient();
      // At most one PayU poll per order per 10 s, however often the page asks; otherwise return DB state.
      if (payu && !isRateLimited("orders_sync", order.id, 1, 10_000).limited) {
        const sync = await syncOrderWithPayu(prisma, order.id, payu);
        synced = sync.synced;
        if (sync.result === "PAID_NOW") issueInvoiceAfterResponse(order.id);
        order = await prisma.order.findUnique({ where: { id }, select: ORDER_SELECT });
        if (!order) return notFound();
      }
    }

    const invoice = withCustomerInvoice(
      {
        invoiceStatus: order.invoiceStatus,
        invoiceNumber: order.invoiceNumber,
        invoiceToken: order.invoiceToken,
        fakturowniaInvoiceId: order.fakturowniaInvoiceId,
        ksefStatus: order.ksefStatus,
        invoiceEmailedAt: order.invoiceEmailedAt,
      },
      sharedPdfUrlBuilder(),
    );
    return NextResponse.json({
      id: order.id,
      status: order.status,
      totalGrossGrosze: order.totalGrossGrosze,
      createdAt: order.createdAt,
      paidAt: order.paidAt,
      items: order.items,
      invoiceStatus: invoice.invoiceStatus,
      invoiceNumber: invoice.invoiceNumber,
      invoicePdfUrl: invoice.invoicePdfUrl,
      synced,
      ...(canResumePayment(freshUser.id, order) ? { payuRedirectUri: order.payuRedirectUri } : {}),
    });
  } catch (error) {
    console.error("[ORDERS_ID_GET_ERROR]", error);
    return NextResponse.json({ error: "Nie udało się pobrać zamówienia." }, { status: 500 });
  }
}
