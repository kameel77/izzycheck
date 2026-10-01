export type DamageCategory = "BODY" | "GLASS_LIGHTING" | "MECHANICAL" | "UNDERBODY" | "OTHER";

export interface CategoryInfo {
  id: DamageCategory;
  labelPl: string;
  colorHex: string;
  markerShape: "triangle" | "rhombus" | "gear" | "chassis" | "circle";
  priority: number;
}

export const CATEGORY_DEFINITIONS: Record<DamageCategory, CategoryInfo> = {
  UNDERBODY: {
    id: "UNDERBODY",
    labelPl: "Podwozie",
    colorHex: "#8B5CF6", // purple
    markerShape: "chassis",
    priority: 1,
  },
  GLASS_LIGHTING: {
    id: "GLASS_LIGHTING",
    labelPl: "Szyby i oświetlenie",
    colorHex: "#3B82F6", // blue
    markerShape: "rhombus",
    priority: 2,
  },
  MECHANICAL: {
    id: "MECHANICAL",
    labelPl: "Mechaniczne",
    colorHex: "#F97316", // orange
    markerShape: "gear",
    priority: 3,
  },
  BODY: {
    id: "BODY",
    labelPl: "Nadwozie i konstrukcja",
    colorHex: "#EF4444", // red
    markerShape: "triangle",
    priority: 4,
  },
  OTHER: {
    id: "OTHER",
    labelPl: "Inne / nieokreślone",
    colorHex: "#6B7280", // gray
    markerShape: "circle",
    priority: 5,
  },
};

export const CATEGORY_PRIORITY_ORDER: DamageCategory[] = [
  "UNDERBODY",
  "GLASS_LIGHTING",
  "MECHANICAL",
  "BODY",
  "OTHER",
];

export function getPrimaryCategory(categories: DamageCategory[]): DamageCategory {
  if (!categories || categories.length === 0) return "OTHER";
  for (const cat of CATEGORY_PRIORITY_ORDER) {
    if (categories.includes(cat)) return cat;
  }
  return "OTHER";
}

/**
 * LEGACY zone labels (axis-order words, e.g. "Przód lewy góra"). Reports stored before the natural-language
 * descriptions persisted these strings in `damageZones`, so they are only used to map them back to codes
 * in buildFallbackDamageAssessment. User-facing text comes from AUDATEX_ZONES.
 */
export const AUDATEX_ZONE_LABELS: Record<string, string> = {
  "01": "Przód lewy góra",
  "02": "Przód lewy środek",
  "03": "Przód lewy dół",
  "04": "Przód prawy góra",
  "05": "Przód prawy środek",
  "06": "Przód prawy dół",
  "07": "Przód środek góra",
  "08": "Przód środek środek",
  "09": "Przód środek dół",
  "10": "Środek lewy góra",
  "11": "Środek lewy środek",
  "12": "Środek lewy dół",
  "13": "Środek prawy góra",
  "14": "Środek prawy środek",
  "15": "Środek prawy dół",
  "16": "Dach / środek góra",
  "17": "Kabinowe wnętrze",
  "18": "Podwozie środek",
  "19": "Tył lewy góra",
  "20": "Tył lewy środek",
  "21": "Tył lewy dół",
  "22": "Tył prawy góra",
  "23": "Tył prawy środek",
  "24": "Tył prawy dół",
  "25": "Tył środek góra",
  "26": "Tył środek środek",
  "27": "Tył środek dół",
};

export interface ZoneDescription {
  /** Natural Polish axis description, e.g. "Tył, prawa strona, góra". */
  titlePl: string;
  /** Rough physical location of the zone; shown as a caption "okolice: ... (orientacyjnie)". */
  hintPl?: string;
}

/**
 * Audatex CHE zone codes 00-27: a 3x3x3 grid (X front/middle/rear, Y left/middle/right, Z top/middle/bottom).
 * Single source of truth for zone descriptions in the PDF and the web report. Y=middle is "oś pojazdu".
 */
export const AUDATEX_ZONES: Record<string, ZoneDescription> = {
  "00": { titlePl: "Strefa nieokreślona" },
  "01": { titlePl: "Przód, lewa strona, góra", hintPl: "lewy słupek A" },
  "02": { titlePl: "Przód, lewa strona, środek", hintPl: "lewy reflektor, lewy błotnik przedni" },
  "03": { titlePl: "Przód, lewa strona, dół", hintPl: "lewa część zderzaka przedniego" },
  "04": { titlePl: "Przód, prawa strona, góra", hintPl: "prawy słupek A" },
  "05": { titlePl: "Przód, prawa strona, środek", hintPl: "prawy reflektor, prawy błotnik przedni" },
  "06": { titlePl: "Przód, prawa strona, dół", hintPl: "prawa część zderzaka przedniego" },
  "07": { titlePl: "Przód, oś pojazdu, góra", hintPl: "szyba przednia" },
  "08": { titlePl: "Przód, oś pojazdu, środek", hintPl: "atrapa chłodnicy, maska" },
  "09": { titlePl: "Przód, oś pojazdu, dół", hintPl: "dolna część zderzaka przedniego" },
  "10": { titlePl: "Środek, lewa strona, góra", hintPl: "lewa linia dachu, lewe szyby boczne" },
  "11": { titlePl: "Środek, lewa strona, środek", hintPl: "lewe drzwi" },
  "12": { titlePl: "Środek, lewa strona, dół", hintPl: "lewy próg" },
  "13": { titlePl: "Środek, prawa strona, góra", hintPl: "prawa linia dachu, prawe szyby boczne" },
  "14": { titlePl: "Środek, prawa strona, środek", hintPl: "prawe drzwi" },
  "15": { titlePl: "Środek, prawa strona, dół", hintPl: "prawy próg" },
  "16": { titlePl: "Środek, oś pojazdu, góra", hintPl: "dach" },
  "17": { titlePl: "Środek, oś pojazdu, środek", hintPl: "wnętrze kabiny" },
  "18": { titlePl: "Środek, oś pojazdu, dół", hintPl: "podwozie" },
  "19": { titlePl: "Tył, lewa strona, góra", hintPl: "lewy słupek C" },
  "20": { titlePl: "Tył, lewa strona, środek", hintPl: "lewy błotnik tylny, lewa lampa" },
  "21": { titlePl: "Tył, lewa strona, dół", hintPl: "lewa część zderzaka tylnego" },
  "22": { titlePl: "Tył, prawa strona, góra", hintPl: "prawy słupek C" },
  "23": { titlePl: "Tył, prawa strona, środek", hintPl: "prawy błotnik tylny, prawa lampa" },
  "24": { titlePl: "Tył, prawa strona, dół", hintPl: "prawa część zderzaka tylnego" },
  "25": { titlePl: "Tył, oś pojazdu, góra", hintPl: "szyba tylna" },
  "26": { titlePl: "Tył, oś pojazdu, środek", hintPl: "klapa bagażnika" },
  "27": { titlePl: "Tył, oś pojazdu, dół", hintPl: "dolna część zderzaka tylnego" },
};

