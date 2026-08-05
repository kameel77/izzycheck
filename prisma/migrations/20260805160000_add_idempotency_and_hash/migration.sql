-- AlterTable
ALTER TABLE "reports" ADD COLUMN "idempotencyKey" TEXT,
ADD COLUMN "requestHash" TEXT;

-- CreateUniqueIndex
CREATE UNIQUE INDEX "reports_createdById_idempotencyKey_key" ON "reports"("createdById", "idempotencyKey");

-- CreateIndex
CREATE INDEX "reports_createdById_requestHash_idx" ON "reports"("createdById", "requestHash");
