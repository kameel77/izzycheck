-- AlterTable
ALTER TABLE "reports" ADD COLUMN "publicReference" TEXT;
ALTER TABLE "reports" ADD COLUMN "pdfBytes" BYTEA;
ALTER TABLE "reports" ADD COLUMN "pdfGeneratedAt" TIMESTAMP(3);
ALTER TABLE "reports" ADD COLUMN "pdfGeneratorVersion" TEXT;

-- CreateTable
CREATE TABLE "report_reference_sequences" (
    "period" TEXT NOT NULL,
    "currentVal" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "report_reference_sequences_pkey" PRIMARY KEY ("period")
);

-- CreateIndex
CREATE UNIQUE INDEX "reports_publicReference_key" ON "reports"("publicReference");

