import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { handlePayuNotification } from "@/lib/billing/orders";
import { issueInvoiceAfterResponse } from "@/lib/invoices/background";
import { getPayuConfig } from "@/lib/payments/payu";

// Called by PayU servers: no session, authenticity comes from the OpenPayu-Signature header. Never cached.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const config = getPayuConfig();
  if (!config) {
    return NextResponse.json({ error: "Płatności online są chwilowo niedostępne." }, { status: 503 });
  }

  // The signature covers the exact bytes PayU sent, so read the raw text, not parsed JSON.
  const rawBody = await req.text();
  const result = await handlePayuNotification(prisma, {
    rawBody,
    signatureHeader: req.headers.get("openpayu-signature"),
    config,
  });
  if (result.paidOrderId) issueInvoiceAfterResponse(result.paidOrderId);
  return NextResponse.json(result.body, { status: result.status });
}
