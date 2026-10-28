import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { AudatexValuationAdapter } from "@/lib/audatex/valuation";
import { AudatexHistoryAdapter } from "@/lib/audatex/history";
import { prisma } from "@/lib/db";
import { isRateLimited } from "@/lib/rate-limit";
import { computeRequestHash } from "@/lib/audatex/hash";
import { Prisma } from "@prisma/client";
import { generateMonotonicReference } from "@/lib/reports/reference";
import { finalizeReport } from "@/lib/reports/finalize";
import { getBalances, isPrepaid, releaseStaleHolds } from "@/lib/billing/credits";
import { STALE_LOCK_MS } from "@/lib/reports/module-executor";
import { checkCreditsForNewReport } from "@/lib/billing/report-guard";

const valuationAdapter = new AudatexValuationAdapter();
const historyAdapter = new AudatexHistoryAdapter();

function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const isProvided = (value: unknown) => value !== undefined && value !== null && value !== "";

export async function POST(req: Request) {
  try {
    const sessionUser = await getCurrentUser();
    if (!sessionUser) {
      return NextResponse.json({ error: "Brak autoryzacji. Zaloguj się ponownie." }, { status: 401 });
    }

    // Rate Limit: max 10 report creations per minute per user
    const rateCheck = isRateLimited("reports_create", sessionUser.userId, 10, 60000);
    if (rateCheck.limited) {
      return NextResponse.json(
        { error: `Zbyt wiele zapytań o raporty. Odczekaj ${Math.ceil(rateCheck.resetMs / 1000)} sekund przed kolejnym zapytaniem.` },
        { status: 429 }
      );
    }

    // Fetch fresh user from database to ensure up-to-date permissions & active status
    const freshUser = await prisma.user.findUnique({
      where: { id: sessionUser.userId },
      include: { organization: true },
    });

    if (!freshUser || !freshUser.isActive) {
      return NextResponse.json({ error: "Konto użytkownika jest nieaktywne lub nie istnieje." }, { status: 401 });
    }

    if (freshUser.role !== "ADMIN" && freshUser.organization && !freshUser.organization.isActive) {
      return NextResponse.json({ error: "Organizacja została zablokowana." }, { status: 403 });
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
    if (!isValidIsoDate(firstRegistrationDate)) {
      return NextResponse.json(
        { error: "Data pierwszej rejestracji jest wymagana w formacie YYYY-MM-DD." },
        { status: 400 }
      );
    }

    if (isProvided(valuationDate) && !isValidIsoDate(valuationDate)) {
      return NextResponse.json({ error: "Data wyceny musi być w formacie YYYY-MM-DD." }, { status: 400 });
    }

    if (isProvided(manufactureDate) && !isValidIsoDate(manufactureDate)) {
      return NextResponse.json({ error: "Data produkcji musi być w formacie YYYY-MM-DD." }, { status: 400 });
    }

    // 3. Modules selection and permissions check
    let { includeValuation, includeClaimCheck, includeClaimDetails } = modules || {};

    // Business Rule: valuation automatically triggers CLAIM_CHECK (presence of claims check)
    if (includeValuation) {
      includeClaimCheck = true;
    }

    if (!includeValuation && !includeClaimCheck && !includeClaimDetails) {
      return NextResponse.json(
        { error: "Musisz wybrać co najmniej jeden moduł raportu (wycena, kontrola szkód lub szczegóły szkód)." },
        { status: 400 }
      );
    }

    // Strict Permissions Enforcement for USER / OPERATOR roles:
    if (freshUser.role === "USER" || freshUser.role === "OPERATOR") {
      if (includeValuation && !freshUser.canGenerateValuation) {
        return NextResponse.json({ error: "Brak uprawnień do generowania wyceny pojazdu." }, { status: 403 });
      }
      if (includeClaimDetails && !freshUser.canGenerateClaimDetails) {
        return NextResponse.json({ error: "Brak uprawnień do generowania szczegółów szkód." }, { status: 403 });
      }
      // Claim details need CLAIM_CHECK to run first, so without valuation the user must be allowed to run it.
      if ((includeClaimCheck || includeClaimDetails) && !includeValuation && !freshUser.canGenerateClaimCheck) {
        return NextResponse.json({ error: "Brak uprawnień do weryfikacji historii szkód." }, { status: 403 });
      }
    }

    const mileageNum = mileage ? parseInt(String(mileage), 10) : undefined;
    const todayStr = new Date().toISOString().split("T")[0];
    const valDate = valuationDate || todayStr;

    const idempotencyHeader = req.headers.get("idempotency-key") || req.headers.get("x-idempotency-key");
    if (idempotencyHeader && idempotencyHeader.length > 128) {
      return NextResponse.json({ error: "Nieprawidłowy klucz idempotencji." }, { status: 400 });
    }
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
          createdById: freshUser.id,
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
          createdById: freshUser.id,
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

    // 4b. Credit gate: a PREPAID organization needs credits for every requested paid module
    if (freshUser.organization) {
      const prepaid = isPrepaid(freshUser.organization);
      // A stale hold would otherwise show a false 402; give its credit back before reading the balance.
      if (prepaid) {
        await releaseStaleHolds(prisma, freshUser.organization.id, new Date(Date.now() - STALE_LOCK_MS));
      }
      const creditCheck = checkCreditsForNewReport({
        prepaid,
        balances: prepaid ? await getBalances(prisma, freshUser.organization.id) : null,
        includeValuation: Boolean(includeValuation),
        includeClaimDetails: Boolean(includeClaimDetails),
      });
      if (!creditCheck.ok) {
        return NextResponse.json(
          { error: creditCheck.message, code: "NO_CREDITS", creditType: creditCheck.creditType },
          { status: 402 }
        );
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
          createdById: freshUser.id,
          organizationId: freshUser.organizationId || null,
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
            createdById: freshUser.id,
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

    // 6. Create initial Module records in Database (PENDING for requested, NOT_REQUESTED for others)
    const initialModules = [
      {
        reportId: report.id,
        moduleId: "VALUATION" as const,
        status: includeValuation ? ("PENDING" as const) : ("NOT_REQUESTED" as const),
      },
      {
        reportId: report.id,
        moduleId: "CLAIM_CHECK" as const,
        status: (includeClaimCheck || includeClaimDetails) ? ("PENDING" as const) : ("NOT_REQUESTED" as const),
      },
      {
        reportId: report.id,
        moduleId: "CLAIM_DETAILS" as const,
        status: includeClaimDetails ? ("PENDING" as const) : ("NOT_REQUESTED" as const),
      },
    ];

    for (const mod of initialModules) {
      await prisma.reportModuleResult.create({
        data: mod,
      });
    }

    // 7. Record Audit Event: INITIALIZE_REPORT
    await prisma.auditEvent.create({
      data: {
        userId: freshUser.id,
        userEmail: freshUser.email,
        action: "INITIALIZE_REPORT",
        resource: `Report:${report.id}`,
        metadataJson: JSON.stringify({
          vin: report.vin,
          publicReference: report.publicReference,
          requestedModules: {
            includeValuation: Boolean(includeValuation),
            includeClaimCheck: Boolean(includeClaimCheck),
            includeClaimDetails: Boolean(includeClaimDetails),
          },
        }),
      },
    });

    return NextResponse.json(
      {
        success: true,
        reportId: report.id,
        publicReference: report.publicReference,
        vin: report.vin,
        status: "PROCESSING",
        modules: initialModules.map((m) => ({
          moduleId: m.moduleId,
          status: m.status,
        })),
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("[REPORTS_POST_ERROR]", error);
    return NextResponse.json(
      { error: error.message || "Wystąpił wewnętrzny błąd serwera podczas tworzenia raportu." },
      { status: 500 }
    );
  }
}
