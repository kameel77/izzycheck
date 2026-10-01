export type VehicleBodyType =
  | "passenger-sedan"
  | "passenger-suv"
  | "passenger-hatchback"
  | "passenger-wagon"
  | "generic-passenger";

export interface ViewAnchorPosition {
  x: number; // viewBox coordinate (0-400)
  y: number; // viewBox coordinate (0-200)
}

export interface VehicleTemplateDefinition {
  bodyType: VehicleBodyType;
  labelPl: string;
  isGeneric: boolean;
  assetPrefix: "suv" | "sedan" | "kombi" | "hatchback";
  assetFrontWebp: string;
  assetBackWebp: string;
  assetFrontPdfJpg: string;
  assetBackPdfJpg: string;
  anchors: {
    "right-front-3q": Record<string, ViewAnchorPosition>;
    "left-rear-3q": Record<string, ViewAnchorPosition>;
    "underbody-bottom": Record<string, ViewAnchorPosition>;
  };
}

// ---------------------------------------------------------------------------
// 1. ZONE ANCHORS (one full table per body type and photo, 400x200 viewBox)
// ---------------------------------------------------------------------------
//
// Audatex zone codes 01-27 form a 3x3x3 grid: X (Front/Middle/Rear) x Y (Left/Middle/Right) x
// Z (Top/Middle/Bottom). Every zone is drawn on exactly ONE of the two photos:
// - rf3q (right-front 3/4):  04 05 06, 07 08 09, 13 14 15, 16, 22 23 24
//                            (whole right side + front centre + roof)
// - lr3q (left-rear 3/4):    01 02 03, 10 11 12, 19 20 21, 25 26 27
//                            (whole left side + rear centre)
// - Off-photo: 17 (interior) and 18 (centre underbody) - see ZONE_VIEW_ANCHORS in
//   normalize-damage-assessment.ts. 18 is drawn on the underbody schematic below.
//
// Z rule (use it when recalibrating): Top = A-pillar / C-pillar / roofline height,
// Middle = half of the car height, Bottom = sills / lower bumpers.
//
// Values were measured on the real images in public/vehicles/pdf (the web stage images in
// public/vehicles/stage share the same framing). Keep min distance between anchors >= 28.

const SEDAN_ANCHORS_RF3Q: Record<string, ViewAnchorPosition> = {
  "04": { x: 160, y: 52 },
  "05": { x: 238, y: 104 },
  "06": { x: 245, y: 140 },
  "07": { x: 240, y: 58 },
  "08": { x: 318, y: 106 },
  "09": { x: 320, y: 140 },
  "13": { x: 115, y: 37 },
  "14": { x: 125, y: 100 },
  "15": { x: 128, y: 138 },
  "16": { x: 200, y: 31 },
  "22": { x: 68, y: 60 },
  "23": { x: 42, y: 102 },
  "24": { x: 45, y: 137 },
};

const SEDAN_ANCHORS_LR3Q: Record<string, ViewAnchorPosition> = {
  "01": { x: 98, y: 58 },
  "02": { x: 55, y: 102 },
  "03": { x: 38, y: 130 },
  "10": { x: 160, y: 38 },
  "11": { x: 150, y: 98 },
  "12": { x: 150, y: 136 },
  "19": { x: 205, y: 52 },
  "20": { x: 232, y: 102 },
  "21": { x: 235, y: 135 },
  "25": { x: 285, y: 52 },
  "26": { x: 320, y: 104 },
  "27": { x: 320, y: 138 },
};

const HATCHBACK_ANCHORS_RF3Q: Record<string, ViewAnchorPosition> = {
  "04": { x: 165, y: 45 },
  "05": { x: 245, y: 105 },
  "06": { x: 250, y: 145 },
  "07": { x: 225, y: 52 },
  "08": { x: 320, y: 112 },
  "09": { x: 320, y: 142 },
  "13": { x: 110, y: 30 },
  "14": { x: 115, y: 97 },
  "15": { x: 130, y: 135 },
  "16": { x: 190, y: 27 },
  "22": { x: 68, y: 55 },
  "23": { x: 40, y: 100 },
  "24": { x: 35, y: 132 },
};

