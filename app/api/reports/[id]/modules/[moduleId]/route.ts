import { NextResponse } from "next/server";
import { getCurrentUser, getFreshUser } from "@/lib/auth";
import { executeReportModule, ModuleExecutionError } from "@/lib/reports/module-executor";
import { prisma } from "@/lib/db";
import { ReportModuleId } from "@prisma/client";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; moduleId: string }> }
) {
  try {
    const sessionUser = await getCurrentUser();
    if (!sessionUser) {
      return NextResponse.json({ error: "Brak autoryzacji. Zaloguj się ponownie." }, { status: 401 });
    }

    const freshUser = await getFreshUser(sessionUser.userId);
    if (!freshUser || !freshUser.isActive) {
      return NextResponse.json({ error: "Konto użytkownika jest nieaktywne lub nie istnieje." }, { status: 401 });
    }

    if (freshUser.role !== "ADMIN" && freshUser.organization && !freshUser.organization.isActive) {
      return NextResponse.json({ error: "Organizacja została zablokowana." }, { status: 403 });
    }

    const resolvedParams = await params;
    const { id: reportId, moduleId: rawModuleId } = resolvedParams;

    const validModules: ReportModuleId[] = ["VALUATION", "CLAIM_CHECK", "CLAIM_DETAILS"];
    if (!validModules.includes(rawModuleId as ReportModuleId)) {
      return NextResponse.json(
        { error: `Nieprawidłowy identyfikator modułu: ${rawModuleId}. Dopuszczalne: VALUATION, CLAIM_CHECK, CLAIM_DETAILS.` },
        { status: 400 }
      );
    }

    const moduleId = rawModuleId as ReportModuleId;

    // Check if target module was previously FAILED (to label audit event appropriately)
    const existingMod = await prisma.reportModuleResult.findUnique({
      where: { reportId_moduleId: { reportId, moduleId } },
    });
    const isRetry = existingMod?.status === "FAILED";

    const result = await executeReportModule(reportId, moduleId, {
      userId: freshUser.id,
      role: freshUser.role,
      organizationId: freshUser.organizationId,
      canGenerateValuation: freshUser.canGenerateValuation,
      canGenerateClaimCheck: freshUser.canGenerateClaimCheck,
      canGenerateClaimDetails: freshUser.canGenerateClaimDetails,
    });

    // Record Audit Event
    await prisma.auditEvent.create({
      data: {
        userId: freshUser.id,
        userEmail: freshUser.email,
        action: isRetry ? "RETRY_MODULE" : "EXECUTE_MODULE",
        resource: `Report:${reportId}:Module:${moduleId}`,
        metadataJson: JSON.stringify({
          reportId,
          moduleId,
          status: result.status,
          isRetry,
        }),
      },
    });

    return NextResponse.json({
      success: true,
      reportId,
      moduleId,
      status: result.status,
    });
  } catch (err: any) {
    if (err instanceof ModuleExecutionError) {
      return NextResponse.json(
        {
          error: err.message,
          isNonRetryable: err.isNonRetryable,
          ...(err.code ? { code: err.code } : {}),
          ...(err.creditType ? { creditType: err.creditType } : {}),
        },
        { status: err.statusCode }
      );
    }

    console.error("[MODULE_EXECUTION_ROUTE_ERROR]", err);
    return NextResponse.json(
      { error: err.message || "Wystąpił wewnętrzny błąd serwera podczas wykonywania modułu." },
      { status: 500 }
    );
  }
}
