import React from "react";
import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../../lib/auth.ts";
import { prisma } from "../../../../../lib/db.ts";
import { buildReportPdfViewModel } from "../../../../../lib/pdf/report-pdf-view-model.ts";
import pkg from "../../../../../package.json" with { type: "json" };

declare global {
  var __mockRenderToBuffer: ((viewModel: any) => Promise<Buffer>) | undefined;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
    }

    const { id } = await params;

    const report = await prisma.report.findUnique({
      where: { id },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        moduleResults: { select: { moduleId: true, status: true, responseMetadata: true, errorMessage: true } },
        vehicleSnapshot: true,
        damageClaims: true,
      },
    });

    if (!report) {
      return NextResponse.json({ error: "Nie odnaleziono raportu w bazie danych." }, { status: 404 });
    }

    // RBAC: ADMIN can view any report, OPERATOR only their own
    if (user.role !== "ADMIN" && report.createdById !== user.userId) {
      return NextResponse.json(
        { error: "Dostęp zabroniony. Nie posiadasz uprawnień do pobierania tego raportu." },
        { status: 403 }
      );
    }

    let pdfBuffer: Buffer;

    // 1. If PDF bytes are already immutable in the database, serve them directly
    if (report.pdfBytes) {
      pdfBuffer = Buffer.from(report.pdfBytes);
    } else {
      // 2. Otherwise generate PDF view model & render buffer
      const viewModel = buildReportPdfViewModel(report);
      
      if (globalThis.__mockRenderToBuffer) {
        pdfBuffer = await globalThis.__mockRenderToBuffer(viewModel);
      } else {
        const { ReportPdfDocument } = await import("../../../../../lib/pdf/report-pdf-document.tsx");
        const { renderToBuffer } = await import("@react-pdf/renderer");
        const pdfElement = React.createElement(ReportPdfDocument, { model: viewModel }) as any;
        pdfBuffer = await renderToBuffer(pdfElement);
      }

      // 3. Persist generated PDF bytes to PostgreSQL ONLY if the report is COMPLETED (never for PARTIALLY_FAILED/PROCESSING)
      if (report.status === "COMPLETED") {
        await prisma.report.update({
          where: { id: report.id },
          data: {
            pdfBytes: Buffer.from(pdfBuffer) as any,
            pdfGeneratedAt: new Date(),
            pdfGeneratorVersion: pkg.version || "0.1.0",
          },
        });
      }
    }

    // Record Audit Event (no raw XML or PDF content)
    await prisma.auditEvent.create({
      data: {
        userId: user.userId,
        userEmail: user.email,
        action: "DOWNLOAD_REPORT_PDF",
        resource: `REPORT:${report.id}`,
        metadataJson: JSON.stringify({
          vin: report.vin,
          reportId: report.id,
          publicReference: report.publicReference,
          pdfSizeBytes: pdfBuffer.length,
        }),
      },
    });

    const filename = `Raport-IzzyCheck-${report.publicReference || report.vin}.pdf`;

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Błąd podczas generowania dokumentu PDF." },
      { status: 500 }
    );
  }
}
