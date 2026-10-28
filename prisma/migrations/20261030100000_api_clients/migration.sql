-- CreateEnum
CREATE TYPE "ApiUsageOutcome" AS ENUM ('IDENTIFIED', 'NOT_FOUND', 'UPSTREAM_ERROR', 'REJECTED', 'INTERNAL_ERROR');

-- CreateTable
CREATE TABLE "api_clients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "api_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_usage" (
    "id" TEXT NOT NULL,
    "apiClientId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "vin" TEXT,
    "httpStatus" INTEGER NOT NULL,
    "outcome" "ApiUsageOutcome" NOT NULL,
    "billable" BOOLEAN NOT NULL,
    "cacheHit" BOOLEAN NOT NULL,
    "upstreamMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vin_identification_cache" (
    "vin" TEXT NOT NULL,
    "ibsCode" TEXT NOT NULL,
    "fittedEquipmentCodes" TEXT NOT NULL,
    "vinXml" TEXT NOT NULL,
    "classificationXml" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vin_identification_cache_pkey" PRIMARY KEY ("vin")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_clients_tokenHash_key" ON "api_clients"("tokenHash");

-- CreateIndex
CREATE INDEX "api_usage_organizationId_createdAt_idx" ON "api_usage"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "api_usage_apiClientId_createdAt_idx" ON "api_usage"("apiClientId", "createdAt");

-- AddForeignKey
ALTER TABLE "api_clients" ADD CONSTRAINT "api_clients_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_clients" ADD CONSTRAINT "api_clients_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_usage" ADD CONSTRAINT "api_usage_apiClientId_fkey" FOREIGN KEY ("apiClientId") REFERENCES "api_clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_usage" ADD CONSTRAINT "api_usage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
