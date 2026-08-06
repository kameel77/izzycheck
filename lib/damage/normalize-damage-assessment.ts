import {
  DamageCategory,
  AUDATEX_ZONE_LABELS,
  AUDATEX_PART_GROUPS,
  getPrimaryCategory,
  classifyZoneCode,
  classifyGeneralFlag,
  classifyGlassFlag,
} from "./audatex-classification.ts";

export interface DamageMarker {
  id: string;
  sourceKind: "zone" | "group" | "general_flag" | "glass_flag";
  sourceCode: string;
  labelPl: string;
  categories: DamageCategory[];
  primaryCategory: DamageCategory;
  viewAnchors: ("right-front-3q" | "left-rear-3q" | "underbody-bottom")[];
  confidence: "zone" | "general" | "none";
  subType?: "glass" | "lighting";
}

export interface DamageAssessment {
  generalFlags: Record<string, boolean>;
  glassFlags: Record<string, boolean>;
  damagePositionCodes: string[];
  significantPartGroupCodes: string[];
  markers: DamageMarker[];
}

export const ZONE_VIEW_ANCHORS: Record<string, ("right-front-3q" | "left-rear-3q" | "underbody-bottom")[]> = {
  // Left Front side zones -> visible on left-rear-3q
  "01": ["left-rear-3q"],
  "02": ["left-rear-3q"],
  "03": ["left-rear-3q"],
  // Right Front side & center zones -> visible on right-front-3q
  "04": ["right-front-3q"],
  "05": ["right-front-3q"],
  "06": ["right-front-3q"],
  "07": ["right-front-3q"],
  "08": ["right-front-3q"],
  "09": ["right-front-3q"],
  // Left Side zones -> visible on left-rear-3q
  "10": ["left-rear-3q"],
  "11": ["left-rear-3q"],
  "12": ["left-rear-3q"],
  // Right Side zones -> visible on right-front-3q
  "13": ["right-front-3q"],
  "14": ["right-front-3q"],
  "15": ["right-front-3q"],
  // Roof & Interior -> visible on both perspectives
  "16": ["right-front-3q", "left-rear-3q"],
  "17": ["right-front-3q", "left-rear-3q"],
  // Underbody -> visible on underbody bottom scheme
  "18": ["underbody-bottom"],
  // Rear Left, Right & Center zones -> visible on left-rear-3q
  "19": ["left-rear-3q"],
  "20": ["left-rear-3q"],
  "21": ["left-rear-3q"],
  "22": ["left-rear-3q"],
  "23": ["left-rear-3q"],
  "24": ["left-rear-3q"],
  "25": ["left-rear-3q"],
  "26": ["left-rear-3q"],
  "27": ["left-rear-3q"],
};

export const GENERAL_FLAG_LABELS: Record<string, { labelPl: string; anchors: ("right-front-3q" | "left-rear-3q" | "underbody-bottom")[] }> = {
  front: { labelPl: "Strefa przednia (ogólna)", anchors: ["right-front-3q"] },
  "front-left": { labelPl: "Strefa przednia lewa (ogólna)", anchors: ["left-rear-3q"] },
  "front-right": { labelPl: "Strefa przednia prawi (ogólna)", anchors: ["right-front-3q"] },
  rear: { labelPl: "Strefa tylna (ogólna)", anchors: ["left-rear-3q"] },
  "rear-left": { labelPl: "Strefa tylna lewa (ogólna)", anchors: ["left-rear-3q"] },
  "rear-right": { labelPl: "Strefa tylna prawy (ogólna)", anchors: ["left-rear-3q"] },
  "side-left": { labelPl: "Strefa boczna lewa (ogólna)", anchors: ["left-rear-3q"] },
  "side-right": { labelPl: "Strefa boczna prawy (ogólna)", anchors: ["right-front-3q"] },
  roof: { labelPl: "Strefa dachu (ogólna)", anchors: ["right-front-3q", "left-rear-3q"] },
  interior: { labelPl: "Kabinowe wnętrze (ogólne)", anchors: ["right-front-3q", "left-rear-3q"] },
  underbody: { labelPl: "Strefa podwozia (ogólna)", anchors: ["underbody-bottom"] },
  mechanical: { labelPl: "Zespół mechaniczny (ogólny)", anchors: [] },
};

