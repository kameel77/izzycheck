import { NextResponse } from "next/server";
import { getCurrentUser, getFreshUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { syncOrderWithPayu } from "@/lib/billing/orders";
import { createPayuClient, getPayuConfig } from "@/lib/payments/payu";

export const dynamic = "force-dynamic";

const ORDER_SELECT = {
  id: true,
  organizationId: true,
  userId: true,
  status: true,
  totalGrossGrosze: true,
  createdAt: true,
  paidAt: true,
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

    // Creator, or MANAGER/ADMIN of the order's organization; everybody else gets 404 (existence is not revealed).
    const canAccess = (order: { organizationId: string; userId: string }) =>
      freshUser.organizationId !== null &&
      order.organizationId === freshUser.organizationId &&
      (order.userId === freshUser.id || freshUser.role === "MANAGER" || freshUser.role === "ADMIN");

    let order = await prisma.order.findUnique({ where: { id }, select: ORDER_SELECT });
    if (!order || !canAccess(order)) return notFound();

    if (order.status === "PENDING_PAYMENT") {
      const config = getPayuConfig();
      if (config) {
        await syncOrderWithPayu(prisma, order.id, createPayuClient(config));
        order = await prisma.order.findUnique({ where: { id }, select: ORDER_SELECT });
        if (!order) return notFound();
      }
    }

    return NextResponse.json({
      id: order.id,
      status: order.status,
      totalGrossGrosze: order.totalGrossGrosze,
      createdAt: order.createdAt,
      paidAt: order.paidAt,
      items: order.items,
    });
  } catch (error) {
    console.error("[ORDERS_ID_GET_ERROR]", error);
    return NextResponse.json({ error: "Nie udało się pobrać zamówienia." }, { status: 500 });
  }
}
