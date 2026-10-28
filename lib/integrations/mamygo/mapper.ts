import equipmentCatalog from "../../audatex/equipment-catalog-pl.json" with { type: "json" };
import { currentMonthWarsaw } from "../../api-clients/month.ts";
import { parseClassificationXml, type ParsedClassification } from "./parse.ts";
import type { ExternalEquipmentItem, ExternalVinIdentification } from "./types.ts";

/** Wejście mappera: podzbiór VehicleIdentificationRaw (surowe XML-e z Audatex, np. odczytane z cache). */
export interface MapperInput {
  classificationXml: string;
  fittedEquipmentCodes: string[];
}

const AUDATEX_EQUIPMENT_NAMES = equipmentCatalog as Record<string, string>;

/** Współczynnik kW -> KM używany, gdy Audatex nie podaje mocy w KM. */
const KW_TO_HP = 1.35962;

/**
 * Kod paliwa Audatex -> słownik DAT/Vincario. Hybrydy (BAEL, NMEL) są tymczasowo spłaszczone do
 * benzyny/diesla do czasu potwierdzenia z mamygo; zmiana tylko w tej mapie.
 */
const FUEL_TYPE_MAP: Record<string, string> = {
  BA: "Gasoline",
  NM: "Diesel",
  EL: "Electric",
  LPG: "Liquefied Petroleum Gas (propane or LPG)",
  CNG: "Compressed Natural Gas (CNG)",
  BAEL: "Gasoline",
  NMEL: "Diesel",
};

const BODY_MAP: Record<string, string> = {
  "kombi ter": "Sport Utility Vehicle (SUV)/Multi Purpose Vehicle (MPV)",
  suv: "Sport Utility Vehicle (SUV)/Multi Purpose Vehicle (MPV)",
  cuv: "Crossover Utility Vehicle (CUV)",
  hatchback: "Hatchback/Liftback/Notchback",
  liftback: "Hatchback/Liftback/Notchback",
  sedan: "Sedan/Saloon",
  kombi: "Wagon",
  kupe: "Coupe",
  coupe: "Coupe",
  kabriolet: "Cabriolet/Convertible",
  cabrio: "Cabriolet/Convertible",
  roadster: "Cabriolet/Convertible",
};

/** Znaki roku modelowego z pozycji 10 VIN: A=2010 ... Y=2030 (bez I, O, Q, U, Z), cyfry 1-9 = 2031-2039. */
const VIN_YEAR_LETTERS = "ABCDEFGHJKLMNPRSTVWXY";

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === "" || value.trim().toLowerCase() === "n/a";
}

/** Tekst bez zmian (poza trim); pusty i "n/a" -> null. */
function textOrNull(value: string | undefined): string | null {
  return isBlank(value) ? null : value!.trim();
}

/** Wartość liczbowa jako string z kropką dziesiętną; pusty i "n/a" -> null, a dla wymiarów/pojemności także "0". */
function scalar(value: string | undefined, zeroIsNull = false): string | null {
  if (isBlank(value)) return null;
  const normalized = value!.trim().replace(",", ".");
  if (zeroIsNull && Number(normalized) === 0) return null;
  return normalized;
}

function numberOrNull(value: string | undefined): number | null {
  if (isBlank(value)) return null;
  const num = parseFloat(value!.trim().replace(",", "."));
  return Number.isFinite(num) ? num : null;
}

function mapConstructionYear(vin: string, productionBeginYear: string | undefined, now: Date): string | null {
  const code = vin.charAt(9);
  let year: number | null = null;
  const letterIndex = VIN_YEAR_LETTERS.indexOf(code);
  if (letterIndex >= 0) year = 2010 + letterIndex;
  else if (/^[1-9]$/.test(code)) year = 2030 + Number(code);
  if (year === null) return null;

  const beginYear = numberOrNull(productionBeginYear);
  if (beginYear !== null && year < beginYear) return null;
  // Bieżący rok w czasie polskim (nie strefie serwera), żeby przełom roku nie zmieniał wyniku zależnie od TZ hosta.
  if (year > Number(currentMonthWarsaw(now).slice(0, 4)) + 1) return null;
  return String(year);
}

function mapBody(params: Record<string, string>): string | null {
  // carBodyKind ma pierwszeństwo; gdy jest pusty albo spoza słownika, próbujemy carBodyType.
  for (const source of [params.carBodyKind, params.carBodyType]) {
    if (isBlank(source)) continue;
    const mapped = BODY_MAP[source.trim().toLowerCase()];
    if (mapped) return mapped;
  }
  return null;
}

function mapDrive(params: Record<string, string>): string | null {
  const location = (params.powerAxleLocation ?? "").trim().toUpperCase();
  if ((params.axlePowered ?? "").trim().toLowerCase() === "4x4" || location === "P1Z1") return "All wheel drive";
  if (location === "P1") return "Front-wheel drive";
  if (location === "Z1") return "Rear-wheel drive";
  return null;
}

