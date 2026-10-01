import {
  DamageCategory,
  CATEGORY_DEFINITIONS,
  CATEGORY_PRIORITY_ORDER,
} from "./audatex-classification.ts";
import {
  DamageAssessment,
  GENERAL_FLAG_LABELS,
  GLASS_FLAG_LABELS,
  normalizeDamageAssessment,
  UNDEFINED_ZONE_CODE,
} from "./normalize-damage-assessment.ts";
import { resolveVehicleTemplate, VehicleTemplateDefinition } from "./vehicle-templates.ts";

/** Captions of the two vehicle photos (also used above the images in the PDF and the web report). */
export const PHOTO_1_CAPTION = "Zdjęcie 1: przód i prawy bok";
export const PHOTO_2_CAPTION = "Zdjęcie 2: tył i lewy bok";

export type MarkerView = "rf3q" | "lr3q" | "underbody" | "off-photo" | "none";

export interface ProcessedMarkerItem {
  markerIndex: number; // 1, 2, 3... (row order; never displayed)
  id: string;
  sourceKind: string;
  sourceCode: string;
  labelPl: string;
  /** Description without the "Strefa XX:" prefix. */
  titlePl: string;
  /** Caption under the title ("okolice: ... (orientacyjnie)"), with " (przybliżona)" for legacy approximate zones. */
  hintPl?: string;
  categories: DamageCategory[];
  primaryCategory: DamageCategory;
  categoryLabelPl: string;
  colorHex: string;
  markerShape: "triangle" | "rhombus" | "gear" | "chassis" | "circle";
  subType?: "glass" | "lighting";
  rf3qAnchor?: { x: number; y: number };
  lr3qAnchor?: { x: number; y: number };
  underbodyAnchor?: { x: number; y: number };
  /** Exactly one view per marker (rf3qAnchor / lr3qAnchor / underbodyAnchor are set only for it). */
  view: MarkerView;
  /** Legacy flag converted to an approximate zone (no zone codes in damage-positions). */
  approximate: boolean;
}

export interface DamagePresentationModel {
  claimId: string;
  template: VehicleTemplateDefinition;
  markers: ProcessedMarkerItem[];
  /** Zone rows of the "Strefy uszkodzeń" list: every non-group marker except zone 00, by zone code ascending. */
  zoneList: ProcessedMarkerItem[];
  /** Part groups (001-015), shown as chips instead of rows. */
  groupChips: ProcessedMarkerItem[];
  /** Zone 00 is present: not listed, only mentioned in a caption under the list. */
  hasUndefinedZone: boolean;
  /** Categories used by zone rows and group chips (zone 00 does not count), in priority order. */
  legendCategories: DamageCategory[];
  /** True when at least one marker is drawn on the underbody schematic. */
  hasUnderbodyView: boolean;
  /** True when at least one marker (zone 17 / interior) has no photo and goes to the "Poza zdjęciami" list. */
  hasOffPhotoMarkers: boolean;
  /** "Flagi ogólne Audatex: przód · Szyby: przednia" (empty parts omitted); undefined when no flags are set. */
  flagsText?: string;
  categoryCounts: Record<DamageCategory, number>;
  totalMarkersCount: number;
  hasLocators: boolean;
}

