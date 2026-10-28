import { prisma } from "../db.ts";
import type { ReportModuleId, Role } from "@prisma/client";
import { releaseCredit } from "../billing/credits.ts";
import { ModuleExecutionError, checkAndFinalizeReportIfDone } from "./module-executor.ts";

const SKIPPABLE_MODULES: ReportModuleId[] = ["VALUATION", "CLAIM_DETAILS"];

export interface SkipModuleOptions {
  customPrisma?: any;
  userId: string;
  role: Role;
  organizationId: string | null;
}

/**
 * Skips a paid module that cannot run (e.g. no credits): drops any dangling credit reservation, marks the
 * module NOT_REQUESTED and lets the report finish without it.
 */
export async function skipReportModule(
  reportId: string,
  moduleId: ReportModuleId,
  options: SkipModuleOptions
): Promise<{ success: true; moduleId: ReportModuleId }> {
  const db = options.customPrisma || prisma;

  const report = await db.report.findUnique({
    where: { id: reportId },
    include: { moduleResults: true },
  });

  if (!report) {
    throw new ModuleExecutionError("Raport nie został odnaleziony w systemie.", 404);
  }

  // Same access rule as module execution: report owner, ADMIN, or MANAGER in the same organization
  const isOwner = report.createdById === options.userId;
  const isAdmin = options.role === "ADMIN";
  const isOrgManager =
    options.role === "MANAGER" &&
    Boolean(options.organizationId && report.organizationId && options.organizationId === report.organizationId);

  if (!isOwner && !isAdmin && !isOrgManager) {
    throw new ModuleExecutionError("Dostęp zabroniony. Nie posiadasz uprawnień do tego raportu.", 403);
  }

  if (!SKIPPABLE_MODULES.includes(moduleId)) {
    throw new ModuleExecutionError("Tego modułu nie można pominąć.", 400);
  }

  // A report with a stored PDF is frozen: skipping would re-finalize it and overwrite the frozen document
  if (report.pdfBytes) {
    throw new ModuleExecutionError("Raport został już zamrożony i nie może zostać zmieniony.", 409);
  }

  const targetModule = report.moduleResults.find((m: any) => m.moduleId === moduleId);
  if (!targetModule) {
    throw new ModuleExecutionError("Ten moduł nie został zamówiony w ramach bieżącego raportu.", 400);
  }
  if (targetModule.status === "RUNNING") {
    throw new ModuleExecutionError("Moduł jest obecnie przetwarzany. Spróbuj ponownie za chwilę.", 409);
  }
  if (targetModule.status !== "PENDING" && targetModule.status !== "FAILED") {
    throw new ModuleExecutionError("Ten moduł nie może zostać pominięty w bieżącym stanie.", 400);
  }

  await db.$transaction(async (tx: any) => {
    // Guarded transition first: if the module started running (or was captured) meanwhile, nothing is hidden or released.
    const { count } = await tx.reportModuleResult.updateMany({
      where: { id: targetModule.id, status: { in: ["PENDING", "FAILED"] } },
      data: { status: "NOT_REQUESTED", errorMessage: null },
    });
    if (count === 0) {
      throw new ModuleExecutionError("Moduł jest obecnie przetwarzany przez inne żądanie.", 409);
    }
    // A reservation may still be held (e.g. a crashed execution); returns the credit if so.
    await releaseCredit(tx, { reportId, moduleId });
  });

  await checkAndFinalizeReportIfDone(reportId, db);

  return { success: true, moduleId };
}