function mapTransmission(params: Record<string, string>): string | null {
  const gearBoxType = (params.gearBoxType ?? "").toLowerCase();
  if (["dsg", "s tronic", "pdk", "dct", "edc"].some((token) => gearBoxType.includes(token))) {
    return "Dual-clutch Transmission (DCT)";
  }
  if (["cvt", "multitronic", "xtronic"].some((token) => gearBoxType.includes(token))) {
    return "Continuously Variable Transmission (CVT)";
  }
  const gearBox = (params.gearBox ?? "").trim().toUpperCase();
  if (gearBox === "A") return "Automatic";
  if (gearBox === "M") return "Manual/Standard";
  return null;
}

function mapProductType(params: Record<string, string>): string | null {
  const category = (params.VehicleCategory ?? "").trim().toUpperCase();
  if ((params.kindCode ?? "").trim().toUpperCase() === "OA" || category.startsWith("M1")) return "Car";
  if (category.startsWith("N")) return "Truck";
  if (category.startsWith("L")) return "Motorcycle";
  return null;
}

function mapBatteryCapacity(fuelCode: string, params: Record<string, string>): string | null {
  if (fuelCode === "EL") return scalar(params.petrolCapacityMain, true);
  if (fuelCode === "BAEL" || fuelCode === "NMEL") return scalar(params.petrlCapacitySecondary, true); // literówka Audatex
  return null;
}

/** Seria Audatex 1:1; pusty kod pomijamy, duplikaty po kodzie usuwamy, pusta nazwa -> katalog -> kod. */
function mapBasicFeatures(classification: ParsedClassification): ExternalEquipmentItem[] {
  const seen = new Set<string>();
  const items: ExternalEquipmentItem[] = [];
  for (const item of classification.standard) {
    const code = item.code.trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    items.push({ label: item.name || AUDATEX_EQUIPMENT_NAMES[code] || code, id: code });
  }
  return items;
}

function mapAdditionalFeatures(
  classification: ParsedClassification,
  fittedEquipmentCodes: string[],
): ExternalEquipmentItem[] {
  const basicCodes = new Set(classification.standard.map((item) => item.code));
  // Nazwa z listy Optional klasyfikacji to tylko słownik nazw; do wyposażenia auta trafiają wyłącznie kody z VIN.
  const optionalNames = new Map(classification.optional.map((item) => [item.code, item.name]));
  const seen = new Set<string>();
  const items: ExternalEquipmentItem[] = [];

  for (const rawCode of fittedEquipmentCodes) {
    const code = rawCode.trim();
    if (!code || basicCodes.has(code) || seen.has(code)) continue;
    seen.add(code);
    const label = optionalNames.get(code) || AUDATEX_EQUIPMENT_NAMES[code] || code;
    items.push({ label, id: code });
  }
  return items;
}

/** Surowa odpowiedź Audatex -> kontrakt ExternalVinIdentification. Czysta funkcja, bez I/O. */
export function toExternalVinIdentification(
  vin: string,
  raw: MapperInput,
  now: Date = new Date(),
): ExternalVinIdentification {
  const classification = parseClassificationXml(raw.classificationXml);
  const p = classification.params;
  const fuelCode = (p.engineFuelType ?? "").trim().toUpperCase();

  const powerKw = numberOrNull(p.engineKW);
  const powerHpFromAudatex = numberOrNull(p.engineHP);
  const powerHp = powerHpFromAudatex ?? (powerKw !== null ? powerKw * KW_TO_HP : null);

  return {
    vin,
    make: textOrNull(p.manufacturerName),
    model: textOrNull(p.modelName),
    manufacturerName: textOrNull(p.manufacturerName),
    constructionTime: null,
    constructionYear: mapConstructionYear(vin, p.productionBeginYear, now),
    body: mapBody(p),
    subModelName: textOrNull(p.typeName),
    doorsCount: scalar(p.carDoorNr),
    cubicCapacity: scalar(p.engineCapacity, true),
    powerKw: powerKw !== null ? String(Math.round(powerKw)) : null,
    powerHp: powerHp !== null ? String(Math.round(powerHp)) : null,
    drive: mapDrive(p),
    transmission: mapTransmission(p),
    gearsCount: scalar(p.gearNumber),
    fuelType: FUEL_TYPE_MAP[fuelCode] ?? null,
    tankVolume: fuelCode === "EL" ? null : scalar(p.petrolCapacityMain, true),
    originalTireSizeAxle1: isBlank(p.tireFront) ? null : p.tireFront.replace(/\s+/g, ""),
    batteryCapacityKWh: mapBatteryCapacity(fuelCode, p),
    minimumTrunkCapacityL: scalar(p.storageSpace, true),
    productType: mapProductType(p),
    maxLoadKg: scalar(p.weightUsable, true),
    speedMax: scalar(p.speedMax),
    consumptionInTown: scalar(p.petrolConsumptionEHKcity),
    consumptionOutOfTown: scalar(p.petrolConsumptionEHKoutside),
    co2Emission: scalar(p.emissionLevel1),
    length: scalar(p.length, true),
    width: scalar(p.width, true),
    height: scalar(p.height, true),
    axlesCount: scalar(p.axleNr),
    wheelBase: scalar(p.wheelBase, true),
    airbagsCount: null,
    seatsCount: scalar(p.sittingPlaceNr),
    carFeaturesBasicWithId: mapBasicFeatures(classification),
    carFeaturesAdditionalWithId: mapAdditionalFeatures(classification, raw.fittedEquipmentCodes),
  };
}
