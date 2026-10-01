import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { finalizeReport } from "@/lib/reports/finalize";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Brak autoryzacji. Zaloguj się ponownie." }, { status: 401 });
    }

    const resolvedParams = await params;
    const { id: reportId } = resolvedParams;

    const report = await prisma.report.findUnique({
      where: { id: reportId },
      include: { moduleResults: true },
    });

    if (!report) {
      return NextResponse.json({ error: "Raport nie został odnaleziony." }, { status: 404 });
    }

    // Strict RBAC Access Policy (same as GET /api/reports/[id]): ADMIN or report owner only
    if (user.role !== "ADMIN" && report.createdById !== user.userId) {
      return NextResponse.json(
        { error: "Dostęp zabroniony. Nie posiadasz uprawnień do zatwierdzenia tego raportu." },
        { status: 403 }
      );
    }

    // Role and Reason Check (RBAC: ADMIN or mandatory reason)
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const { reason } = body;
    const isAdmin = user.role === "ADMIN";
    const trimmedReason = typeof reason === "string" ? reason.trim() : "";

    if (!isAdmin && trimmedReason.length < 5) {
      return NextResponse.json(
        { error: "Zatwierdzenie niepełnego raportu wymaga uprawnień administratora lub podania uzasadnienia (min. 5 znaków)." },
        { status: 403 }
      );
    }

    if (report.status !== "PARTIALLY_FAILED") {
      return NextResponse.json(
        { error: `Tylko raporty w stanie PARTIALLY_FAILED mogą zostać zatwierdzone jako niepełne (obecny status: ${report.status}).` },
        { status: 400 }
      );
    }

    // Freeze snapshot PDF with forceFreeze
    const finalized = await finalizeReport(reportId, "PARTIALLY_FAILED", { forceFreeze: true });

    // Record Audit Event: ACCEPT_AND_FREEZE_REPORT
    await prisma.auditEvent.create({
      data: {
        userId: user.userId,
        userEmail: user.email,
        action: "ACCEPT_AND_FREEZE_REPORT",
        resource: `Report:${reportId}`,
        metadataJson: JSON.stringify({
          reportId,
          operatorId: user.userId,
          operatorEmail: user.email,
          reason: trimmedReason || "Zatwierdzenie przez administratora",
          isAdmin,
        }),
      },
    });

    return NextResponse.json({
      success: true,
      reportId: finalized.id,
      status: finalized.status,
      pdfGeneratedAt: finalized.pdfGeneratedAt,
      frozen: true,
    });
  } catch (err: any) {
    console.error("[REPORT_FREEZE_ROUTE_ERROR]", err);
    return NextResponse.json(
      { error: err.message || "Wystąpił wewnętrzny błąd serwera podczas zatwierdzania raportu." },
      { status: 500 }
    );
  }
}
