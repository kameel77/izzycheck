-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'PROFORMA';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "paymentNote" TEXT,
ADD COLUMN     "proformaDueDate" DATE,
ADD COLUMN     "proformaEmailedAt" TIMESTAMP(3),
ADD COLUMN     "proformaFakturowniaId" TEXT,
ADD COLUMN     "proformaIssuedAt" TIMESTAMP(3),
ADD COLUMN     "proformaLastError" TEXT,
ADD COLUMN     "proformaNumber" TEXT,
ADD COLUMN     "proformaToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "orders_proformaFakturowniaId_key" ON "orders"("proformaFakturowniaId");
