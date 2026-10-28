-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAID', 'CANCELED', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('PAYU');

-- AlterTable
ALTER TABLE "credit_ledger_entries" ADD COLUMN     "orderId" TEXT;

-- CreateTable
CREATE TABLE "credit_packages" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "creditType" "CreditType" NOT NULL,
    "credits" INTEGER NOT NULL,
    "priceNetGrosze" INTEGER NOT NULL,
    "vatRate" INTEGER NOT NULL DEFAULT 23,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "paymentMethod" "PaymentMethod" NOT NULL,
    "totalNetGrosze" INTEGER NOT NULL,
    "totalVatGrosze" INTEGER NOT NULL,
    "totalGrossGrosze" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PLN',
    "payuOrderId" TEXT,
    "payuRedirectUri" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "packageName" TEXT NOT NULL,
    "creditType" "CreditType" NOT NULL,
    "creditsPerPackage" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitNetGrosze" INTEGER NOT NULL,
    "unitGrossGrosze" INTEGER NOT NULL,
    "vatRate" INTEGER NOT NULL,
    "lineNetGrosze" INTEGER NOT NULL,
    "lineVatGrosze" INTEGER NOT NULL,
    "lineGrossGrosze" INTEGER NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_payuOrderId_key" ON "orders"("payuOrderId");

-- CreateIndex
CREATE INDEX "orders_organizationId_createdAt_idx" ON "orders"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "orders_userId_createdAt_idx" ON "orders"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");

-- CreateIndex
CREATE INDEX "credit_ledger_entries_orderId_idx" ON "credit_ledger_entries"("orderId");

-- AddForeignKey
ALTER TABLE "credit_ledger_entries" ADD CONSTRAINT "credit_ledger_entries_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "credit_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Cennik startowy (ceny netto w groszach, VAT 23%); migracja wykonuje się raz
INSERT INTO "credit_packages" ("id","name","creditType","credits","priceNetGrosze","vatRate","isActive","sortOrder","updatedAt") VALUES
 (gen_random_uuid()::text,'1 raport historii szkód','CLAIM_DETAILS',1,4500,23,true,10,now()),
 (gen_random_uuid()::text,'10 raportów historii szkód','CLAIM_DETAILS',10,42000,23,true,20,now()),
 (gen_random_uuid()::text,'100 raportów historii szkód','CLAIM_DETAILS',100,390000,23,true,30,now()),
 (gen_random_uuid()::text,'1 wycena pojazdu','VALUATION',1,2500,23,true,10,now()),
 (gen_random_uuid()::text,'10 wycen pojazdu','VALUATION',10,22000,23,true,20,now()),
 (gen_random_uuid()::text,'100 wycen pojazdu','VALUATION',100,190000,23,true,30,now());
