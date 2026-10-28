import { XMLParser } from "fast-xml-parser";

export interface ParsedEquipment {
  code: string;
  name: string;
}

export interface ParsedClassification {
  /** Wszystkie parametry `Description` -> `Value` (bez filtrowania; przy powtórzeniu wygrywa pierwszy). */
  params: Record<string, string>;
  standard: ParsedEquipment[];
  optional: ParsedEquipment[];
}

export interface ParsedVinResult {
  ibsCode: string;
  fittedEquipmentCodes: string[];
}

// parseTagValue: false, żeby "06", "1.20" czy "0.015" zostały dokładnie takim tekstem, jaki wysłał Audatex.
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
  parseTagValue: false,
  isArray: (name) => name === "Parameter" || name === "Equipment" || name === "string",
});

const text = (value: unknown): string => (value === undefined || value === null ? "" : String(value).trim());

/** Odpowiedź GetClassificationByIBSCode -> parametry i wyposażenie (Standard / Optional). */
export function parseClassificationXml(xml: string): ParsedClassification {
  const parsed = xmlParser.parse(xml);
  const carInfo =
    parsed["soap:Envelope"]?.["soap:Body"]?.["GetClassificationByIBSCodeResponse"]?.["GetClassificationByIBSCodeResult"]?.[
      "ResultedTypes"
    ]?.["CarInfo"];

  const params: Record<string, string> = {};
  for (const p of (carInfo?.["Parameteres"]?.["Parameter"] as Record<string, unknown>[] | undefined) ?? []) {
    const description = text(p["Description"]);
    if (description && !(description in params)) params[description] = text(p["Value"]);
  }

  const standard: ParsedEquipment[] = [];
  const optional: ParsedEquipment[] = [];
  for (const eq of (carInfo?.["Equipments"]?.["Equipment"] as Record<string, unknown>[] | undefined) ?? []) {
    const item = { code: text(eq["Code"]), name: text(eq["Name"]) };
    if (!item.code) continue;
    if (text(eq["EquipmentType"]) === "Standard") standard.push(item);
    else optional.push(item);
  }

  return { params, standard, optional };
}

/** Odpowiedź GetCarByVinWs -> IbsCode i kody wyposażenia dodatkowego; null, gdy brak IbsCode. */
export function parseVinXml(xml: string): ParsedVinResult | null {
  const parsed = xmlParser.parse(xml);
  const result = parsed["soap:Envelope"]?.["soap:Body"]?.["GetCarByVinWsResponse"]?.["GetCarByVinWsResult"];
  const ibsCode = text(result?.["IbsCode"]);
  if (!ibsCode) return null;

  const codes = ((result["AdditionalEquipmentsCodes"]?.["string"] as unknown[] | undefined) ?? [])
    .map(text)
    .filter(Boolean);
  return { ibsCode, fittedEquipmentCodes: codes };
}
