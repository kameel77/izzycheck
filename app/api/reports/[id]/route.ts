import { NextResponse } from "next/server";
import { getCurrentUser, getFreshUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isModuleLockStale } from "@/lib/reports/module-executor";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const sessionUser = await getCurrentUser();
    if (!sessionUser) {
      return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
    }

    const freshUser = await getFreshUser(sessionUser.userId);
    if (!freshUser || !freshUser.isActive) {
      return NextResponse.json({ error: "Konto użytkownika jest nieaktywne lub nie istnieje." }, { status: 401 });
    }

    const { id } = await params;

    const report = await prisma.report.findUnique({
      where: { id },
      select: {
        id: true,
        publicReference: true,
        vin: true,
        firstRegistrationDate: true,
        mileage: true,
        valuationDate: true,
        status: true,
        idempotencyKey: true,
        requestHash: true,
        pdfGeneratedAt: true,
        pdfGeneratorVersion: true,
        createdAt: true,
        updatedAt: true,
        createdById: true,
        organizationId: true,
        createdBy: { select: { id: true, name: true, email: true } },
        moduleResults: { select: { moduleId: true, status: true, responseMetadata: true, errorMessage: true, updatedAt: true } },
        vehicleSnapshot: true,
        damageClaims: true,
      },
    });

    if (!report) {
      return NextResponse.json({ error: "Nie odnaleziono raportu w bazie danych." }, { status: 404 });
    }

    // Strict Scoped RBAC Access Policy for Reports:
    // ADMIN role: can view any report
    // Report Owner: can view their own report
    // MANAGER role: can view any report within their organization
    // USER with canViewOrgReports: can view any report within their organization
    const isOwner = report.createdById === freshUser.id;
    const isAdmin = freshUser.role === "ADMIN";
    const isOrgManager =
      freshUser.role === "MANAGER" &&
      Boolean(freshUser.organizationId && report.organizationId && freshUser.organizationId === report.organizationId);
    const isOrgUserWithPerm =
      Boolean(freshUser.canViewOrgReports && freshUser.organizationId && report.organizationId && freshUser.organizationId === report.organizationId);

    if (!isOwner && !isAdmin && !isOrgManager && !isOrgUserWithPerm) {
      return NextResponse.json(
        { error: "Dostęp zabroniony. Nie posiadasz uprawnień do przeglądania tego raportu." },
        { status: 403 }
      );
    }

    // Server clock decides whether a RUNNING module lock is stale (client may re-dispatch it)
    const reportWithStaleFlags = {
      ...report,
      moduleResults: report.moduleResults.map((m) => ({ ...m, isStaleLock: isModuleLockStale(m) })),
    };

    return NextResponse.json({
      success: true,
      viewerRole: freshUser.role,
      report: reportWithStaleFlags,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Błąd pobierania raportu z bazy." }, { status: 500 });
  }
}
