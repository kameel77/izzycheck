import { NextResponse } from "next/server";
import { getCurrentUser, getFreshUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CheckoutError, createCheckout } from "@/lib/billing/orders";
import { createProformaOrder } from "@/lib/billing/proforma";
import { getFakturowniaConfig, getSharedFakturowniaClient } from "@/lib/invoices/fakturownia";
import { getPayuConfig, getSharedPayuClient } from "@/lib/payments/payu";
import { isRateLimited } from "@/lib/rate-limit";
import { sharedPdfUrlBuilder, withCustomerInvoice } from "@/lib/invoices/views";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

const ORDER_LIST_SELECT = {
  id: true,
  status: true,
  totalGrossGrosze: true,
  createdAt: true,
  paidAt: true,
  invoiceStatus: true,
  invoiceNumber: true,
  invoiceToken: true,
  fakturowniaInvoiceId: true,
  ksefStatus: true,
  invoiceEmailedAt: true,
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

    let body: unknown;
    let bodyParsed = true;
    try {
      body = await request.json();
    } catch {
      bodyParsed = false;
    }

    // Absent means PayU, as before the proforma existed.
    const rawMethod = bodyParsed ? (body as { paymentMethod?: unknown } | null)?.paymentMethod : undefined;
    if (rawMethod !== undefined && rawMethod !== null && rawMethod !== "PAYU" && rawMethod !== "PROFORMA") {
      return NextResponse.json({ error: "Nieprawidłowe dane zamówienia." }, { status: 400 });
    }
    const paymentMethod = rawMethod === "PROFORMA" ? "PROFORMA" : "PAYU";

    const config = getPayuConfig();
    const payu = getSharedPayuClient();
    const fakturownia = getSharedFakturowniaClient();
    if (paymentMethod === "PROFORMA") {
      if (!fakturownia) {
        return NextResponse.json({ error: "Proformy są chwilowo niedostępne." }, { status: 503 });
      }
    } else if (!config || !payu) {
      return NextResponse.json({ error: "Płatności online są chwilowo niedostępne." }, { status: 503 });
    }

    const rateCheck = isRateLimited("orders_checkout", freshUser.id, 10, 60000);
    if (rateCheck.limited) {
      return NextResponse.json(
        { error: `Zbyt wiele prób. Spróbuj ponownie za ${Math.ceil(rateCheck.resetMs / 1000)} sekund.` },
        { status: 429 },
      );
    }

    if (!bodyParsed) {
      return NextResponse.json({ error: "Nieprawidłowe dane zamówienia." }, { status: 400 });
    }
    const items = (body as { items?: unknown } | null)?.items;
    if (!Array.isArray(items)) {
      return NextResponse.json({ error: "Nieprawidłowe dane zamówienia." }, { status: 400 });
    }
    const expected = (body as { expectedTotalGrossGrosze?: unknown }).expectedTotalGrossGrosze;
    if (expected !== undefined && expected !== null && !Number.isInteger(expected)) {
      return NextResponse.json({ error: "Nieprawidłowe dane zamówienia." }, { status: 400 });
    }
    const expectedTotalGrossGrosze = typeof expected === "number" ? expected : undefined;

    const recordAudit = async (orderId: string) => {
      try {
        await prisma.auditEvent.create({
          data: {
            userId: freshUser.id,
            userEmail: freshUser.email,
            action: "CREATE_ORDER",
            resource: `Order:${orderId}`,
            metadataJson: JSON.stringify({ orderId, lines: items.length, paymentMethod }),
          },
        });
      } catch (auditError) {
        // The order already exists; a failed audit entry must not hide the result from the buyer.
        console.error("[ORDERS_POST_AUDIT_ERROR]", auditError);
      }
    };

    if (paymentMethod === "PROFORMA" && fakturownia) {
      const created = await createProformaOrder(prisma, {
        user: { id: freshUser.id, email: freshUser.email, organizationId: freshUser.organizationId },
        items: items as Array<{ packageId: string; quantity: number }>,
        expectedTotalGrossGrosze,
        fakturownia,
        departmentId: getFakturowniaConfig()?.departmentId ?? null,
      });
      await recordAudit(created.orderId);
      // The token never leaves the server; the customer gets the ready PDF link.
      return NextResponse.json(
        {
          orderId: created.orderId,
          proformaNumber: created.proformaNumber,
          proformaPdfUrl: sharedPdfUrlBuilder()(created.proformaToken),
          proformaDueDate: created.proformaDueDate,
          emailed: created.emailed,
        },
        { status: 201 },
      );
    }

    const forwarded = request.headers.get("x-forwarded-for");
    const customerIp = forwarded?.split(",")[0].trim() || "127.0.0.1";

    // Narrowing only: the PayU path was verified as configured above.
    if (!config || !payu) {
      return NextResponse.json({ error: "Płatności online są chwilowo niedostępne." }, { status: 503 });
    }

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
      expectedTotalGrossGrosze,
    });

    // The order already exists at PayU; recordAudit never throws, so a failed audit entry cannot hide the payment link.
    await recordAudit(orderId);

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
    const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
    const buildPdfUrl = sharedPdfUrlBuilder();
    return NextResponse.json({
      orders: page.map((row) => withCustomerInvoice(row, buildPdfUrl)),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    });
  } catch (error) {
    console.error("[ORDERS_GET_ERROR]", error);
    return NextResponse.json({ error: "Nie udało się pobrać zamówień." }, { status: 500 });
  }
}
