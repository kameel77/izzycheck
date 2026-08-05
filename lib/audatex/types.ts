export interface VinValuationInput {
  vin: string;
  dateOfFirstReg: string; // YYYY-MM-DD
  mileage?: number;
  valuationDate?: string; // YYYY-MM-DD
  manufactureDate?: string; // YYYY-MM-DD (Dedykowane potwierdzone źródło daty produkcji)
  marketCode?: string;
  language?: string;
}

export interface EquipmentItem {
  code: string;
  name: string;
  type: "Standard" | "Optional";
  price?: number;
}

export interface ValuationResult {
  ibsCode: string;
  make: string;
  model: string;
  variant: string;
  newPriceCv: number;
  marketPriceCob: number;
  technicalValueTh: number;
  mileageUsed: number;
  isAverageMileageUsed: boolean;
  manufactureDate?: string;
  standardEquipment: EquipmentItem[];
  optionalEquipment: EquipmentItem[];
  rawXml?: string;
}

export interface ClaimCheckInput {
  vin: string;
  country?: string;
  currency?: string;
  firstRegistration?: string;
}

export interface ClaimCheckResult {
  hasHistory: boolean;
  isShortVin: boolean;
  isFullVin: boolean;
  isMileageAvailable: boolean;
  photosStatus: "POSSIBLY_AVAILABLE" | "NO_PHOTOS" | "NOT_ALLOWED" | "ERROR";
  photosIdentifier?: string;
  advice?: string;
  rawXml?: string;
}

export interface DamageClaimDetail {
  claimId: string;
  accidentDate?: string;
  creationDate?: string;
  country?: string;
  makeModel?: string;
  mileage?: number;
  damageValue?: number;
  currency?: string;
  isTotalLoss: boolean;
  mandateCode?: string;
  mandateDescription?: string;
  affectedZones: string[]; // List of 28 body zones & glass zones
  significantParts: string[]; // List of part group names (e.g. Passive safety, Braking system)
}

export interface ClaimDetailsResult {
  claims: DamageClaimDetail[];
  rawXml?: string;
}
