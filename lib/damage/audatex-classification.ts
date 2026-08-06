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

export const AUDATEX_PART_GROUPS: Record<string, { labelPl: string; categories: DamageCategory[]; subType?: "glass" | "lighting" }> = {
  "001": { labelPl: "Systemy bezpieczeństwa biernego (Airbag / Pasy)", categories: ["MECHANICAL"] },
  "002": { labelPl: "Systemy bezpieczeństwa czynnego (ABS / ESP)", categories: ["MECHANICAL"] },
  "003": { labelPl: "Układ zawieszenia i jezdny", categories: ["MECHANICAL"] },
  "004": { labelPl: "Elementy poszycia zewnętrznego nadwozia", categories: ["BODY"] },
  "005": { labelPl: "Konstrukcja nośna nadwozia / rama", categories: ["BODY"] },
  "006": { labelPl: "Oświetlenie zewnętrzne", categories: ["GLASS_LIGHTING"], subType: "lighting" },
  "007": { labelPl: "Oszklenie nadwozia", categories: ["GLASS_LIGHTING"], subType: "glass" },
  "008": { labelPl: "Układ hamulcowy", categories: ["MECHANICAL"] },
  "009": { labelPl: "Układ chłodzenia i klimatyzacji", categories: ["MECHANICAL"] },
  "011": { labelPl: "Tapicerka i wykończenie wnętrza", categories: ["BODY"] },
  "012": { labelPl: "Osprzęt silnika", categories: ["MECHANICAL"] },
  "013": { labelPl: "Skrzynia biegów i układ przeniesienia napędu", categories: ["MECHANICAL"] },
  "014": { labelPl: "Układ kierowniczy", categories: ["MECHANICAL"] },
  "015": { labelPl: "Układ elektryczny / wysokie napięcie (EV / Hybrid)", categories: ["MECHANICAL"] },
};

export function classifyZoneCode(code: string): DamageCategory[] {
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
