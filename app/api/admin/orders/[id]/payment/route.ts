import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-admin";
import { cancelProformaOrder, markProformaPaid, parseOrderPaymentAction } from "@/lib/billing/proforma";
import { prisma } from "@/lib/db";
import { issueInvoiceAfterResponse } from "@/lib/invoices/background";

export const dynamic = "force-dynamic";

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
    const parsed = parseOrderPaymentAction(body);
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
        console.error("[ADMIN_ORDER_PAYMENT_AUDIT_ERROR]", auditError);
      }
    };

    if (input.action === "cancel") {
      const result = await cancelProformaOrder(prisma, id, new Date());
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
      await audit("ORDER_CANCEL", {});
      return NextResponse.json({ success: true });
    }

    const result = await markProformaPaid(prisma, { orderId: id, paidDate: input.paidDate, note: input.note, now: new Date() });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    await audit("ORDER_MARK_PAID", { paidDate: input.paidDate, note: input.note });
    // The VAT invoice is issued right after the response; whatever fails there is retried by the billing cron.
    issueInvoiceAfterResponse(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[ADMIN_ORDER_PAYMENT_POST_ERROR]", error);
    return NextResponse.json({ error: "Nie udało się wykonać akcji na zamówieniu." }, { status: 500 });
  }
}
