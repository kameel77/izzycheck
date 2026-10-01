import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isModuleLockStale } from "@/lib/reports/module-executor";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
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
        createdBy: { select: { id: true, name: true, email: true } },
        moduleResults: { select: { moduleId: true, status: true, responseMetadata: true, errorMessage: true, updatedAt: true } },
        vehicleSnapshot: true,
        damageClaims: true,
      },
    });

    if (!report) {
      return NextResponse.json({ error: "Nie odnaleziono raportu w bazie danych." }, { status: 404 });
    }

    // Strict RBAC Access Policy for Reports:
    // ADMIN role: can view any report
    // OPERATOR role: can view ONLY reports created by themselves (createdById === user.userId)
    if (user.role !== "ADMIN" && report.createdById !== user.userId) {
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

    return NextResponse.json({ success: true, report: reportWithStaleFlags });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Błąd pobierania raportu z bazy." }, { status: 500 });
  }
}
