import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-admin";
import { prisma } from "@/lib/db";
import { getSharedFakturowniaClient } from "@/lib/invoices/fakturownia";
import { markInvoiceManual, parseInvoiceAction, retryInvoice } from "@/lib/invoices/admin-actions";
import { issueInvoiceAfterResponse } from "@/lib/invoices/background";
import { refreshKsefStatus } from "@/lib/invoices/service";

export const dynamic = "force-dynamic";

const NOT_CONFIGURED = "Fakturownia nie jest skonfigurowana.";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;
    const admin = auth.admin;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const parsed = parseInvoiceAction(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const input = parsed.value;
    const { id } = await params;

    const audit = async (action: string, metadata: Record<string, unknown>) => {
      // The transition is already committed; a failed audit write must not turn it into a 500.
      try {
        await prisma.auditEvent.create({
          data: {
            userId: admin.id,
            userEmail: admin.email,
            action,
            resource: `Order:${id}`,
            metadataJson: JSON.stringify({ orderId: id, ...metadata }),
          },
        });
      } catch (auditError) {
        console.error("[ADMIN_INVOICE_AUDIT_ERROR]", auditError);
      }
    };

    if (input.action === "markManual") {
      const result = await markInvoiceManual(prisma, id, input.invoiceNumber, new Date());
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
      await audit("INVOICE_MARK_MANUAL", { invoiceNumber: input.invoiceNumber });
      return NextResponse.json({ success: true });
    }

    const client = getSharedFakturowniaClient();
    if (!client) {
      return NextResponse.json({ error: NOT_CONFIGURED }, { status: 503 });
    }

    if (input.action === "retry") {
      const result = await retryInvoice(prisma, id, new Date());
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
      await audit("INVOICE_RETRY", {});
      // The invoice is issued right after the response; whatever fails there is retried by the billing cron.
      issueInvoiceAfterResponse(id);
      return NextResponse.json({ success: true });
    }

    const order = await prisma.order.findUnique({
      where: { id },
      select: { invoiceStatus: true, fakturowniaInvoiceId: true },
    });
    if (!order) {
      return NextResponse.json({ error: "Nie znaleziono zamówienia." }, { status: 404 });
    }
    if (order.invoiceStatus !== "ISSUED" || !order.fakturowniaInvoiceId) {
      return NextResponse.json({ error: "Status KSeF można odświeżyć tylko dla faktury wystawionej w Fakturowni." }, { status: 409 });
    }
    const refresh = await refreshKsefStatus(prisma, id, { client });
    if (refresh.result === "ERROR") {
      return NextResponse.json({ error: "Nie udało się pobrać statusu KSeF z Fakturowni." }, { status: 502 });
    }
    return NextResponse.json({ success: true, result: refresh.result, ksefStatus: refresh.ksefStatus });
  } catch (error) {
    console.error("[ADMIN_ORDER_INVOICE_POST_ERROR]", error);
    return NextResponse.json({ error: "Nie udało się wykonać akcji na fakturze." }, { status: 500 });
  }
}
