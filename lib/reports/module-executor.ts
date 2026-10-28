import { prisma } from "../db.ts";
import { AudatexValuationAdapter } from "../audatex/valuation.ts";
import { AudatexHistoryAdapter } from "../audatex/history.ts";
import { NonRetryableError } from "../audatex/types.ts";
import { finalizeReport } from "./finalize.ts";
import { isRateLimited } from "../rate-limit.ts";
import { ReportModuleId, type CreditType } from "@prisma/client";
import {
  NoCreditsError,
  captureCredit,
  creditTypeForModule,
  isPrepaid,
  recordUnlimitedUsage,
  releaseCredit,
  reserveCredit,
} from "../billing/credits.ts";

const valuationAdapter = new AudatexValuationAdapter();
const historyAdapter = new AudatexHistoryAdapter();

export class ModuleExecutionError extends Error {
  statusCode: number;
  isNonRetryable: boolean;
  code?: "NO_CREDITS";
  creditType?: CreditType;

  constructor(
    message: string,
    statusCode = 400,
    isNonRetryable = false,
    extra?: { code?: "NO_CREDITS"; creditType?: CreditType }
  ) {
    super(message);
    this.name = "ModuleExecutionError";
    this.statusCode = statusCode;
    this.isNonRetryable = isNonRetryable;
    this.code = extra?.code;
    this.creditType = extra?.creditType;
  }
}

