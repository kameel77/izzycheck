import { NextResponse } from "next/server";
import { getCurrentUser, getFreshUser } from "@/lib/auth";
import { ModuleExecutionError } from "@/lib/reports/module-executor";
import { skipReportModule } from "@/lib/reports/skip-module";
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

    await skipReportModule(reportId, moduleId, {
      userId: freshUser.id,
      role: freshUser.role,
      organizationId: freshUser.organizationId,
    });

    await prisma.auditEvent.create({
      data: {
        userId: freshUser.id,
        userEmail: freshUser.email,
        action: "SKIP_MODULE",
        resource: `Report:${reportId}:Module:${moduleId}`,
        metadataJson: JSON.stringify({ reportId, moduleId }),
      },
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err instanceof ModuleExecutionError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }

    console.error("[MODULE_SKIP_ROUTE_ERROR]", err);
    return NextResponse.json(
      { error: err.message || "Wystąpił wewnętrzny błąd serwera podczas pomijania modułu." },
      { status: 500 }
    );
  }
}