const HATCHBACK_ANCHORS_LR3Q: Record<string, ViewAnchorPosition> = {
  "01": { x: 105, y: 55 },
  "02": { x: 55, y: 100 },
  "03": { x: 40, y: 128 },
  "10": { x: 175, y: 32 },
  "11": { x: 155, y: 98 },
  "12": { x: 155, y: 138 },
  "19": { x: 238, y: 52 },
  "20": { x: 235, y: 102 },
  "21": { x: 258, y: 138 },
  "25": { x: 305, y: 58 },
  "26": { x: 320, y: 105 },
  "27": { x: 325, y: 142 },
};

const WAGON_ANCHORS_RF3Q: Record<string, ViewAnchorPosition> = {
  "04": { x: 172, y: 55 },
  "05": { x: 245, y: 110 },
  "06": { x: 250, y: 145 },
  "07": { x: 240, y: 60 },
  "08": { x: 320, y: 112 },
  "09": { x: 320, y: 145 },
  "13": { x: 120, y: 40 },
  "14": { x: 125, y: 100 },
  "15": { x: 130, y: 138 },
  "16": { x: 200, y: 40 },
  "22": { x: 52, y: 58 },
  "23": { x: 32, y: 100 },
  "24": { x: 35, y: 130 },
};

const WAGON_ANCHORS_LR3Q: Record<string, ViewAnchorPosition> = {
  "01": { x: 105, y: 58 },
  "02": { x: 50, y: 103 },
  "03": { x: 35, y: 130 },
  "10": { x: 175, y: 40 },
  "11": { x: 155, y: 100 },
  "12": { x: 155, y: 138 },
  "19": { x: 258, y: 55 },
  "20": { x: 245, y: 103 },
  "21": { x: 262, y: 140 },
  "25": { x: 310, y: 58 },
  "26": { x: 330, y: 108 },
  "27": { x: 330, y: 142 },
};

const SUV_ANCHORS_RF3Q: Record<string, ViewAnchorPosition> = {
  "04": { x: 165, y: 35 },
  "05": { x: 255, y: 90 },
  "06": { x: 262, y: 120 },
  "07": { x: 225, y: 38 },
  "08": { x: 325, y: 90 },
  "09": { x: 325, y: 128 },
  "13": { x: 110, y: 15 },
  "14": { x: 115, y: 90 },
  "15": { x: 130, y: 128 },
  "16": { x: 185, y: 13 },
  "22": { x: 55, y: 35 },
  "23": { x: 30, y: 92 },
  "24": { x: 30, y: 120 },
};

const SUV_ANCHORS_LR3Q: Record<string, ViewAnchorPosition> = {
  "01": { x: 120, y: 48 },
  "02": { x: 50, y: 95 },
  "03": { x: 35, y: 125 },
  "10": { x: 185, y: 28 },
  "11": { x: 165, y: 95 },
  "12": { x: 165, y: 130 },
  "19": { x: 245, y: 45 },
  "20": { x: 245, y: 98 },
  "21": { x: 285, y: 130 },
  "25": { x: 305, y: 45 },
  "26": { x: 330, y: 95 },
  "27": { x: 340, y: 135 },
};

// Underbody photo (same image for all body types, public/vehicles/{pdf/underbody.jpg,stage/underbody.webp},
// 2000x1116 -> 400x223 viewBox, front on the LEFT). Anchor = centre of the floor pan, between the
// exhaust tunnel and the fuel tanks, clear of the wheels.
export const UNDERBODY_VIEWBOX_W = 400;
export const UNDERBODY_VIEWBOX_H = 223;
export const UNDERBODY_IMAGE_PDF_JPG = "underbody.jpg";
export const UNDERBODY_IMAGE_WEBP = "/vehicles/stage/underbody.webp";

