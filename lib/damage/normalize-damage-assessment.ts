import {
  DamageCategory,
  AUDATEX_ZONE_LABELS,
  AUDATEX_ZONES,
  AUDATEX_PART_GROUPS,
  normalizePartGroupCode,
  normalizeZoneCode,
  zoneHintCaption,
  getPrimaryCategory,
  classifyZoneCode,
  classifyGeneralFlag,
  classifyGlassFlag,
} from "./audatex-classification.ts";

export type DamageViewId = "right-front-3q" | "left-rear-3q" | "underbody-bottom" | "off-photo";

export interface DamageMarker {
  id: string;
  sourceKind: "zone" | "group" | "general_flag" | "glass_flag";
  sourceCode: string;
  labelPl: string;
  /** Description without the "Strefa XX:" prefix (natural Polish axis description for zones). */
  titlePl: string;
  /** Orientation caption for zones, e.g. "okolice: prawy słupek C (orientacyjnie)". */
  hintPl?: string;
  categories: DamageCategory[];
  primaryCategory: DamageCategory;
  /** At most one entry: every zone lives on exactly one photo (or off-photo). */
  viewAnchors: DamageViewId[];
  /** Zone code whose template anchor is used for placement (differs from sourceCode for legacy flags). */
  anchorZone?: string;
  /** True for legacy flag markers converted to an approximate zone. */
  approximate?: boolean;
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

// Each zone is placed on exactly ONE view. 17 (interior) has no photo and is listed next to the
// underbody schematic ("off-photo"); 18 (centre underbody) is drawn on the underbody schematic.
export const ZONE_VIEW_ANCHORS: Record<string, DamageViewId[]> = {
  // Right side + front centre + roof -> right-front-3q
  "04": ["right-front-3q"],
  "05": ["right-front-3q"],
  "06": ["right-front-3q"],
  "07": ["right-front-3q"],
  "08": ["right-front-3q"],
  "09": ["right-front-3q"],
  "13": ["right-front-3q"],
  "14": ["right-front-3q"],
  "15": ["right-front-3q"],
  "16": ["right-front-3q"],
  "22": ["right-front-3q"],
  "23": ["right-front-3q"],
  "24": ["right-front-3q"],
  // Left side + rear centre -> left-rear-3q
  "01": ["left-rear-3q"],
  "02": ["left-rear-3q"],
  "03": ["left-rear-3q"],
  "10": ["left-rear-3q"],
  "11": ["left-rear-3q"],
  "12": ["left-rear-3q"],
  "19": ["left-rear-3q"],
  "20": ["left-rear-3q"],
  "21": ["left-rear-3q"],
  "25": ["left-rear-3q"],
  "26": ["left-rear-3q"],
  "27": ["left-rear-3q"],
  // Off-photo
  "17": ["off-photo"],
  "18": ["underbody-bottom"],
};

/** Zone 00 = "undefined" in the Audatex spec: table row only, never a marker. */
export const UNDEFINED_ZONE_CODE = "00";

function isLocatableZoneCode(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(ZONE_VIEW_ANCHORS, code);
}

// Legacy fallback (no zone codes in damage-positions): flags are converted to an approximate zone.
// `shortPl` is used for the "Flagi ogólne Audatex" text line.
export const GENERAL_FLAG_LABELS: Record<string, { labelPl: string; shortPl: string; legacyZone?: string }> = {
  front: { labelPl: "Strefa przednia (ogólna)", shortPl: "przód", legacyZone: "08" },
  "front-left": { labelPl: "Strefa przednia lewa (ogólna)", shortPl: "przód lewy", legacyZone: "02" },
  "front-right": { labelPl: "Strefa przednia prawa (ogólna)", shortPl: "przód prawy", legacyZone: "05" },
  rear: { labelPl: "Strefa tylna (ogólna)", shortPl: "tył", legacyZone: "26" },
  "rear-left": { labelPl: "Strefa tylna lewa (ogólna)", shortPl: "tył lewy", legacyZone: "20" },
  "rear-right": { labelPl: "Strefa tylna prawa (ogólna)", shortPl: "tył prawy", legacyZone: "23" },
  "side-left": { labelPl: "Strefa boczna lewa (ogólna)", shortPl: "bok lewy", legacyZone: "11" },
  "side-right": { labelPl: "Strefa boczna prawa (ogólna)", shortPl: "bok prawy", legacyZone: "14" },
  roof: { labelPl: "Strefa dachu (ogólna)", shortPl: "dach", legacyZone: "16" },
  interior: { labelPl: "Kabinowe wnętrze (ogólne)", shortPl: "wnętrze", legacyZone: "17" },
  underbody: { labelPl: "Strefa podwozia (ogólna)", shortPl: "podwozie", legacyZone: "18" },
  mechanical: { labelPl: "Zespół mechaniczny (ogólny)", shortPl: "mechaniczne" },
};

export const GLASS_FLAG_LABELS: Record<string, { labelPl: string; shortPl: string; legacyZone?: string }> = {
  front: { labelPl: "Szyba przednia", shortPl: "przednia", legacyZone: "07" },
  rear: { labelPl: "Szyba tylna", shortPl: "tylna", legacyZone: "25" },
  "side-left": { labelPl: "Szyby boczne lewe", shortPl: "boczne lewe", legacyZone: "10" },
  "side-right": { labelPl: "Szyby boczne prawe", shortPl: "boczne prawe", legacyZone: "13" },
  roof: { labelPl: "Dach przeszklony", shortPl: "dach", legacyZone: "16" },
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

  // 1. Process specific damage position codes (zones 00-27)
  for (const code of damagePositionCodes) {
    if (!code) continue;
    const cleanCode = normalizeZoneCode(code);
    if (!cleanCode) continue;

    const isUndefinedZone = cleanCode === UNDEFINED_ZONE_CODE;
    const zoneDef = AUDATEX_ZONES[cleanCode];
    const titlePl = zoneDef ? zoneDef.titlePl : `Strefa Audatex kod: ${cleanCode}`;
    const labelPl = zoneDef && !isUndefinedZone ? `Strefa ${cleanCode}: ${titlePl}` : titlePl;

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
        titlePl,
        hintPl: zoneHintCaption(cleanCode),
        categories,
        primaryCategory,
        viewAnchors,
        anchorZone: viewAnchors.length > 0 ? cleanCode : undefined,
        confidence: isUndefinedZone ? "none" : "zone",
      });
    }
  }

  // 2-3. Flags. When the claim has zone codes 01-27, flags are NOT markers (the presentation shows
  // them as a text line). Only without zone codes (legacy) they become approximate markers,
  // deduplicated to one marker per resulting zone.
  const hasZoneCodes = damagePositionCodes.some((c) => c && isLocatableZoneCode(normalizeZoneCode(c)));

  if (!hasZoneCodes) {
    const legacyFlags: {
      kind: "general_flag" | "glass_flag";
      flags: Record<string, boolean>;
      labels: Record<string, { labelPl: string; legacyZone?: string }>;
      classify: (flagKey: string) => DamageCategory[];
    }[] = [
      { kind: "general_flag", flags: generalFlags, labels: GENERAL_FLAG_LABELS, classify: classifyGeneralFlag },
      { kind: "glass_flag", flags: glassFlags, labels: GLASS_FLAG_LABELS, classify: classifyGlassFlag },
    ];

    for (const { kind, flags, labels, classify } of legacyFlags) {
      for (const [flagKey, val] of Object.entries(flags)) {
        if (!val) continue;
        const zone = labels[flagKey]?.legacyZone;
        if (!zone) continue; // mechanical / unknown flags: text only

        const key = `legacy-zone-${zone}`;
        if (processedKeys.has(key)) continue;
        processedKeys.add(key);

        const categories = classify(flagKey);
        markers.push({
          id: `marker-${kind === "general_flag" ? "genflag" : "glassflag"}-${flagKey}`,
          sourceKind: kind,
          sourceCode: flagKey,
          labelPl: labels[flagKey].labelPl,
          titlePl: labels[flagKey].labelPl,
          categories,
          primaryCategory: getPrimaryCategory(categories),
          viewAnchors: ZONE_VIEW_ANCHORS[zone],
          anchorZone: zone,
          approximate: true,
          confidence: kind === "general_flag" ? "general" : "zone",
          subType: kind === "glass_flag" ? "glass" : undefined,
        });
      }
    }
  }

  // 4. Process part groups
  for (const groupCode of significantPartGroupCodes) {
    if (!groupCode) continue;
    const cleanCode = normalizePartGroupCode(groupCode);
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
        titlePl: labelPl,
        categories,
        primaryCategory,
        viewAnchors: [],
        confidence: "none",
        subType,
      });
    }
  }

  // Order: zones (incl. approximate legacy flag zones) by zone code ascending, then part groups by code.
  const sortKey = (m: DamageMarker) => (m.sourceKind === "group" ? 1 : 0);
  const codeKey = (m: DamageMarker) => m.anchorZone ?? m.sourceCode;
  markers.sort((a, b) => sortKey(a) - sortKey(b) || codeKey(a).localeCompare(codeKey(b)));

  return {
    generalFlags,
    glassFlags,
    damagePositionCodes: damagePositionCodes.map((c) => (c ? normalizeZoneCode(c) : c)),
    significantPartGroupCodes: significantPartGroupCodes.map((c) => (c ? normalizePartGroupCode(c) : c)),
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

    // Exact match (current or legacy label) first, so e.g. 001 and 002 (same 15-char prefix) do not collide.
    const groups = Object.entries(AUDATEX_PART_GROUPS);
    const exact = groups.find(([, def]) =>
      [def.labelPl, ...(def.legacyLabelsPl ?? [])].some((l) => l.toLowerCase() === lower)
    );
    const match = exact ?? groups.find(([, def]) => lower.includes(def.labelPl.toLowerCase().slice(0, 15)));
    if (match) {
      significantPartGroupCodes.push(match[0]);
      found = true;
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
