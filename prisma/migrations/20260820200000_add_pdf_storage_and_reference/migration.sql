-- AlterTable
ALTER TABLE "reports" ADD COLUMN "publicReference" TEXT;
ALTER TABLE "reports" ADD COLUMN "pdfBytes" BYTEA;
ALTER TABLE "reports" ADD COLUMN "pdfGeneratedAt" TIMESTAMP(3);
ALTER TABLE "reports" ADD COLUMN "pdfGeneratorVersion" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "reports_publicReference_key" ON "reports"("publicReference");
