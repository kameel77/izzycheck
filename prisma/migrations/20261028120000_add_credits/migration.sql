-- CreateEnum
CREATE TYPE "BillingMode" AS ENUM ('PREPAID', 'UNLIMITED');

-- CreateEnum
CREATE TYPE "CreditType" AS ENUM ('VALUATION', 'CLAIM_DETAILS');

-- CreateEnum
CREATE TYPE "CreditLedgerType" AS ENUM ('USAGE', 'MANUAL_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CreditHoldStatus" AS ENUM ('HELD', 'CAPTURED', 'RELEASED');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "billingMode" "BillingMode" NOT NULL DEFAULT 'PREPAID';

-- CreateTable
CREATE TABLE "credit_balances" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "creditType" "CreditType" NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_holds" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "moduleId" "ReportModuleId" NOT NULL,
    "creditType" "CreditType" NOT NULL,
    "status" "CreditHoldStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_ledger_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "creditType" "CreditType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "type" "CreditLedgerType" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "reportId" TEXT,
    "moduleId" "ReportModuleId",
    "userId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "credit_balances_organizationId_creditType_key" ON "credit_balances"("organizationId", "creditType");

-- CreateIndex
CREATE INDEX "credit_holds_organizationId_status_updatedAt_idx" ON "credit_holds"("organizationId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "credit_holds_reportId_moduleId_key" ON "credit_holds"("reportId", "moduleId");

-- CreateIndex
CREATE UNIQUE INDEX "credit_ledger_entries_idempotencyKey_key" ON "credit_ledger_entries"("idempotencyKey");

-- CreateIndex
CREATE INDEX "credit_ledger_entries_organizationId_createdAt_idx" ON "credit_ledger_entries"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "credit_ledger_entries_userId_createdAt_idx" ON "credit_ledger_entries"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "credit_balances" ADD CONSTRAINT "credit_balances_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_holds" ADD CONSTRAINT "credit_holds_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_holds" ADD CONSTRAINT "credit_holds_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger_entries" ADD CONSTRAINT "credit_ledger_entries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger_entries" ADD CONSTRAINT "credit_ledger_entries_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger_entries" ADD CONSTRAINT "credit_ledger_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Istniejące organizacje zachowują dotychczasowe działanie (spec 6.3)
UPDATE "organizations" SET "billingMode" = 'UNLIMITED';
