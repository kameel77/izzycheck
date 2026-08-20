import React from "react";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { AudatexValuationAdapter } from "@/lib/audatex/valuation";
import { AudatexHistoryAdapter } from "@/lib/audatex/history";
import { prisma } from "@/lib/db";
import { isRateLimited } from "@/lib/rate-limit";
import { computeRequestHash } from "@/lib/audatex/hash";
import { Prisma } from "@prisma/client";
import { generateMonotonicReference } from "@/lib/reports/reference";
import { buildReportPdfViewModel } from "@/lib/pdf/report-pdf-view-model";
import pkg from "@/package.json" with { type: "json" };

const valuationAdapter = new AudatexValuationAdapter();
const historyAdapter = new AudatexHistoryAdapter();

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Brak autoryzacji. Zaloguj się ponownie." }, { status: 401 });
    }

    // Rate Limit: max 10 report creations per minute per user
    const rateCheck = isRateLimited("reports_create", user.userId, 10, 60000);
    if (rateCheck.limited) {
      return NextResponse.json(
        { error: `Zbyt wiele zapytań o raporty. Odczekaj ${Math.ceil(rateCheck.resetMs / 1000)} sekund przed kolejnym zapytaniem.` },
        { status: 429 }
      );
    }

    const body = await req.json();
    let { vin, firstRegistrationDate, mileage, valuationDate, manufactureDate, modules } = body;

    // 1. VIN normalization & syntax validation
    if (!vin || typeof vin !== "string") {
      return NextResponse.json({ error: "Numer VIN jest wymagany." }, { status: 400 });
    }

    vin = vin.replace(/[\s-]/g, "").toUpperCase();

    if (vin.length !== 17 || !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
      return NextResponse.json(
        { error: "Nieprawidłowy format VIN. VIN musi składać się z 17 znaków alfanumerycznych (z wyłączeniem I, O, Q)." },
        { status: 400 }
      );
    }

    // 2. First registration date validation
    if (!firstRegistrationDate || !/^\d{4}-\d{2}-\d{2}$/.test(firstRegistrationDate)) {
      return NextResponse.json(
        { error: "Data pierwszej rejestracji jest wymagana w formacie YYYY-MM-DD." },
        { status: 400 }
      );
    }

    // 3. Modules selection check
    const { includeValuation, includeClaimCheck, includeClaimDetails } = modules || {};

    if (!includeValuation && !includeClaimCheck && !includeClaimDetails) {
      return NextResponse.json(
        { error: "Musisz wybrać co najmniej jeden moduł raportu (wycena, kontrola szkód lub szczegóły szkód)." },
        { status: 400 }
      );
    }

    const mileageNum = mileage ? parseInt(String(mileage), 10) : undefined;
    const todayStr = new Date().toISOString().split("T")[0];
    const valDate = valuationDate || todayStr;

    const idempotencyHeader = req.headers.get("idempotency-key") || req.headers.get("x-idempotency-key");
    const currentRequestHash = computeRequestHash({
      vin,
      firstRegistrationDate,
      mileage: mileageNum,
      valuationDate: valDate,
      manufactureDate,
      modules,
    });

    // 4. Strictly checked Idempotency & Deduplication
    if (idempotencyHeader) {
      // Atomic unique lookup per user + idempotency key
      const existingByKey = await prisma.report.findFirst({
        where: {
          createdById: user.userId,
          idempotencyKey: idempotencyHeader,
        },
      });
      if (existingByKey) {
        return NextResponse.json({
          success: true,
          reportId: existingByKey.id,
          vin: existingByKey.vin,
          status: existingByKey.status,
          isDuplicateDeduplicated: true,
          idempotencyKeyMatched: true,
        });
      }
    } else {
      // Short-window request hash lookup per user within 60s window
      const sixtySecondsAgo = new Date(Date.now() - 60000);
      const existingByHash = await prisma.report.findFirst({
        where: {
          createdById: user.userId,
          requestHash: currentRequestHash,
          createdAt: { gte: sixtySecondsAgo },
        },
      });

      if (existingByHash) {
        return NextResponse.json({
          success: true,
          reportId: existingByHash.id,
          vin: existingByHash.vin,
          status: existingByHash.status,
          isDuplicateDeduplicated: true,
          requestHashMatched: true,
        });
      }
    }

    // 5. Create Report record in Database with atomic unique constraint protection
    let report;
    try {
      const publicRef = await generateMonotonicReference();
      report = await prisma.report.create({
        data: {
          publicReference: publicRef,
          vin,
          firstRegistrationDate,
          mileage: mileageNum,
          valuationDate: valDate,
          createdById: user.userId,
          idempotencyKey: idempotencyHeader || null,
          requestHash: currentRequestHash,
          status: "PROCESSING",
        },
      });
    } catch (err: any) {
      // Race condition handling: Unique constraint violation (code P2002) on createdById + idempotencyKey
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && idempotencyHeader) {
        const winningReport = await prisma.report.findFirst({
          where: {
            createdById: user.userId,
            idempotencyKey: idempotencyHeader,
          },
        });
        if (winningReport) {
          return NextResponse.json({
            success: true,
            reportId: winningReport.id,
            vin: winningReport.vin,
            status: winningReport.status,
            isDuplicateDeduplicated: true,
            raceConditionResolved: true,
          });
        }
      }
      throw err;
    }

    let valuationResultData: any = null;
    let claimCheckResultData: any = null;
    let claimDetailsResultData: any = null;

    let moduleSuccessCount = 0;
    let moduleFailureCount = 0;

    // --- MODULE 1: VALUATION & EQUIPMENT ---
    if (includeValuation) {
      try {
        const valRes = await valuationAdapter.evaluateVehicle({
          vin,
          dateOfFirstReg: firstRegistrationDate,
          mileage: mileageNum,
          valuationDate: valDate,
          manufactureDate,
        });
        valuationResultData = valRes;
        moduleSuccessCount++;

        await prisma.vehicleSnapshot.create({
          data: {
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
        });

        await prisma.reportModuleResult.create({
          data: {
            reportId: report.id,
            moduleId: "VALUATION",
            status: "SUCCEEDED",
            responseMetadata: JSON.stringify({ ibsCode: valRes.ibsCode, make: valRes.make, model: valRes.model }),
          },
        });
      } catch (err: any) {
        moduleFailureCount++;
        await prisma.reportModuleResult.create({
          data: {
            reportId: report.id,
            moduleId: "VALUATION",
            status: "FAILED",
            errorMessage: err.message || "AUDATEX_VALUATION_ERROR: Błąd modułu wyceny.",
          },
        });
      }
    }

    // --- MODULE 2: CLAIMS HISTORY CHECK (hasHistory) ---
    if (includeClaimCheck || includeClaimDetails) {
      try {
        const checkRes = await historyAdapter.checkClaimHistory({
          vin,
          firstRegistration: firstRegistrationDate,
        });
        claimCheckResultData = checkRes;
        moduleSuccessCount++;

        const moduleStatus = checkRes.hasHistory ? "SUCCEEDED" : "NO_DATA";

        await prisma.reportModuleResult.create({
          data: {
            reportId: report.id,
            moduleId: "CLAIM_CHECK",
            status: moduleStatus,
            responseMetadata: JSON.stringify({
              hasHistory: checkRes.hasHistory,
              photosStatus: checkRes.photosStatus,
              advice: checkRes.advice,
            }),
          },
        });

        // --- MODULE 3: CLAIMS DETAILS (getDetails) ---
        // Audatex PRD requirement: run getDetails ONLY IF hasHistory is true!
        if (includeClaimDetails) {
          if (checkRes.hasHistory) {
            try {
              const detailsRes = await historyAdapter.getClaimDetails({
                vin,
                firstRegistration: firstRegistrationDate,
              });
              claimDetailsResultData = detailsRes;
              moduleSuccessCount++;

              for (const claim of detailsRes.claims) {
                await prisma.damageClaim.create({
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

              await prisma.reportModuleResult.create({
                data: {
                  reportId: report.id,
                  moduleId: "CLAIM_DETAILS",
                  status: "SUCCEEDED",
                  responseMetadata: JSON.stringify({ claimsCount: detailsRes.claims.length }),
                },
              });
            } catch (err: any) {
              moduleFailureCount++;
              await prisma.reportModuleResult.create({
                data: {
                  reportId: report.id,
                  moduleId: "CLAIM_DETAILS",
                  status: "FAILED",
                  errorMessage: err.message || "AUDATEX_CHE_ERROR: Błąd pobierania szczegółów szkód getDetails.",
                },
              });
            }
          } else {
            // hasHistory returned false -> getDetails unavailable
            await prisma.reportModuleResult.create({
              data: {
                reportId: report.id,
                moduleId: "CLAIM_DETAILS",
                status: "NO_DATA",
                errorMessage: "Szczegóły szkód niedostępne: brak wpisów w weryfikacji wstępnej hasHistory.",
              },
            });
          }
        }
      } catch (err: any) {
        moduleFailureCount++;
        await prisma.reportModuleResult.create({
          data: {
            reportId: report.id,
            moduleId: "CLAIM_CHECK",
            status: "FAILED",
            errorMessage: err.message || "AUDATEX_CHE_ERROR: Błąd kontroli historii szkód Audatex CHE.",
          },
        });
      }
    }

    // Determine honest final status
    let finalStatus = "COMPLETED";
    if (moduleFailureCount > 0 && moduleSuccessCount > 0) {
      finalStatus = "PARTIALLY_FAILED";
    } else if (moduleFailureCount > 0 && moduleSuccessCount === 0) {
      finalStatus = "FAILED";
    }

    let pdfBytes: Buffer | null = null;
    let pdfGeneratedAt: Date | null = null;
    let pdfGeneratorVersion: string | null = null;

    // Render & freeze immutable PDF at finalisation if not completely failed
    if (finalStatus !== "FAILED") {
      try {
        const fullReport = await prisma.report.findUnique({
          where: { id: report.id },
          include: {
            createdBy: { select: { id: true, name: true, email: true } },
            moduleResults: { select: { moduleId: true, status: true, responseMetadata: true, errorMessage: true } },
            vehicleSnapshot: true,
            damageClaims: true,
          },
        });
        if (fullReport) {
          const viewModel = buildReportPdfViewModel(fullReport);
          let pdfBuffer: Buffer;
          if (globalThis.__mockRenderToBuffer) {
            pdfBuffer = await globalThis.__mockRenderToBuffer(viewModel);
          } else {
            const { ReportPdfDocument } = await import("@/lib/pdf/report-pdf-document");
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

    await prisma.report.update({
      where: { id: report.id },
      data: {
        status: finalStatus,
        ...(pdfBytes ? { pdfBytes: pdfBytes as any, pdfGeneratedAt, pdfGeneratorVersion } : {}),
      },
    });

    // Record Audit Event
    await prisma.auditEvent.create({
      data: {
        userId: user.userId,
        userEmail: user.email,
        action: "CREATE_REPORT",
        resource: `REPORT:${report.id}`,
        metadataJson: JSON.stringify({
          vin,
          firstRegistrationDate,
          status: finalStatus,
          idempotencyKey: idempotencyHeader || null,
          requestHash: currentRequestHash,
          modulesRequested: { includeValuation, includeClaimCheck, includeClaimDetails },
        }),
      },
    });

    return NextResponse.json({
      success: true,
      reportId: report.id,
      vin,
      status: finalStatus,
      firstRegistrationDate,
      valuation: valuationResultData,
      claimCheck: claimCheckResultData,
      claimDetails: claimDetailsResultData,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Błąd serwera podczas generowania raportu." }, { status: 500 });
  }
}
