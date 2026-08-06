import {
  DamageCategory,
  CATEGORY_DEFINITIONS,
} from "./audatex-classification.ts";
import { DamageAssessment, DamageMarker } from "./normalize-damage-assessment.ts";
import { resolveVehicleTemplate, VehicleTemplateDefinition } from "./vehicle-templates.ts";

export interface ProcessedMarkerItem {
  markerIndex: number; // 1, 2, 3...
  id: string;
  sourceKind: string;
  sourceCode: string;
  labelPl: string;
  categories: DamageCategory[];
  primaryCategory: DamageCategory;
  categoryLabelPl: string;
  colorHex: string;
  markerShape: "triangle" | "rhombus" | "gear" | "chassis" | "circle";
  subType?: "glass" | "lighting";
  rf3qAnchor?: { x: number; y: number };
  lr3qAnchor?: { x: number; y: number };
  underbodyAnchor?: { x: number; y: number };
  viewVisibilityText: string;
}

export interface DamagePresentationModel {
  claimId: string;
  template: VehicleTemplateDefinition;
  markers: ProcessedMarkerItem[];
  hasUnderbodyView: boolean;
  categoryCounts: Record<DamageCategory, number>;
  totalMarkersCount: number;
  hasLocators: boolean;
}

export function buildDamagePresentation(
  claimId: string,
  assessment?: DamageAssessment,
  makeModelStr?: string,
  filterCategory: DamageCategory | "ALL" = "ALL"
): DamagePresentationModel {
  const template = resolveVehicleTemplate(makeModelStr);
  const rawMarkers = assessment?.markers || [];

  const categoryCounts: Record<DamageCategory, number> = {
    BODY: 0,
    GLASS_LIGHTING: 0,
    MECHANICAL: 0,
    UNDERBODY: 0,
    OTHER: 0,
  };

  for (const m of rawMarkers) {
    if (categoryCounts[m.primaryCategory] !== undefined) {
      categoryCounts[m.primaryCategory]++;
    }
  }

  // Filter markers if specific category is selected
  const filteredRaw = filterCategory === "ALL"
    ? rawMarkers
    : rawMarkers.filter((m) => m.primaryCategory === filterCategory || m.categories.includes(filterCategory));

  let hasUnderbodyView = false;
  let hasLocators = false;

  const markers: ProcessedMarkerItem[] = filteredRaw.map((m, idx) => {
    const markerIndex = idx + 1;
    const catDef = CATEGORY_DEFINITIONS[m.primaryCategory] || CATEGORY_DEFINITIONS.OTHER;

    const rf3qAnchor = m.viewAnchors.includes("right-front-3q")
      ? template.anchors["right-front-3q"][m.sourceCode]
      : undefined;

    const lr3qAnchor = m.viewAnchors.includes("left-rear-3q")
      ? template.anchors["left-rear-3q"][m.sourceCode]
      : undefined;

    const underbodyAnchor = m.viewAnchors.includes("underbody-bottom")
      ? template.anchors["underbody-bottom"][m.sourceCode]
      : undefined;

    if (underbodyAnchor || m.primaryCategory === "UNDERBODY" || m.categories.includes("UNDERBODY")) {
      hasUnderbodyView = true;
    }

    if (m.viewAnchors.length > 0) {
      hasLocators = true;
    }

    // Determine human-readable view visibility text
    const viewsPresent: string[] = [];
    if (rf3qAnchor) viewsPresent.push("Prawy przód");
    if (lr3qAnchor) viewsPresent.push("Lewy tył");
    if (underbodyAnchor) viewsPresent.push("Spód");

    const viewVisibilityText = viewsPresent.length > 0
      ? viewsPresent.join(", ")
      : "Brak lokalizacji na makiecie";

    return {
      markerIndex,
      id: m.id,
      sourceKind: m.sourceKind,
      sourceCode: m.sourceCode,
      labelPl: m.labelPl,
      categories: m.categories,
      primaryCategory: m.primaryCategory,
      categoryLabelPl: catDef.labelPl,
      colorHex: catDef.colorHex,
      markerShape: catDef.markerShape,
      subType: m.subType,
      rf3qAnchor,
      lr3qAnchor,
      underbodyAnchor,
      viewVisibilityText,
    };
  });

  return {
    claimId,
    template,
    markers,
    hasUnderbodyView,
    categoryCounts,
    totalMarkersCount: rawMarkers.length,
    hasLocators,
  };
}
