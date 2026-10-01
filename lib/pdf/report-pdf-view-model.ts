import {
  buildDamagePresentation,
  DamagePresentationModel,
} from "../damage/build-damage-presentation.ts";
import {
  buildFallbackDamageAssessment,
} from "../damage/normalize-damage-assessment.ts";
import { VehicleTechnicalSpec } from "../audatex/types.ts";
import {
  ClaimsHistoryPresentation,
  getClaimsHistoryPresentation,
} from "../report-claims-summary.ts";
import { DedupSummary, formatDateTimeWarsaw } from "./pdf-format.ts";
import { dedupeRawClaims } from "../reports/claim-dedup.ts";

/** Earlier assessment of the same accident (merged into a claim item). */
export interface ReportPdfEarlierAssessment {
  claimId: string;
  claimDate?: string;
  accidentDate?: string;
  damageValue?: number;
  currency: string;
  isTotalLoss: boolean;
}

export interface ReportPdfClaimItem {
  index: number;
  claimId: string;
  accidentDate?: string;
  claimDate?: string;
  country?: string;
  makeModel?: string;
  mileage?: number;
  damageValue?: number;
  currency: string;
  isTotalLoss: boolean;
  mandateCode?: string;
  mandateDescription?: string;
  presentation: DamagePresentationModel;
  /** MERGED: several assessments of one accident; this item is the newest one. */
  dedupKind: "SINGLE" | "MERGED";
  earlierAssessments: ReportPdfEarlierAssessment[];
  /** 1-based claim numbers of the other items that probably describe the same accident. */
  probableWith: number[];
}

export interface ReportPdfViewModel {
  reportId: string;
  publicReference?: string;
  vin: string;
  firstRegistrationDate: string;
  mileage?: number;
  valuationDate: string;
  status: string;
  createdAtFormatted: string;
  operatorName: string;
  operatorEmail: string;

  // Vehicle info
  make?: string;
  model?: string;
  variant?: string;
  ibsCode?: string;
  manufactureDate?: string;
  newPriceCv?: number;
  marketPriceCob?: number;
  technicalValueTh?: number;
  technicalSpec?: VehicleTechnicalSpec;
  standardEquipment: { name: string; code: string }[];
  optionalEquipment: { name: string; code: string }[];

  // Claims
  hasClaims: boolean;
  /** One item per de-duplicated claim (assessments of the same accident are merged). */
  claims: ReportPdfClaimItem[];
  dedup: DedupSummary;

  // Module statuses
  valuationStatus?: string;
  claimCheckStatus?: string;
  claimDetailsStatus?: string;
  claimsHistoryPresentation: ClaimsHistoryPresentation;
}

export function buildReportPdfViewModel(report: any): ReportPdfViewModel {
  const snapshot = report.vehicleSnapshot;
  const rawClaims = report.damageClaims || [];

  const stdEquipment = snapshot?.standardEquipment ? JSON.parse(snapshot.standardEquipment) : [];
  const optEquipment = snapshot?.optionalEquipment ? JSON.parse(snapshot.optionalEquipment) : [];

  const valModule = report.moduleResults?.find((m: any) => m.moduleId === "VALUATION");
  const checkModule = report.moduleResults?.find((m: any) => m.moduleId === "CLAIM_CHECK");
  const detailsModule = report.moduleResults?.find((m: any) => m.moduleId === "CLAIM_DETAILS");

  const techSpec = snapshot?.technicalSpecJson ? JSON.parse(snapshot.technicalSpecJson) : undefined;

  const dedup = dedupeRawClaims<any>(rawClaims);

  const claims: ReportPdfClaimItem[] = dedup.items.map((item, idx: number) => {
    const c: any = item.primary;
    let assessment = c.damageAssessmentJson
      ? JSON.parse(c.damageAssessmentJson)
      : undefined;

    // Robust fallback for legacy historical reports without damageAssessmentJson
    if (!assessment) {
      const rawZones: string[] = c.damageZones ? JSON.parse(c.damageZones) : [];
      const rawParts: string[] = c.significantParts ? JSON.parse(c.significantParts) : [];
      assessment = buildFallbackDamageAssessment(rawZones, rawParts);
    }

    const vehicleMakeModel = snapshot?.make ? `${snapshot.make} ${snapshot.model || ""}`.trim() : "";
    const presentation = buildDamagePresentation(
      c.claimId,
      assessment,
      c.makeModel || vehicleMakeModel,
      "ALL",
      techSpec?.bodyType
    );

    return {
      index: idx + 1,
      claimId: c.claimId,
      accidentDate: item.accidentDate,
      claimDate: c.claimDate,
      country: c.country,
      makeModel: c.makeModel,
      mileage: c.mileage,
      damageValue: c.damageValue,
      currency: c.currency || "PLN",
      // merged assessments: a total loss in ANY of them is shown (a newer partial estimate must not hide it)
      isTotalLoss: item.isTotalLoss,
      mandateCode: c.mandateCode,
      mandateDescription: c.mandateDescription,
      presentation,
      dedupKind: item.dedupKind,
      earlierAssessments: item.earlierAssessments.map((e: any) => ({
        claimId: e.claimId,
        claimDate: e.claimDate ?? undefined,
        accidentDate: e.accidentDate ?? undefined,
        damageValue: e.damageValue ?? undefined,
        currency: e.currency || "PLN",
        isTotalLoss: Boolean(e.isTotalLoss),
      })),
      probableWith: item.probableWith,
    };
  });

  return {
    reportId: report.id,
    publicReference: report.publicReference || undefined,
    vin: report.vin,
    firstRegistrationDate: report.firstRegistrationDate,
    mileage: report.mileage,
    valuationDate: report.valuationDate,
    status: report.status,
    createdAtFormatted: formatDateTimeWarsaw(report.createdAt),
    operatorName: report.createdBy?.name || "Operator",
    operatorEmail: report.createdBy?.email || "",

    make: snapshot?.make,
    model: snapshot?.model,
    variant: snapshot?.variant,
    ibsCode: snapshot?.ibsCode,
    manufactureDate: snapshot?.manufactureDate,
    newPriceCv: snapshot?.newPriceCv,
    marketPriceCob: snapshot?.marketPriceCob,
    technicalValueTh: snapshot?.technicalValueTh,
    technicalSpec: techSpec,
    standardEquipment: stdEquipment,
    optionalEquipment: optEquipment,

    hasClaims: claims.length > 0,
    claims,
    dedup: {
      entriesCount: dedup.entriesCount,
      likelyEventsCount: dedup.likelyEventsCount,
      likelyTotal:
        dedup.likelyTotalCurrency !== undefined
          ? { total: dedup.likelyTotalValue, currency: dedup.likelyTotalCurrency }
          : undefined,
      hasMerged: dedup.items.some((i) => i.dedupKind === "MERGED"),
    },

    valuationStatus: valModule?.status || "NIEWYKONANO",
    claimCheckStatus: checkModule?.status || "NIEWYKONANO",
    claimDetailsStatus: detailsModule?.status || "NIEWYKONANO",
    claimsHistoryPresentation: getClaimsHistoryPresentation({
      claimCount: claims.length,
      claimCheckStatus: checkModule?.status,
      claimDetailsStatus: detailsModule?.status,
    }),
  };
}