export const GLASS_FLAG_LABELS: Record<string, { labelPl: string; anchors: ("right-front-3q" | "left-rear-3q" | "underbody-bottom")[] }> = {
  front: { labelPl: "Szyba przednia", anchors: ["right-front-3q"] },
  rear: { labelPl: "Szyba tylna", anchors: ["left-rear-3q"] },
  "side-left": { labelPl: "Szyby boczne lewe", anchors: ["left-rear-3q"] },
  "side-right": { labelPl: "Szyby boczne prawe", anchors: ["right-front-3q"] },
  roof: { labelPl: "Dach przeszklony", anchors: ["right-front-3q", "left-rear-3q"] },
};

export function normalizeDamageAssessment(raw: {
  generalFlags?: Record<string, boolean>;
  glassFlags?: Record<string, boolean>;
  damagePositionCodes?: string[];
  significantPartGroupCodes?: string[];
}): DamageAssessment {
  const generalFlags = raw.generalFlags || {};
  const glassFlags = raw.glassFlags || {};
  const damagePositionCodes = raw.damagePositionCodes || [];
  const significantPartGroupCodes = raw.significantPartGroupCodes || [];

  const markers: DamageMarker[] = [];
  const processedKeys = new Set<string>();

  // 1. Process specific damage position codes (zones 01-27)
  for (const code of damagePositionCodes) {
    if (!code) continue;
    const cleanCode = code.trim();
    if (!cleanCode) continue;

    const labelPl = AUDATEX_ZONE_LABELS[cleanCode]
      ? `Strefa ${cleanCode}: ${AUDATEX_ZONE_LABELS[cleanCode]}`
      : `Strefa Audatex kod: ${cleanCode}`;

    const categories = classifyZoneCode(cleanCode);
    const primaryCategory = getPrimaryCategory(categories);
    const viewAnchors = ZONE_VIEW_ANCHORS[cleanCode] || [];

    const key = `zone-${cleanCode}`;
    if (!processedKeys.has(key)) {
      processedKeys.add(key);
      markers.push({
        id: `marker-${key}`,
        sourceKind: "zone",
        sourceCode: cleanCode,
        labelPl,
        categories,
        primaryCategory,
        viewAnchors,
        confidence: "zone",
      });
    }
  }

  // 2. Process general flags
  for (const [flagKey, val] of Object.entries(generalFlags)) {
    if (!val) continue;
    const info = GENERAL_FLAG_LABELS[flagKey] || {
      labelPl: `Audatex flaga: ${flagKey}`,
      anchors: [],
    };
    const categories = classifyGeneralFlag(flagKey);
    const primaryCategory = getPrimaryCategory(categories);

    const key = `genflag-${flagKey}`;
    if (!processedKeys.has(key)) {
      processedKeys.add(key);
      markers.push({
        id: `marker-${key}`,
        sourceKind: "general_flag",
        sourceCode: flagKey,
        labelPl: info.labelPl,
        categories,
        primaryCategory,
        viewAnchors: info.anchors,
        confidence: "general",
      });
    }
  }

  // 3. Process glass flags
  for (const [flagKey, val] of Object.entries(glassFlags)) {
    if (!val) continue;
    const info = GLASS_FLAG_LABELS[flagKey] || {
      labelPl: `Audatex flaga szyby: ${flagKey}`,
      anchors: [],
    };
    const categories = classifyGlassFlag(flagKey);
    const primaryCategory = getPrimaryCategory(categories);

    const key = `glassflag-${flagKey}`;
    if (!processedKeys.has(key)) {
      processedKeys.add(key);
      markers.push({
        id: `marker-${key}`,
        sourceKind: "glass_flag",
        sourceCode: flagKey,
        labelPl: info.labelPl,
        categories,
        primaryCategory,
        viewAnchors: info.anchors,
        confidence: "zone",
        subType: "glass",
      });
    }
  }

  // 4. Process part groups
  for (const groupCode of significantPartGroupCodes) {
    if (!groupCode) continue;
    const cleanCode = groupCode.trim();
    if (!cleanCode) continue;

    const groupDef = AUDATEX_PART_GROUPS[cleanCode];
    const labelPl = groupDef ? groupDef.labelPl : `Grupa części w kalkulacji: ${cleanCode}`;
    const categories = groupDef ? groupDef.categories : ["OTHER" as DamageCategory];
    const primaryCategory = getPrimaryCategory(categories);
    const subType = groupDef?.subType;

    const key = `group-${cleanCode}`;
    if (!processedKeys.has(key)) {
      processedKeys.add(key);
      markers.push({
        id: `marker-${key}`,
        sourceKind: "group",
        sourceCode: cleanCode,
        labelPl,
        categories,
        primaryCategory,
        viewAnchors: [],
        confidence: "none",
        subType,
      });
    }
  }

  return {
    generalFlags,
    glassFlags,
    damagePositionCodes,
    significantPartGroupCodes,
    markers,
  };
}