const COMMON_ANCHORS_UNDERBODY: Record<string, ViewAnchorPosition> = {
  "18": { x: 200, y: 112 },
  underbody: { x: 200, y: 112 },
};

// ---------------------------------------------------------------------------
// 2. VEHICLE TEMPLATES
// ---------------------------------------------------------------------------

export const VEHICLE_TEMPLATES: Record<VehicleBodyType, VehicleTemplateDefinition> = {
  "passenger-sedan": {
    bodyType: "passenger-sedan",
    labelPl: "Sedan / Limuzyna",
    isGeneric: false,
    assetPrefix: "sedan",
    assetFrontWebp: "/vehicles/stage/sedan-rf3q.webp",
    assetBackWebp: "/vehicles/stage/sedan-lr3q.webp",
    assetFrontPdfJpg: "sedan-rf3q.jpg",
    assetBackPdfJpg: "sedan-lr3q.jpg",
    anchors: {
      "right-front-3q": SEDAN_ANCHORS_RF3Q,
      "left-rear-3q": SEDAN_ANCHORS_LR3Q,
      "underbody-bottom": COMMON_ANCHORS_UNDERBODY,
    },
  },
  "passenger-suv": {
    bodyType: "passenger-suv",
    labelPl: "SUV / Crossover",
    isGeneric: false,
    assetPrefix: "suv",
    assetFrontWebp: "/vehicles/stage/suv-rf3q.webp",
    assetBackWebp: "/vehicles/stage/suv-lr3q.webp",
    assetFrontPdfJpg: "suv-rf3q.jpg",
    assetBackPdfJpg: "suv-lr3q.jpg",
    anchors: {
      "right-front-3q": SUV_ANCHORS_RF3Q,
      "left-rear-3q": SUV_ANCHORS_LR3Q,
      "underbody-bottom": COMMON_ANCHORS_UNDERBODY,
    },
  },
  "passenger-hatchback": {
    bodyType: "passenger-hatchback",
    labelPl: "Hatchback",
    isGeneric: false,
    assetPrefix: "hatchback",
    assetFrontWebp: "/vehicles/stage/hatchback-rf3q.webp",
    assetBackWebp: "/vehicles/stage/hatchback-lr3q.webp",
    assetFrontPdfJpg: "hatchback-rf3q.jpg",
    assetBackPdfJpg: "hatchback-lr3q.jpg",
    anchors: {
      "right-front-3q": HATCHBACK_ANCHORS_RF3Q,
      "left-rear-3q": HATCHBACK_ANCHORS_LR3Q,
      "underbody-bottom": COMMON_ANCHORS_UNDERBODY,
    },
  },
  "passenger-wagon": {
    bodyType: "passenger-wagon",
    labelPl: "Kombi",
    isGeneric: false,
    assetPrefix: "kombi",
    assetFrontWebp: "/vehicles/stage/kombi-rf3q.webp",
    assetBackWebp: "/vehicles/stage/kombi-lr3q.webp",
    assetFrontPdfJpg: "kombi-rf3q.jpg",
    assetBackPdfJpg: "kombi-lr3q.jpg",
    anchors: {
      "right-front-3q": WAGON_ANCHORS_RF3Q,
      "left-rear-3q": WAGON_ANCHORS_LR3Q,
      "underbody-bottom": COMMON_ANCHORS_UNDERBODY,
    },
  },
  "generic-passenger": {
    bodyType: "generic-passenger",
    labelPl: "Pojazd osobowy (makieta poglądowa)",
    isGeneric: true,
    // Generic fallback uses neutral sedan render with generic badge
    assetPrefix: "sedan",
    assetFrontWebp: "/vehicles/stage/sedan-rf3q.webp",
    assetBackWebp: "/vehicles/stage/sedan-lr3q.webp",
    assetFrontPdfJpg: "sedan-rf3q.jpg",
    assetBackPdfJpg: "sedan-lr3q.jpg",
    anchors: {
      "right-front-3q": SEDAN_ANCHORS_RF3Q,
      "left-rear-3q": SEDAN_ANCHORS_LR3Q,
      "underbody-bottom": COMMON_ANCHORS_UNDERBODY,
    },
  },
};