function buildFlagsText(
  generalFlags: Record<string, boolean>,
  glassFlags: Record<string, boolean>
): string | undefined {
  const general = Object.entries(generalFlags)
    .filter(([, v]) => v)
    .map(([k]) => GENERAL_FLAG_LABELS[k]?.shortPl ?? k);
  const glass = Object.entries(glassFlags)
    .filter(([, v]) => v)
    .map(([k]) => GLASS_FLAG_LABELS[k]?.shortPl ?? k);

  const parts: string[] = [];
  if (general.length > 0) parts.push(`Flagi ogólne Audatex: ${general.join(", ")}`);
  if (glass.length > 0) parts.push(`Szyby: ${glass.join(", ")}`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export function buildDamagePresentation(
  claimId: string,
  assessment?: DamageAssessment,
  makeModelStr?: string,
  filterCategory: DamageCategory | "ALL" = "ALL",
  technicalSpecBodyType?: string
): DamagePresentationModel {
  const template = resolveVehicleTemplate(makeModelStr, technicalSpecBodyType);
  // Markers are always re-derived from the raw Audatex fields so that assessments stored before the
  // one-photo-per-zone rules (with flag markers / old view anchors) render with the current rules.
  const normalized = assessment
    ? normalizeDamageAssessment({
        generalFlags: assessment.generalFlags,
        glassFlags: assessment.glassFlags,
        damagePositionCodes: assessment.damagePositionCodes,
        significantPartGroupCodes: assessment.significantPartGroupCodes,
      })
    : undefined;
  const rawMarkers = normalized?.markers || [];

  const categoryCounts: Record<DamageCategory, number> = {
    BODY: 0,
    GLASS_LIGHTING: 0,
    MECHANICAL: 0,
    UNDERBODY: 0,
    OTHER: 0,
  };

  const isUndefinedZone = (m: { sourceKind: string; sourceCode: string }) =>
    m.sourceKind === "zone" && m.sourceCode === UNDEFINED_ZONE_CODE;

  for (const m of rawMarkers) {
    if (isUndefinedZone(m)) continue; // zone 00 is not listed, so it does not count towards a category
    if (categoryCounts[m.primaryCategory] !== undefined) {
      categoryCounts[m.primaryCategory]++;
    }
  }

  // Filter markers if specific category is selected
  const filteredRaw = filterCategory === "ALL"
    ? rawMarkers
    : rawMarkers.filter((m) => m.primaryCategory === filterCategory || m.categories.includes(filterCategory));

  let hasUnderbodyView = false;
  let hasOffPhotoMarkers = false;
  let hasLocators = false;

  const markers: ProcessedMarkerItem[] = filteredRaw.map((m, idx) => {
    const markerIndex = idx + 1;
    const catDef = CATEGORY_DEFINITIONS[m.primaryCategory] || CATEGORY_DEFINITIONS.OTHER;

    // One view per marker, derived from the zone rule (never from per-view anchor presence).
    const zone = m.anchorZone;
    const viewAnchor = m.viewAnchors[0];
    const rf3qAnchor =
      viewAnchor === "right-front-3q" && zone ? template.anchors["right-front-3q"][zone] : undefined;
    const lr3qAnchor =
      viewAnchor === "left-rear-3q" && zone ? template.anchors["left-rear-3q"][zone] : undefined;
    const underbodyAnchor =
      viewAnchor === "underbody-bottom" && zone ? template.anchors["underbody-bottom"][zone] : undefined;

    let view: MarkerView = "none";
    if (rf3qAnchor) {
      view = "rf3q";
    } else if (lr3qAnchor) {
      view = "lr3q";
    } else if (underbodyAnchor) {
      view = "underbody";
    } else if (viewAnchor === "off-photo") {
      view = "off-photo";
    }

    const approximate = Boolean(m.approximate) && view !== "none";
    const hintPl = approximate ? [m.hintPl, "(przybliżona)"].filter(Boolean).join(" ") : m.hintPl;

    if (view === "underbody" || m.primaryCategory === "UNDERBODY" || m.categories.includes("UNDERBODY")) {
      hasUnderbodyView = true;
    }
    if (view === "off-photo") {
      hasOffPhotoMarkers = true;
    }
    if (view !== "none") {
      hasLocators = true;
    }

    return {
      markerIndex,
      id: m.id,
      sourceKind: m.sourceKind,
      sourceCode: m.sourceCode,
      labelPl: m.labelPl,
      titlePl: m.titlePl,
      hintPl,
      categories: m.categories,
      primaryCategory: m.primaryCategory,
      categoryLabelPl: catDef.labelPl,
      colorHex: catDef.colorHex,
      markerShape: catDef.markerShape,
      subType: m.subType,
      rf3qAnchor,
      lr3qAnchor,
      underbodyAnchor,
      view,
      approximate,
    };
  });

  const zoneList = markers.filter((m) => m.sourceKind !== "group" && !isUndefinedZone(m));
  const groupChips = markers.filter((m) => m.sourceKind === "group");
  const used = new Set([...zoneList, ...groupChips].map((m) => m.primaryCategory));

  return {
    claimId,
    template,
    markers,
    zoneList,
    groupChips,
    hasUndefinedZone: rawMarkers.some(isUndefinedZone),
    legendCategories: CATEGORY_PRIORITY_ORDER.filter((c) => used.has(c)),
    hasUnderbodyView,
    hasOffPhotoMarkers,
    flagsText: normalized ? buildFlagsText(normalized.generalFlags, normalized.glassFlags) : undefined,
    categoryCounts,
    totalMarkersCount: rawMarkers.length,
    hasLocators,
  };
}
