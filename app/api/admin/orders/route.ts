import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-admin";
import { prisma } from "@/lib/db";
import {
  ADMIN_ORDERS_PAGE_SIZE,
  ADMIN_ORDER_SELECT,
  buildAdminOrdersWhere,
  parseAdminOrderFilters,
} from "@/lib/billing/admin-orders";
import { getInvoiceConfigWarnings, getOrdersAttention } from "@/lib/invoices/attention";
import { getFakturowniaConfig } from "@/lib/invoices/fakturownia";
import { ksefProblem } from "@/lib/invoices/ksef";
import { sharedPdfUrlBuilder, withAdminInvoice } from "@/lib/invoices/views";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const filters = parseAdminOrderFilters(searchParams);
    const cursor = searchParams.get("cursor");

    const now = new Date();
    const rows = await prisma.order.findMany({
      where: buildAdminOrdersWhere(filters, now),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: ADMIN_ORDERS_PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: ADMIN_ORDER_SELECT,
    });

    const hasMore = rows.length > ADMIN_ORDERS_PAGE_SIZE;
    const page = hasMore ? rows.slice(0, ADMIN_ORDERS_PAGE_SIZE) : rows;
    const buildPdfUrl = sharedPdfUrlBuilder();
    const orders = page.map((row) => ({ ...withAdminInvoice(row, buildPdfUrl), ksefProblem: ksefProblem(row, now) }));

    // The organization filter options are only needed with the first page.
    const organizations = cursor
      ? undefined
      : await prisma.organization.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });

    return NextResponse.json({
      orders,
      nextCursor: hasMore ? page[page.length - 1].id : null,
      fakturowniaConfigured: getFakturowniaConfig() !== null,
      attention: await getOrdersAttention(prisma, now),
      warnings: getInvoiceConfigWarnings(),
      ...(organizations ? { organizations } : {}),
    });
  } catch (error) {
    console.error("[ADMIN_ORDERS_GET_ERROR]", error);
    return NextResponse.json({ error: "Nie udało się pobrać zamówień." }, { status: 500 });
  }
}
