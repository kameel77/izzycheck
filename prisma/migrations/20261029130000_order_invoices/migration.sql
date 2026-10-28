-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'ISSUING', 'ISSUED', 'FAILED', 'NEEDS_ATTENTION');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "fakturowniaInvoiceId" TEXT,
ADD COLUMN     "invoiceAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "invoiceClaimedAt" TIMESTAMP(3),
ADD COLUMN     "invoiceEmailedAt" TIMESTAMP(3),
ADD COLUMN     "invoiceIssuedAt" TIMESTAMP(3),
ADD COLUMN     "invoiceLastError" TEXT,
ADD COLUMN     "invoiceNextAttemptAt" TIMESTAMP(3),
ADD COLUMN     "invoiceNumber" TEXT,
ADD COLUMN     "invoiceStatus" "InvoiceStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
ADD COLUMN     "invoiceToken" TEXT,
ADD COLUMN     "ksefCheckedAt" TIMESTAMP(3),
ADD COLUMN     "ksefId" TEXT,
ADD COLUMN     "ksefStatus" TEXT,
ADD COLUMN     "ksefVerificationLink" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "orders_fakturowniaInvoiceId_key" ON "orders"("fakturowniaInvoiceId");

-- CreateIndex
CREATE INDEX "orders_invoiceStatus_invoiceNextAttemptAt_idx" ON "orders"("invoiceStatus", "invoiceNextAttemptAt");
