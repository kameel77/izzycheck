import React from "react";
import { prisma } from "../db.ts";
import { buildReportPdfViewModel } from "../pdf/report-pdf-view-model.ts";
import pkg from "../../package.json" with { type: "json" };

export interface FinalizeReportOptions {
  customPrisma?: any;
  forceFreeze?: boolean;
}

/**
 * Finalizes a report state.
 * Invariant (D-4 & D-6):
 * - pdfBytes is FROZEN on COMPLETED, or on PARTIALLY_FAILED when forceFreeze is explicitly set by an authorized operator action.
 * - For PARTIALLY_FAILED (without forceFreeze), FAILED, or PROCESSING, pdfBytes is NEVER frozen,
 *   allowing subsequent module retries to repair the report without serving stale documents.
 */
export async function finalizeReport(
  reportId: string,
  finalStatus: "COMPLETED" | "PARTIALLY_FAILED" | "FAILED",
  options: FinalizeReportOptions = {}
) {
  const db = options.customPrisma || prisma;

  let pdfBytes: Buffer | null = null;
  let pdfGeneratedAt: Date | null = null;
  let pdfGeneratorVersion: string | null = null;

  // Render & freeze immutable PDF on COMPLETED or on PARTIALLY_FAILED with explicit forceFreeze
  const shouldFreeze = finalStatus === "COMPLETED" || (finalStatus === "PARTIALLY_FAILED" && options.forceFreeze);

  if (shouldFreeze) {
    try {
      const fullReport = await db.report.findUnique({
        where: { id: reportId },
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
          moduleResults: { select: { moduleId: true, status: true, responseMetadata: true, errorMessage: true } },
          vehicleSnapshot: true,
          damageClaims: true,
        },
      });

      if (fullReport) {
        // fullReport is read BEFORE the status update below, so it still says PROCESSING: render with the final status
        const viewModel = buildReportPdfViewModel({ ...fullReport, status: finalStatus });
        let pdfBuffer: Buffer;

        if (globalThis.__mockRenderToBuffer) {
          pdfBuffer = await globalThis.__mockRenderToBuffer(viewModel);
        } else {
          const { ReportPdfDocument } = await import("../pdf/report-pdf-document.tsx");
          const { renderToBuffer } = await import("@react-pdf/renderer");
          const pdfElement = React.createElement(ReportPdfDocument, { model: viewModel }) as any;
          pdfBuffer = await renderToBuffer(pdfElement);
        }

        pdfBytes = Buffer.from(pdfBuffer);
        pdfGeneratedAt = new Date();
        pdfGeneratorVersion = pkg.version || "0.1.0";
      }
    } catch (pdfErr) {
      console.error("[REPORT_PDF_FINALIZATION_ERROR]", pdfErr);
    }
  }

  const updatedReport = await db.report.update({
    where: { id: reportId },
    data: {
      status: finalStatus,
      ...(pdfBytes ? { pdfBytes: pdfBytes as any, pdfGeneratedAt, pdfGeneratorVersion } : {}),
    },
  });

  return updatedReport;
}
