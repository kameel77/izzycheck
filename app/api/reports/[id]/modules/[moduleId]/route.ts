import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { executeReportModule, ModuleExecutionError } from "@/lib/reports/module-executor";
import { prisma } from "@/lib/db";
import { ReportModuleId } from "@prisma/client";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; moduleId: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Brak autoryzacji. Zaloguj się ponownie." }, { status: 401 });
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

    const result = await executeReportModule(reportId, moduleId, { userId: user.userId, role: user.role });

    // Record Audit Event
    await prisma.auditEvent.create({
      data: {
        userId: user.userId,
        userEmail: user.email,
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
