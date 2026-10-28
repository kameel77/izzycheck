import { NextResponse } from "next/server";
import { getCurrentUser, getFreshUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CheckoutError, createCheckout } from "@/lib/billing/orders";
import { getPayuConfig, getSharedPayuClient } from "@/lib/payments/payu";
import { isRateLimited } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

const ORDER_LIST_SELECT = {
  id: true,
  status: true,
  totalGrossGrosze: true,
  createdAt: true,
  paidAt: true,
  user: { select: { name: true } },
  items: {
    select: { packageName: true, creditType: true, creditsPerPackage: true, quantity: true, lineGrossGrosze: true },
  },
} as const;

export async function POST(request: Request) {
  try {
    const sessionUser = await getCurrentUser();
    if (!sessionUser) {
      return NextResponse.json({ error: "Brak autoryzacji. Zaloguj się ponownie." }, { status: 401 });
    }

    const freshUser = await getFreshUser(sessionUser.userId);
    if (!freshUser || !freshUser.isActive) {
      return NextResponse.json({ error: "Konto użytkownika jest nieaktywne lub nie istnieje." }, { status: 401 });
    }

    const config = getPayuConfig();
    const payu = getSharedPayuClient();
    if (!config || !payu) {
      return NextResponse.json({ error: "Płatności online są chwilowo niedostępne." }, { status: 503 });
    }

    const rateCheck = isRateLimited("orders_checkout", freshUser.id, 10, 60000);
    if (rateCheck.limited) {
      return NextResponse.json(
        { error: `Zbyt wiele prób. Spróbuj ponownie za ${Math.ceil(rateCheck.resetMs / 1000)} sekund.` },
        { status: 429 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Nieprawidłowe dane zamówienia." }, { status: 400 });
    }
    const items = (body as { items?: unknown } | null)?.items;
    if (!Array.isArray(items)) {
      return NextResponse.json({ error: "Nieprawidłowe dane zamówienia." }, { status: 400 });
    }

    const forwarded = request.headers.get("x-forwarded-for");
    const customerIp = forwarded?.split(",")[0].trim() || "127.0.0.1";

    const { orderId, redirectUri } = await createCheckout(prisma, {
      user: {
        id: freshUser.id,
        email: freshUser.email,
        name: freshUser.name,
        organizationId: freshUser.organizationId,
      },
      items: items as Array<{ packageId: string; quantity: number }>,
      customerIp,
      payu,
      appUrl: config.appUrl,
      sandbox: config.isSandbox,
    });

    try {
      await prisma.auditEvent.create({
        data: {
          userId: freshUser.id,
          userEmail: freshUser.email,
          action: "CREATE_ORDER",
          resource: `Order:${orderId}`,
          metadataJson: JSON.stringify({ orderId, lines: items.length }),
        },
      });
    } catch (auditError) {
      // The order already exists at PayU; a failed audit entry must not hide the payment link.
      console.error("[ORDERS_POST_AUDIT_ERROR]", auditError);
    }

    return NextResponse.json({ orderId, redirectUri }, { status: 201 });
  } catch (error) {
    if (error instanceof CheckoutError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[ORDERS_POST_ERROR]", error);
    return NextResponse.json({ error: "Nie udało się utworzyć zamówienia." }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const sessionUser = await getCurrentUser();
    if (!sessionUser) {
      return NextResponse.json({ error: "Brak autoryzacji. Zaloguj się ponownie." }, { status: 401 });
    }

    const freshUser = await getFreshUser(sessionUser.userId);
    if (!freshUser || !freshUser.isActive) {
      return NextResponse.json({ error: "Konto użytkownika jest nieaktywne lub nie istnieje." }, { status: 401 });
    }

    const organizationId = freshUser.organizationId;
    if (!organizationId) {
      return NextResponse.json({ orders: [], nextCursor: null });
    }

    const { searchParams } = new URL(request.url);
    const canSeeOrg = freshUser.role === "MANAGER" || freshUser.role === "ADMIN";
    const orgScope = searchParams.get("scope") === "org" && canSeeOrg;
    const cursor = searchParams.get("cursor");

    const rows = await prisma.order.findMany({
      where: orgScope ? { organizationId } : { organizationId, userId: freshUser.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: ORDER_LIST_SELECT,
    });

    const hasMore = rows.length > PAGE_SIZE;
    const orders = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
    return NextResponse.json({
      orders,
      nextCursor: hasMore ? orders[orders.length - 1].id : null,
    });
  } catch (error) {
    console.error("[ORDERS_GET_ERROR]", error);
    return NextResponse.json({ error: "Nie udało się pobrać zamówień." }, { status: 500 });
  }
}