// Same env parsing/defaults as the Audatex adapters (cleanEnv + parseInt).
function parseAdapterEnvInt(raw: string | undefined, defaultVal: number): number {
  const cleaned = raw ? raw.trim().replace(/^["']|["']$/g, "") : "";
  const parsed = parseInt(cleaned || String(defaultVal), 10);
  return Number.isNaN(parsed) ? defaultVal : parsed;
}

const ADAPTER_TIMEOUT_MS = parseAdapterEnvInt(process.env.AUDATEX_TIMEOUT_MS, 15000);
const ADAPTER_MAX_RETRIES = parseAdapterEnvInt(process.env.AUDATEX_MAX_RETRIES, 2);

// A lock is stale only after the slowest legitimate execution could have finished.
// 3 = sequential SOAP calls in VALUATION (GetCarByVinWs, EvaluateCarFull, GetClassificationByIBSCode),
// each attempted up to (maxRetries + 1) times with timeoutMs per attempt, plus 30s margin.
export const STALE_LOCK_MS = Math.max(
  120_000,
  3 * (ADAPTER_MAX_RETRIES + 1) * ADAPTER_TIMEOUT_MS + 30_000
);

/**
 * Pure helper: a RUNNING module whose last update is older than STALE_LOCK_MS
 * can be taken over by a new execution request.
 */
export function isModuleLockStale(
  mod: { status: string; updatedAt: Date | string },
  now: number = Date.now()
): boolean {
  if (mod.status !== "RUNNING") return false;
  const updatedAtMs = new Date(mod.updatedAt).getTime();
  if (Number.isNaN(updatedAtMs)) return false;
  return now - updatedAtMs > STALE_LOCK_MS;
}

export interface ExecuteModuleOptions {
  customPrisma?: any;
  userId?: string;
  role?: "ADMIN" | "MANAGER" | "USER" | "OPERATOR";
  organizationId?: string | null;
  canGenerateValuation?: boolean;
  canGenerateClaimCheck?: boolean;
  canGenerateClaimDetails?: boolean;
  /** Trusted server-side caller (no user context). Without userId and internal, execution is refused. */
  internal?: boolean;
  customValuationAdapter?: any;
  customHistoryAdapter?: any;
}

/**
 * Executes a single module for a report with atomic concurrency lock,
 * dependency checking, retry limiting, stale lock recovery (>120s),
 * cascade invalidation and server-driven finalization.
 */
export async function executeReportModule(
  reportId: string,
  moduleId: ReportModuleId,
  options: ExecuteModuleOptions = {}
) {
  const db = options.customPrisma || prisma;
  const valAdapter = options.customValuationAdapter || valuationAdapter;
  const histAdapter = options.customHistoryAdapter || historyAdapter;

  // 1. Rate Limit per user if userId is provided (max 30 module executions per min)
  if (options.userId) {
    const rateCheck = isRateLimited("reports_modules_execute", options.userId, 30, 60000);
    if (rateCheck.limited) {
      throw new ModuleExecutionError(
        `Zbyt wiele zapytań o wykonanie modułów. Odczekaj ${Math.ceil(rateCheck.resetMs / 1000)}s.`,
        429
      );
    }
  }

  // 2. Fetch Report with its current modules and state
  const report = await db.report.findUnique({
    where: { id: reportId },
    include: {
      moduleResults: true,
      vehicleSnapshot: true,
      damageClaims: true,
      organization: { select: { id: true, billingMode: true } },
    },
  });

  if (!report) {
    throw new ModuleExecutionError("Raport nie został odnaleziony w systemie.", 404);
  }

  // Ownership check (fail-closed): report owner, ADMIN, or MANAGER in the same organization
  if (!options.userId && !options.internal) {
    throw new ModuleExecutionError("Dostęp zabroniony. Nie posiadasz uprawnień do tego raportu.", 403);
  }
  if (options.userId) {
    const isOwner = report.createdById === options.userId;
    const isAdmin = options.role === "ADMIN";
    const isOrgManager =
      options.role === "MANAGER" &&
      Boolean(options.organizationId && report.organizationId && options.organizationId === report.organizationId);

    if (!isOwner && !isAdmin && !isOrgManager) {
      throw new ModuleExecutionError("Dostęp zabroniony. Nie posiadasz uprawnień do tego raportu.", 403);
    }

    // Permission check for module execution for role USER (and OPERATOR with explicit permissions):
    if (
      options.role === "USER" ||
      (options.role === "OPERATOR" &&
        (options.canGenerateValuation !== undefined ||
          options.canGenerateClaimDetails !== undefined ||
          options.canGenerateClaimCheck !== undefined))
    ) {
      if (moduleId === "VALUATION" && !options.canGenerateValuation) {
        throw new ModuleExecutionError("Brak uprawnień do generowania wyceny pojazdu.", 403);
      }
      if (moduleId === "CLAIM_DETAILS" && !options.canGenerateClaimDetails) {
        throw new ModuleExecutionError("Brak uprawnień do generowania szczegółów szkód.", 403);
      }
      if (moduleId === "CLAIM_CHECK" && !options.canGenerateClaimCheck) {
        // Exception: allow CLAIM_CHECK if report also requested VALUATION and user has canGenerateValuation
        const hasValuationInReport = report.moduleResults.some(
          (m: any) => m.moduleId === "VALUATION" && m.status !== "NOT_REQUESTED"
        );
        if (!hasValuationInReport || !options.canGenerateValuation) {
          throw new ModuleExecutionError("Brak uprawnień do weryfikacji historii szkód.", 403);
        }
      }
    }
  }

  const targetModule = report.moduleResults.find((m: any) => m.moduleId === moduleId);
  if (!targetModule || targetModule.status === "NOT_REQUESTED") {
    throw new ModuleExecutionError("Ten moduł nie został zamówiony w ramach bieżącego raportu.", 400);
  }

  // 3. Business Guards & Status Invariants
  if (targetModule.status === "SUCCEEDED" || targetModule.status === "NO_DATA") {
    throw new ModuleExecutionError("Moduł został już pomyślnie wykonany.", 400);
  }

  if (targetModule.isNonRetryable) {
    throw new ModuleExecutionError(
      "Moduł napotkał błąd nienaprawialny (np. brak kodu IBS lub nieprawidłowy VIN). Ponowienie zablokowane.",
      422,
      true
    );
  }

  const isRetry = targetModule.status === "FAILED";
  if (isRetry && targetModule.retryCount >= 3) {
    throw new ModuleExecutionError(
      "Wykorzystano maksymalny limit 3 ponowień dla tego modułu.",
      422
    );
  }

  // 4. Server-Side Dependency Check for CLAIM_DETAILS
  if (moduleId === "CLAIM_DETAILS") {
    const checkModule = report.moduleResults.find((m: any) => m.moduleId === "CLAIM_CHECK");
    if (!checkModule || checkModule.status === "PENDING" || checkModule.status === "RUNNING") {
      throw new ModuleExecutionError(
        "Moduł CLAIM_CHECK jest w trakcie wykonywania. Poczekaj na jego wynik.",
        412
      );
    }
    if (checkModule.status === "FAILED" || checkModule.status === "NOT_REQUESTED") {
      throw new ModuleExecutionError(
        "Wymagane pomyślne wykonanie modułu CLAIM_CHECK przed pobraniem szczegółów szkód.",
        412
      );
    }
    if (checkModule.status === "NO_DATA") {
      // Vehicle has no damage history -> CLAIM_DETAILS completes as NO_DATA without billing
      await db.reportModuleResult.update({
        where: { id: targetModule.id },
        data: {
          status: "NO_DATA",
          errorMessage: null,
          responseMetadata: JSON.stringify({ message: "Brak historii szkód w CLAIM_CHECK (getDetails pominięty)" }),
        },
      });

      await checkAndFinalizeReportIfDone(reportId, db);
      return { success: true, status: "NO_DATA", skippedDueToNoHistory: true };
    }
  }

  // 5. Atomic Lock Transition with Stale-Lock Recovery (>120s) and credit reservation.
  // Lock and reservation share one transaction: a missing credit rolls the lock back (status and retryCount untouched).
  const creditType = creditTypeForModule(moduleId);
  const organization: { id: string; billingMode: "PREPAID" | "UNLIMITED" } | null = report.organization ?? null;
  const staleThreshold = new Date(Date.now() - STALE_LOCK_MS);
  let lockCount: number;
  try {
    lockCount = await db.$transaction(async (tx: any) => {
      const lockResult = await tx.reportModuleResult.updateMany({
        where: {
          id: targetModule.id,
          OR: [
            { status: { in: ["PENDING", "FAILED"] } },
            { status: "RUNNING", updatedAt: { lt: staleThreshold } },
          ],
        },
        data: {
          status: "RUNNING",
          ...(isRetry ? { retryCount: { increment: 1 } } : {}),
        },
      });

      if (lockResult.count === 1 && creditType && isPrepaid(organization)) {
        await reserveCredit(tx, {
          organizationId: organization!.id,
          reportId,
          moduleId,
          creditType,
          staleBefore: new Date(Date.now() - STALE_LOCK_MS),
        });
      }
      return lockResult.count as number;
    });
  } catch (err: any) {
    if (err instanceof NoCreditsError) {
      const what = err.creditType === "VALUATION" ? "wycenę pojazdu" : "szczegóły szkód";
      throw new ModuleExecutionError(
        `Brak dostępnych kredytów na ${what}. Dokup kredyty, aby kontynuować.`,
        402,
        false,
        { code: "NO_CREDITS", creditType: err.creditType }
      );
    }
    throw err;
  }

  if (lockCount === 0) {
    throw new ModuleExecutionError(
      "Moduł jest obecnie przetwarzany przez inne żądanie.",
      409
    );
  }

  // Credit settlement for the final result update of a paid module (runs inside the same transaction as that update).
  // chargeable = the module produced a billable result; otherwise a PREPAID reservation is released.
  const settleCredit = async (tx: any, chargeable: boolean) => {
    if (!creditType || !organization) return;
    const args = {
      organizationId: organization.id,
      reportId,
      moduleId,
      creditType,
      userId: report.createdById,
    };
    if (isPrepaid(organization)) {
      if (chargeable) await captureCredit(tx, args);
      else await releaseCredit(tx, { reportId, moduleId });
    } else if (chargeable) {
      await recordUnlimitedUsage(tx, args);
    }
  };
  const hasCreditOps = Boolean(creditType && organization);

  // 6. Execute Specific Module Logic
  let executionSuccess = false;
  let executedStatus: "SUCCEEDED" | "NO_DATA" | "FAILED" = "FAILED";
  let executionError: any = null;

  try {
    if (moduleId === "VALUATION") {
      const valRes = await valAdapter.evaluateVehicle({
        vin: report.vin,
        dateOfFirstReg: report.firstRegistrationDate,
        mileage: report.mileage || undefined,
        valuationDate: report.valuationDate,
      });

      // Upsert VehicleSnapshot
      await db.vehicleSnapshot.upsert({
        where: { reportId: report.id },
        create: {
          reportId: report.id,
          ibsCode: valRes.ibsCode,
          make: valRes.make,
          model: valRes.model,
          variant: valRes.variant,
          newPriceCv: valRes.newPriceCv,
          marketPriceCob: valRes.marketPriceCob,
          technicalValueTh: valRes.technicalValueTh,
          mileageUsed: valRes.mileageUsed,
          isAverageMileageUsed: valRes.isAverageMileageUsed,
          standardEquipment: JSON.stringify(valRes.standardEquipment),
          optionalEquipment: JSON.stringify(valRes.optionalEquipment),
          technicalSpecJson: valRes.technicalSpec ? JSON.stringify(valRes.technicalSpec) : null,
        },
        update: {
          ibsCode: valRes.ibsCode,
          make: valRes.make,
          model: valRes.model,
          variant: valRes.variant,
          newPriceCv: valRes.newPriceCv,
          marketPriceCob: valRes.marketPriceCob,
          technicalValueTh: valRes.technicalValueTh,
          mileageUsed: valRes.mileageUsed,
          isAverageMileageUsed: valRes.isAverageMileageUsed,
          standardEquipment: JSON.stringify(valRes.standardEquipment),
          optionalEquipment: JSON.stringify(valRes.optionalEquipment),
          technicalSpecJson: valRes.technicalSpec ? JSON.stringify(valRes.technicalSpec) : null,
        },
      });

      executedStatus = "SUCCEEDED";
      executionSuccess = true;

      const valuationUpdate = {
        where: { id: targetModule.id },
        data: {
          status: "SUCCEEDED",
          isNonRetryable: false,
          errorMessage: null,
          responseMetadata: JSON.stringify({ ibsCode: valRes.ibsCode, make: valRes.make, model: valRes.model }),
        },
      };
      if (hasCreditOps) {
        await db.$transaction(async (tx: any) => {
          await tx.reportModuleResult.update(valuationUpdate);
          await settleCredit(tx, true);
        });
      } else {
        await db.reportModuleResult.update(valuationUpdate);
      }
    } else if (moduleId === "CLAIM_CHECK") {
      const checkRes = await histAdapter.checkClaimHistory({
        vin: report.vin,
        firstRegistration: report.firstRegistrationDate,
      });

      executedStatus = checkRes.hasHistory ? "SUCCEEDED" : "NO_DATA";
      executionSuccess = true;

      // Cascade Invalidation on CLAIM_CHECK execution/retry (D-6):
      // Clean up previous damage claims if any exist
      await db.damageClaim.deleteMany({ where: { reportId: report.id } });

      // Update or reset dependent CLAIM_DETAILS module
      const detailsModule = report.moduleResults.find((m: any) => m.moduleId === "CLAIM_DETAILS");
      if (detailsModule && detailsModule.status !== "NOT_REQUESTED") {
        await db.reportModuleResult.update({
          where: { id: detailsModule.id },
          data: {
            status: checkRes.hasHistory ? "PENDING" : "NO_DATA",
            errorMessage: null,
            responseMetadata: checkRes.hasHistory
              ? null
              : JSON.stringify({ message: "Brak historii szkód w CLAIM_CHECK (getDetails pominięty)" }),
          },
        });
      }

      await db.reportModuleResult.update({
        where: { id: targetModule.id },
        data: {
          status: executedStatus,
          isNonRetryable: false,
          errorMessage: null,
          responseMetadata: JSON.stringify({
            hasHistory: checkRes.hasHistory,
            photosStatus: checkRes.photosStatus,
            advice: checkRes.advice,
          }),
        },
      });
    } else if (moduleId === "CLAIM_DETAILS") {
      const detailsRes = await histAdapter.getClaimDetails({
        vin: report.vin,
        firstRegistration: report.firstRegistrationDate,
      });

      // Clear existing claims to avoid duplication on retry
      await db.damageClaim.deleteMany({ where: { reportId: report.id } });

      for (const claim of detailsRes.claims) {
        await db.damageClaim.create({
          data: {
            reportId: report.id,
            claimId: claim.claimId,
            accidentDate: claim.accidentDate,
            claimDate: claim.creationDate,
            country: claim.country,
            makeModel: claim.makeModel,
            mileage: claim.mileage,
            damageValue: claim.damageValue,
            currency: claim.currency,
            isTotalLoss: claim.isTotalLoss,
            mandateCode: claim.mandateCode,
            mandateDescription: claim.mandateDescription,
            damageZones: JSON.stringify(claim.affectedZones),
            significantParts: JSON.stringify(claim.significantParts),
            damageAssessmentJson: claim.damageAssessment ? JSON.stringify(claim.damageAssessment) : null,
          },
        });
      }

      executedStatus = "SUCCEEDED";
      executionSuccess = true;

      const detailsUpdate = {
        where: { id: targetModule.id },
        data: {
          status: "SUCCEEDED",
          isNonRetryable: false,
          errorMessage: null,
          responseMetadata: JSON.stringify({ claimsCount: detailsRes.claims.length }),
        },
      };
      if (hasCreditOps) {
        await db.$transaction(async (tx: any) => {
          await tx.reportModuleResult.update(detailsUpdate);
          // Zero claims is a free result: the reservation is released instead of captured.
          await settleCredit(tx, detailsRes.claims.length > 0);
        });
      } else {
        await db.reportModuleResult.update(detailsUpdate);
      }
    }
  } catch (err: any) {
    executionError = err;
    const isNonRetryable = err instanceof NonRetryableError || Boolean(err.isNonRetryable);

    const failureUpdate = {
      where: { id: targetModule.id },
      data: {
        status: "FAILED",
        isNonRetryable,
        errorMessage: err.message || "Błąd wykonania modułu Audatex.",
      },
    };
    if (hasCreditOps) {
      await db.$transaction(async (tx: any) => {
        await tx.reportModuleResult.update(failureUpdate);
        await settleCredit(tx, false);
      });
    } else {
      await db.reportModuleResult.update(failureUpdate);
    }
  }

  // 7. Invariant D-6: Unfreeze PDF on successful module retry
  if (isRetry && executionSuccess) {
    await db.report.update({
      where: { id: reportId },
      data: {
        pdfBytes: null,
        pdfGeneratedAt: null,
        pdfGeneratorVersion: null,
      },
    });
  }

  // 8. Server-Driven Finalization Check
  await checkAndFinalizeReportIfDone(reportId, db);

  if (!executionSuccess) {
    throw new ModuleExecutionError(
      executionError?.message || "Błąd wykonania modułu.",
      500,
      executionError instanceof NonRetryableError
    );
  }

  return {
    success: true,
    moduleId,
    status: executedStatus,
  };
}

/**
 * Checks all module results for a report. If none are PENDING or RUNNING,
 * determines the final report status (COMPLETED / PARTIALLY_FAILED / FAILED)
 * and executes finalizeReport.
 */
export async function checkAndFinalizeReportIfDone(reportId: string, db: any) {
  const currentReport = await db.report.findUnique({
    where: { id: reportId },
    include: { moduleResults: true },
  });

  if (!currentReport) return;

  const requestedModules = currentReport.moduleResults.filter(
    (m: any) => m.status !== "NOT_REQUESTED"
  );

  const hasIncomplete = requestedModules.some(
    (m: any) => m.status === "PENDING" || m.status === "RUNNING"
  );

  if (hasIncomplete) {
    if (currentReport.status !== "PROCESSING") {
      await db.report.update({
        where: { id: reportId },
        data: { status: "PROCESSING" },
      });
    }
    return;
  }

  const successCount = requestedModules.filter(
    (m: any) => m.status === "SUCCEEDED" || m.status === "NO_DATA"
  ).length;
  const failureCount = requestedModules.filter((m: any) => m.status === "FAILED").length;

  let finalStatus: "COMPLETED" | "PARTIALLY_FAILED" | "FAILED" = "COMPLETED";
  if (failureCount > 0) {
    finalStatus = successCount > 0 ? "PARTIALLY_FAILED" : "FAILED";
  }

  await finalizeReport(reportId, finalStatus, { customPrisma: db });
}