/**
 * Match vehicle body type with priority:
 * 1. Audatex technicalSpec.bodyType dictionary mapping
 * 2. Make / model text heuristics
 * 3. Fallback to 'generic-passenger' (sedan render + generic badge)
 */
export function resolveVehicleTemplate(
  makeModelStr?: string,
  technicalSpecBodyType?: string
): VehicleTemplateDefinition {
  // 1. Highest priority: technicalSpec.bodyType directly from Audatex
  if (technicalSpecBodyType) {
    const bt = technicalSpecBodyType.toLowerCase().trim();
    if (bt.includes("suv") || bt.includes("terenowy") || bt.includes("geländewagen") || bt.includes("crossover")) {
      return VEHICLE_TEMPLATES["passenger-suv"];
    }
    if (
      bt.includes("kombi") ||
      bt.includes("combi") ||
      bt.includes("variant") ||
      bt.includes("avant") ||
      bt.includes("touring") ||
      bt.includes("estate") ||
      bt.includes("wagon") ||
      bt.includes("station")
    ) {
      return VEHICLE_TEMPLATES["passenger-wagon"];
    }
    if (bt.includes("hatchback")) {
      return VEHICLE_TEMPLATES["passenger-hatchback"];
    }
    if (
      bt.includes("sedan") ||
      bt.includes("limuzyna") ||
      bt.includes("coupé") ||
      bt.includes("coupe") ||
      bt.includes("kupe") ||
      bt.includes("kabriolet") ||
      bt.includes("cabriolet") ||
      bt.includes("cabrio") ||
      bt.includes("liftback") ||
      bt.includes("fastback")
    ) {
      return VEHICLE_TEMPLATES["passenger-sedan"];
    }
  }

  // 2. Secondary heuristic: make / model string keywords
  if (makeModelStr) {
    const text = makeModelStr.toLowerCase();

    if (
      text.includes("suv") ||
      text.includes("vitara") ||
      text.includes("tucson") ||
      text.includes("qashqai") ||
      text.includes("tiguan") ||
      text.includes("x5") ||
      text.includes("x3") ||
      text.includes("rav4") ||
      text.includes("kodiaq") ||
      text.includes("karoq") ||
      text.includes("sportage") ||
      text.includes("cr-v") ||
      text.includes("cx-5")
    ) {
      return VEHICLE_TEMPLATES["passenger-suv"];
    }

    if (
      text.includes("kombi") ||
      text.includes("estate") ||
      text.includes("touring") ||
      text.includes("variant") ||
      text.includes("avant") ||
      text.includes("wagon") ||
      text.includes("combi")
    ) {
      return VEHICLE_TEMPLATES["passenger-wagon"];
    }

    if (
      text.includes("hatchback") ||
      text.includes("golf") ||
      text.includes("yaris") ||
      text.includes("corsa") ||
      text.includes("clio") ||
      text.includes("i20") ||
      text.includes("i30") ||
      text.includes("polo") ||
      text.includes("fabia") ||
      text.includes("fiesta") ||
      text.includes("astra")
    ) {
      return VEHICLE_TEMPLATES["passenger-hatchback"];
    }

    if (
      text.includes("sedan") ||
      text.includes("arteon") ||
      text.includes("passat") ||
      text.includes("superb") ||
      text.includes("seria 3") ||
      text.includes("seria 5") ||
      text.includes("klasa c") ||
      text.includes("klasa e") ||
      text.includes("a4") ||
      text.includes("a6") ||
      text.includes("octavia") ||
      text.includes("mondeo") ||
      text.includes("insignia") ||
      text.includes("camry") ||
      text.includes("corolla")
    ) {
      return VEHICLE_TEMPLATES["passenger-sedan"];
    }
  }

  // 3. Fallback: generic-passenger
  return VEHICLE_TEMPLATES["generic-passenger"];
}