/** Caption shown under the zone description, e.g. "okolice: prawy słupek C (orientacyjnie)". */
export function zoneHintCaption(code: string): string | undefined {
  const hint = AUDATEX_ZONES[code]?.hintPl;
  return hint ? `okolice: ${hint} (orientacyjnie)` : undefined;
}

/**
 * Zone codes are 2 digits ("05"), but a lone code in the XML is parsed as a number and stored unpadded ("5").
 */
export function normalizeZoneCode(code: string): string {
  const trimmed = String(code).trim();
  return /^\d{1,2}$/.test(trimmed) ? trimmed.padStart(2, "0") : trimmed;
}

/** Audatex part-group codes are 3 digits ("004"); some responses return them unpadded ("4"). */
export function normalizePartGroupCode(code: string): string {
  const trimmed = String(code).trim();
  return /^\d{1,3}$/.test(trimmed) ? trimmed.padStart(3, "0") : trimmed;
}

export const AUDATEX_PART_GROUPS: Record<
  string,
  {
    labelPl: string;
    categories: DamageCategory[];
    subType?: "glass" | "lighting";
    /** Labels persisted in reports stored before the names were aligned with the Audatex spec (fallback matching only). */
    legacyLabelsPl?: string[];
  }
> = {
  "001": {
    labelPl: "Systemy bezpieczeństwa biernego",
    categories: ["MECHANICAL"],
    legacyLabelsPl: ["Systemy bezpieczeństwa biernego (Airbag / Pasy)"],
  },
  "002": {
    labelPl: "Systemy bezpieczeństwa czynnego",
    categories: ["MECHANICAL"],
    legacyLabelsPl: ["Systemy bezpieczeństwa czynnego (ABS / ESP)"],
  },
  "003": { labelPl: "Zawieszenie", categories: ["MECHANICAL"], legacyLabelsPl: ["Układ zawieszenia i jezdny"] },
  "004": { labelPl: "Elementy poszycia zewnętrznego nadwozia", categories: ["BODY"] },
  "005": {
    labelPl: "Elementy konstrukcyjne nadwozia",
    categories: ["BODY"],
    legacyLabelsPl: ["Konstrukcja nośna nadwozia / rama"],
  },
  "006": { labelPl: "Oświetlenie zewnętrzne", categories: ["GLASS_LIGHTING"], subType: "lighting" },
  "007": { labelPl: "Oszklenie", categories: ["GLASS_LIGHTING"], subType: "glass", legacyLabelsPl: ["Oszklenie nadwozia"] },
  "008": { labelPl: "Układ hamulcowy", categories: ["MECHANICAL"] },
  "009": { labelPl: "Układ chłodzenia i klimatyzacji", categories: ["MECHANICAL"] },
  "011": { labelPl: "Tapicerka", categories: ["BODY"], legacyLabelsPl: ["Tapicerka i wykończenie wnętrza"] },
  "012": { labelPl: "Osprzęt silnika", categories: ["MECHANICAL"] },
  "013": {
    labelPl: "Skrzynia biegów i układ napędowy",
    categories: ["MECHANICAL"],
    legacyLabelsPl: ["Skrzynia biegów i układ przeniesienia napędu"],
  },
  "014": { labelPl: "Układ kierowniczy", categories: ["MECHANICAL"] },
  "015": {
    labelPl: "Instalacja elektryczna (pojazdy elektryczne i hybrydowe)",
    categories: ["MECHANICAL"],
    legacyLabelsPl: ["Układ elektryczny / wysokie napięcie (EV / Hybrid)"],
  },
};

export function classifyZoneCode(code: string): DamageCategory[] {
  if (code === "00") return ["OTHER"];
  if (code === "18") return ["UNDERBODY"];
  return ["BODY"];
}

export function classifyGeneralFlag(flagName: string): DamageCategory[] {
  if (flagName === "underbody") return ["UNDERBODY"];
  if (flagName === "mechanical") return ["MECHANICAL"];
  return ["BODY"];
}

export function classifyGlassFlag(flagName: string): DamageCategory[] {
  return ["GLASS_LIGHTING"];
}
