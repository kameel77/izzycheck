import { after } from "next/server";
import { prisma } from "@/lib/db";
import { getSharedFakturowniaClient } from "./fakturownia";
import { processInvoice } from "./service";

/**
 * Issues the invoice of a just-paid order after the HTTP response was sent, so PayU's notification (or the
 * buyer's page) is not held up by Fakturownia. Never throws: whatever fails here is retried by the billing
 * cron, because the order stays PENDING/FAILED with invoiceNextAttemptAt set.
 */
export function issueInvoiceAfterResponse(orderId: string): void {
  after(async () => {
    try {
      await processInvoice(prisma, orderId, { client: getSharedFakturowniaClient() });
    } catch (error) {
      console.error("[INVOICE_ISSUE_ERROR]", { orderId, message: error instanceof Error ? error.message : "unknown" });
    }
  });
}
