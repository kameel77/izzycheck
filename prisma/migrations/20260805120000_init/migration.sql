-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OPERATOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "ReportModuleId" AS ENUM ('VALUATION', 'CLAIM_CHECK', 'CLAIM_DETAILS');

-- CreateEnum
CREATE TYPE "ModuleStatus" AS ENUM ('NOT_REQUESTED', 'PENDING', 'SUCCEEDED', 'NO_DATA', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'OPERATOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "vin" TEXT NOT NULL,
    "firstRegistrationDate" TEXT NOT NULL,
    "mileage" INTEGER,
    "valuationDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_module_results" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "moduleId" "ReportModuleId" NOT NULL,
    "status" "ModuleStatus" NOT NULL DEFAULT 'PENDING',
    "responseMetadata" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_module_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_snapshots" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "ibsCode" TEXT,
    "make" TEXT,
    "model" TEXT,
    "variant" TEXT,
    "newPriceCv" DOUBLE PRECISION,
    "marketPriceCob" DOUBLE PRECISION,
    "technicalValueTh" DOUBLE PRECISION,
    "mileageUsed" INTEGER,
    "isAverageMileageUsed" BOOLEAN NOT NULL DEFAULT false,
    "manufactureDate" TEXT,
    "standardEquipment" TEXT,
    "optionalEquipment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "damage_claims" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "accidentDate" TEXT,
    "claimDate" TEXT,
    "country" TEXT,
    "makeModel" TEXT,
    "mileage" INTEGER,
    "damageValue" DOUBLE PRECISION,
    "currency" TEXT,
    "isTotalLoss" BOOLEAN NOT NULL DEFAULT false,
    "mandateCode" TEXT,
    "mandateDescription" TEXT,
    "damageZones" TEXT,
    "significantParts" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "damage_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "userEmail" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "metadataJson" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "reports_vin_idx" ON "reports"("vin");

-- CreateIndex
CREATE INDEX "reports_createdById_idx" ON "reports"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "report_module_results_reportId_moduleId_key" ON "report_module_results"("reportId", "moduleId");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_snapshots_reportId_key" ON "vehicle_snapshots"("reportId");

-- CreateIndex
CREATE INDEX "damage_claims_reportId_idx" ON "damage_claims"("reportId");

-- CreateIndex
CREATE INDEX "audit_events_userId_idx" ON "audit_events"("userId");

-- CreateIndex
CREATE INDEX "audit_events_action_idx" ON "audit_events"("action");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_module_results" ADD CONSTRAINT "report_module_results_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_snapshots" ADD CONSTRAINT "vehicle_snapshots_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_claims" ADD CONSTRAINT "damage_claims_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
