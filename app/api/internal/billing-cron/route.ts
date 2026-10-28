import { prisma } from "@/lib/db";
import { handleBillingCronRequest } from "@/lib/invoices/cron-handler";
import { getSharedFakturowniaClient } from "@/lib/invoices/fakturownia";
import { runBillingCron } from "@/lib/invoices/service";
import { getSharedPayuClient } from "@/lib/payments/payu";

// Called by an external scheduler with a shared secret: no session, never cached.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handleBillingCronRequest(req, {
    secret: process.env.BILLING_CRON_SECRET,
    // A missing PayU or Fakturownia configuration only skips the steps that need it.
    run: () =>
      runBillingCron(prisma, {
        invoiceClient: getSharedFakturowniaClient(),
        payuClient: getSharedPayuClient(),
      }),
  });
}