/**
 * Robust fallback for legacy historical reports stored with JSON strings damageZones & significantParts.
 */
export function buildFallbackDamageAssessment(
  affectedZonesList: string[],
  significantPartsList: string[]
): DamageAssessment {
  const labelToZoneCode: Record<string, string> = {};
  for (const [code, label] of Object.entries(AUDATEX_ZONE_LABELS)) {
    labelToZoneCode[label.toLowerCase()] = code;
  }

  const damagePositionCodes: string[] = [];
  const glassFlags: Record<string, boolean> = {};
  const generalFlags: Record<string, boolean> = {};

  for (const zoneStr of affectedZonesList) {
    if (!zoneStr) continue;
    const lower = zoneStr.trim().toLowerCase();

    if (labelToZoneCode[lower]) {
      damagePositionCodes.push(labelToZoneCode[lower]);
      continue;
    }

    if (lower.includes("szyba przednia")) glassFlags["front"] = true;
    else if (lower.includes("szyba tylna")) glassFlags["rear"] = true;
    else if (lower.includes("szyby boczne lewe")) glassFlags["side-left"] = true;
    else if (lower.includes("szyby boczne prawe")) glassFlags["side-right"] = true;
    else if (lower.includes("podwozie")) generalFlags["underbody"] = true;
    else if (lower.includes("mechaniczny")) generalFlags["mechanical"] = true;
    else if (lower.includes("przód lewy")) generalFlags["front-left"] = true;
    else if (lower.includes("przód prawy")) generalFlags["front-right"] = true;
    else if (lower.includes("przód")) generalFlags["front"] = true;
    else if (lower.includes("tył lewy")) generalFlags["rear-left"] = true;
    else if (lower.includes("tył prawy")) generalFlags["rear-right"] = true;
    else if (lower.includes("tył")) generalFlags["rear"] = true;
    else if (lower.includes("wnętrze")) generalFlags["interior"] = true;
  }

  const significantPartGroupCodes: string[] = [];
  for (const partStr of significantPartsList) {
    if (!partStr) continue;
    const lower = partStr.trim().toLowerCase();
    let found = false;

    for (const [code, def] of Object.entries(AUDATEX_PART_GROUPS)) {
      if (def.labelPl.toLowerCase() === lower || lower.includes(def.labelPl.toLowerCase().slice(0, 15))) {
        significantPartGroupCodes.push(code);
        found = true;
        break;
      }
    }

    if (!found) {
      significantPartGroupCodes.push(partStr);
    }
  }

  return normalizeDamageAssessment({
    generalFlags,
    glassFlags,
    damagePositionCodes,
    significantPartGroupCodes,
  });
}
