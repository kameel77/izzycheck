import {
  buildDamagePresentation,
  DamagePresentationModel,
} from "../damage/build-damage-presentation.ts";
import {
  buildFallbackDamageAssessment,
} from "../damage/normalize-damage-assessment.ts";

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
}

export interface ReportPdfViewModel {
  reportId: string;
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
  standardEquipment: { name: string; code: string }[];
  optionalEquipment: { name: string; code: string }[];

  // Claims
  hasClaims: boolean;
  claims: ReportPdfClaimItem[];

  // Module statuses
  valuationStatus?: string;
  claimCheckStatus?: string;
  claimDetailsStatus?: string;
}

export function buildReportPdfViewModel(report: any): ReportPdfViewModel {
  const snapshot = report.vehicleSnapshot;
  const rawClaims = report.damageClaims || [];

  const stdEquipment = snapshot?.standardEquipment ? JSON.parse(snapshot.standardEquipment) : [];
  const optEquipment = snapshot?.optionalEquipment ? JSON.parse(snapshot.optionalEquipment) : [];

  const valModule = report.moduleResults?.find((m: any) => m.moduleId === "VALUATION");
  const checkModule = report.moduleResults?.find((m: any) => m.moduleId === "CLAIM_CHECK");
  const detailsModule = report.moduleResults?.find((m: any) => m.moduleId === "CLAIM_DETAILS");

  const claims: ReportPdfClaimItem[] = rawClaims.map((c: any, idx: number) => {
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
      "ALL"
    );

    return {
      index: idx + 1,
      claimId: c.claimId,
      accidentDate: c.accidentDate,
      claimDate: c.claimDate,
      country: c.country,
      makeModel: c.makeModel,
      mileage: c.mileage,
      damageValue: c.damageValue,
      currency: c.currency || "PLN",
      isTotalLoss: Boolean(c.isTotalLoss),
      mandateCode: c.mandateCode,
      mandateDescription: c.mandateDescription,
      presentation,
    };
  });

  return {
    reportId: report.id,
    vin: report.vin,
    firstRegistrationDate: report.firstRegistrationDate,
    mileage: report.mileage,
    valuationDate: report.valuationDate,
    status: report.status,
    createdAtFormatted: new Date(report.createdAt).toLocaleString("pl-PL"),
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
    standardEquipment: stdEquipment,
    optionalEquipment: optEquipment,

    hasClaims: claims.length > 0,
    claims,

    valuationStatus: valModule?.status || "NIEWYKONANO",
    claimCheckStatus: checkModule?.status || "NIEWYKONANO",
    claimDetailsStatus: detailsModule?.status || "NIEWYKONANO",
  };
}
