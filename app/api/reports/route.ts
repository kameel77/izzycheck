import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { AudatexValuationAdapter } from "@/lib/audatex/valuation";
import { AudatexHistoryAdapter } from "@/lib/audatex/history";
import { prisma } from "@/lib/db";
import { isRateLimited } from "@/lib/rate-limit";
import { computeRequestHash } from "@/lib/audatex/hash";

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

    const idempotencyHeader = req.headers.get("idempotency-key");
    const currentRequestHash = computeRequestHash({
      vin,
      firstRegistrationDate,
      mileage,
      valuationDate,
      manufactureDate,
      modules,
    });

    // Idempotency / Deduplication check: Match exact request parameters within 60s window
    const sixtySecondsAgo = new Date(Date.now() - 60000);
    const existingRecentReport = await prisma.report.findFirst({
      where: {
        vin,
        createdById: user.userId,
        createdAt: { gte: sixtySecondsAgo },
      },
      include: { moduleResults: true },
      orderBy: { createdAt: "desc" },
    });

    if (existingRecentReport && (idempotencyHeader || existingRecentReport.moduleResults.length > 0)) {
      const existingModuleIds = new Set(existingRecentReport.moduleResults.map((m) => m.moduleId));
      const requestedValuationMatches = !includeValuation || existingModuleIds.has("VALUATION");
      const requestedCheckMatches = !includeClaimCheck || existingModuleIds.has("CLAIM_CHECK");
      const requestedDetailsMatches = !includeClaimDetails || existingModuleIds.has("CLAIM_DETAILS");

      if (idempotencyHeader || (requestedValuationMatches && requestedCheckMatches && requestedDetailsMatches)) {
        return NextResponse.json({
          success: true,
          reportId: existingRecentReport.id,
          vin: existingRecentReport.vin,
          status: existingRecentReport.status,
          isDuplicateDeduplicated: true,
        });
      }
    }

    const mileageNum = mileage ? parseInt(String(mileage), 10) : undefined;
    const todayStr = new Date().toISOString().split("T")[0];
    const valDate = valuationDate || todayStr;

    // 4. Create Report record in Database
    const report = await prisma.report.create({
      data: {
        vin,
        firstRegistrationDate,
        mileage: mileageNum,
        valuationDate: valDate,
        createdById: user.userId,
        status: "PROCESSING",
      },
    });

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
            manufactureDate: valRes.manufactureDate || null,
            standardEquipment: JSON.stringify(valRes.standardEquipment),
            optionalEquipment: JSON.stringify(valRes.optionalEquipment),
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
            errorMessage: err.message || "Błąd wyceny AudaValuation.",
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
                  errorMessage: err.message || "Błąd pobierania szczegółów szkód getDetails.",
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
            errorMessage: err.message || "Błąd kontroli historii szkód Audatex CHE.",
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

    await prisma.report.update({
      where: { id: report.id },
      data: { status: finalStatus },
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
