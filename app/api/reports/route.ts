import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { AudatexValuationAdapter } from "@/lib/audatex/valuation";
import { AudatexHistoryAdapter } from "@/lib/audatex/history";
import { prisma } from "@/lib/db";

const valuationAdapter = new AudatexValuationAdapter();
const historyAdapter = new AudatexHistoryAdapter();

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Brak autoryzacji. Zaloguj się ponownie." }, { status: 401 });
    }

    const body = await req.json();
    let { vin, firstRegistrationDate, mileage, valuationDate, modules } = body;

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

    // 4. Create Report record
    let report: any;
    try {
      report = await prisma.report.create({
        data: {
          vin,
          firstRegistrationDate,
          mileage: mileageNum,
          valuationDate: valDate,
          createdById: user.userId,
          status: "PROCESSING",
        },
      });
    } catch (e) {
      // In-memory fallback if DB table is unmigrated during demo
      report = {
        id: `rep-${Date.now()}`,
        vin,
        firstRegistrationDate,
        mileage: mileageNum,
        valuationDate: valDate,
        createdById: user.userId,
        status: "PROCESSING",
        createdAt: new Date(),
      };
    }

    let valuationResultData: any = null;
    let claimCheckResultData: any = null;
    let claimDetailsResultData: any = null;

    // --- MODULE 1: VALUATION & EQUIPMENT ---
    if (includeValuation) {
      try {
        const valRes = await valuationAdapter.evaluateVehicle({
          vin,
          dateOfFirstReg: firstRegistrationDate,
          mileage: mileageNum,
          valuationDate: valDate,
        });
        valuationResultData = valRes;

        try {
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
            },
          });

          await prisma.reportModuleResult.create({
            data: {
              reportId: report.id,
              moduleId: "VALUATION",
              status: "SUCCEEDED",
              rawXml: valRes.rawXml,
              responseMetadata: JSON.stringify({ ibsCode: valRes.ibsCode, make: valRes.make, model: valRes.model }),
            },
          });
        } catch (e) {}
      } catch (err: any) {
        try {
          await prisma.reportModuleResult.create({
            data: {
              reportId: report.id,
              moduleId: "VALUATION",
              status: "FAILED",
              errorMessage: err.message || "Błąd wyceny AudaValuation.",
            },
          });
        } catch (e) {}
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

        const moduleStatus = checkRes.hasHistory ? "SUCCEEDED" : "NO_DATA";

        try {
          await prisma.reportModuleResult.create({
            data: {
              reportId: report.id,
              moduleId: "CLAIM_CHECK",
              status: moduleStatus,
              rawXml: checkRes.rawXml,
              responseMetadata: JSON.stringify({
                hasHistory: checkRes.hasHistory,
                photosStatus: checkRes.photosStatus,
                advice: checkRes.advice,
              }),
            },
          });
        } catch (e) {}

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

              try {
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
                    rawXml: detailsRes.rawXml,
                    responseMetadata: JSON.stringify({ claimsCount: detailsRes.claims.length }),
                  },
                });
              } catch (e) {}
            } catch (err: any) {
              try {
                await prisma.reportModuleResult.create({
                  data: {
                    reportId: report.id,
                    moduleId: "CLAIM_DETAILS",
                    status: "FAILED",
                    errorMessage: err.message || "Błąd pobierania szczegółów szkód getDetails.",
                  },
                });
              } catch (e) {}
            }
          } else {
            // hasHistory was false -> getDetails cannot be run according to Audatex spec
            try {
              await prisma.reportModuleResult.create({
                data: {
                  reportId: report.id,
                  moduleId: "CLAIM_DETAILS",
                  status: "NO_DATA",
                  errorMessage: "Szczegóły szkód niedostępne: brak wpisów w weryfikacji wstępnej hasHistory.",
                },
              });
            } catch (e) {}
          }
        }
      } catch (err: any) {
        try {
          await prisma.reportModuleResult.create({
            data: {
              reportId: report.id,
              moduleId: "CLAIM_CHECK",
              status: "FAILED",
              errorMessage: err.message || "Błąd kontroli historii szkód Audatex CHE.",
            },
          });
        } catch (e) {}
      }
    }

    // Update Report final status
    try {
      await prisma.report.update({
        where: { id: report.id },
        data: { status: "COMPLETED" },
      });
    } catch (e) {}

    // Record Audit Event
    try {
      await prisma.auditEvent.create({
        data: {
          userId: user.userId,
          userEmail: user.email,
          action: "CREATE_REPORT",
          resource: `REPORT:${report.id}`,
          metadataJson: JSON.stringify({
            vin,
            firstRegistrationDate,
            modulesRequested: { includeValuation, includeClaimCheck, includeClaimDetails },
          }),
        },
      });
    } catch (e) {}

    return NextResponse.json({
      success: true,
      reportId: report.id,
      vin,
      firstRegistrationDate,
      valuation: valuationResultData,
      claimCheck: claimCheckResultData,
      claimDetails: claimDetailsResultData,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Błąd serwera podczas generowania raportu." }, { status: 500 });
  }
}
