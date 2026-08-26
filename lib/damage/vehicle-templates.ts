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
// 1. BASE ANCHORS (Calibrated for Sedan baseline in 2:1 viewBox 0 0 400 200)
// ---------------------------------------------------------------------------

// RF3Q: Right Front 3/4 view (camera at front-right, seeing front and right side)
// Relational invariants:
// - Front X order: Right (04, 05, 06) < Center (07, 08, 09) < Left (01, 02, 03)
// - Front Y order: Top (04, 07, 01) < Middle (05, 08, 02) < Bottom (06, 09, 03)
// - Right side X order: Side (13, 14, 15) < Front (04..09)
const BASE_ANCHORS_RF3Q: Record<string, ViewAnchorPosition> = {
  // Front right corner (near to camera)
  "04": { x: 265, y: 98 },  // Przód prawy góra (prawa strona maski)
  "05": { x: 295, y: 120 }, // Przód prawy środek (prawy reflektor / narożnik zderzaka)
  "06": { x: 305, y: 152 }, // Przód prawy dół (dolny prawy zderzak / koło)

  // Front center
  "07": { x: 285, y: 94 },  // Przód środek góra (środek maski)
  "08": { x: 318, y: 122 }, // Przód środek środek (atrapa / grill / znaczek centralny - 05 < 08 < 02)
  "09": { x: 325, y: 155 }, // Przód środek dół (dolny wlot zderzaka)

  // Front left corner (far from camera)
  "01": { x: 310, y: 90 },  // Przód lewy góra (lewa krawędź maski)
  "02": { x: 335, y: 110 }, // Przód lewy środek (lewy reflektor / lewy narożnik)
  "03": { x: 345, y: 140 }, // Przód lewy dół (dolny lewy zderzak)

  // Visible right side (sills & doors)
  "13": { x: 150, y: 75 },  // Środek prawy góra (słupek A/B prawy / linia dachu)
  "14": { x: 145, y: 110 }, // Środek prawy środek (drzwi prawe)
  "15": { x: 150, y: 145 }, // Środek prawy dół (próg prawy)

  // Roof & Cabin
  "16": { x: 165, y: 50 },  // Dach / środek góra
  "17": { x: 200, y: 82 },  // Kabinowe wnętrze

  // General & Glass flags
  front: { x: 318, y: 122 },
  "front-left": { x: 335, y: 110 },
  "front-right": { x: 295, y: 120 },
  "side-right": { x: 145, y: 110 },
  roof: { x: 165, y: 50 },
  interior: { x: 200, y: 82 },
};

// LR3Q: Left Rear 3/4 view (camera at left-rear, seeing rear and left side)
// Relational invariants:
// - Left side X order: Side (10, 11, 12) < Rear (19..27)
// - Rear X order: Left (19, 20, 21) < Center (25, 26, 27) < Right (22, 23, 24)
// - Rear Y order: Top (19, 25, 22) < Middle (20, 26, 23) < Bottom (21, 27, 24)
const BASE_ANCHORS_LR3Q: Record<string, ViewAnchorPosition> = {
  // Visible left side (sills & doors)
  "10": { x: 150, y: 75 },  // Środek lewy góra (słupek A/B lewy / linia dachu)
  "11": { x: 145, y: 110 }, // Środek lewy środek (drzwi lewe)
  "12": { x: 150, y: 145 }, // Środek lewy dół (próg lewy)

  // Roof & Cabin
  "16": { x: 195, y: 50 },  // Dach / środek góra
  "17": { x: 185, y: 82 },  // Kabinowe wnętrze

  // Rear left corner (near to camera)
  "19": { x: 235, y: 92 },  // Tył lewy góra (lewy słupek C / górna krawędź błotnika)
  "20": { x: 255, y: 115 }, // Tył lewy środek (lewa tylna lampa zespolona)
  "21": { x: 245, y: 152 }, // Tył lewy dół (dolny lewy zderzak)

  // Rear center
  "25": { x: 275, y: 82 },  // Tył środek góra (tylna szyba / spojler klapy)
  "26": { x: 305, y: 115 }, // Tył środek środek (klapa bagażnika / tablica)
  "27": { x: 305, y: 150 }, // Tył środek dół (dyfuzor / dolna część zderzaka)

  // Rear right corner (far from camera - P-4 fix)
  "22": { x: 340, y: 88 },  // Tył prawy góra (prawy słupek C / prawa krawędź szyby)
  "23": { x: 350, y: 112 }, // Tył prawy środek (prawa tylna lampa zespolona)
  "24": { x: 345, y: 148 }, // Tył prawy dół (prawy róg dolnego zderzaka / wydech)

  // General & Glass flags
  rear: { x: 305, y: 115 },
  "rear-left": { x: 255, y: 115 },
  "rear-right": { x: 350, y: 112 },
  "side-left": { x: 145, y: 110 },
  roof: { x: 195, y: 50 },
  interior: { x: 185, y: 82 },
};

const COMMON_ANCHORS_UNDERBODY: Record<string, ViewAnchorPosition> = {
  "18": { x: 200, y: 100 },
  underbody: { x: 200, y: 100 },
};

// ---------------------------------------------------------------------------
// 2. BODY TYPE OVERRIDES (Vertical adjustments for roofline and tailgates)
// ---------------------------------------------------------------------------

// SUV: Taller body, higher roofline, higher hood line, vertical tailgate
const SUV_OVERRIDES_RF3Q: Record<string, ViewAnchorPosition> = {
  "16": { x: 165, y: 38 },
  roof: { x: 165, y: 38 },
  "13": { x: 150, y: 64 },
  "04": { x: 265, y: 90 },
  "07": { x: 285, y: 86 },
  "01": { x: 310, y: 82 },
};

const SUV_OVERRIDES_LR3Q: Record<string, ViewAnchorPosition> = {
  "16": { x: 195, y: 38 },
  roof: { x: 195, y: 38 },
  "10": { x: 150, y: 64 },
  "19": { x: 235, y: 80 },
  "22": { x: 340, y: 76 },
  "25": { x: 275, y: 65 },
  "26": { x: 305, y: 108 },
};

// Kombi (Wagon): Long straight roofline to D-pillar and vertical tailgate
const WAGON_OVERRIDES_LR3Q: Record<string, ViewAnchorPosition> = {
  "16": { x: 195, y: 44 },
  roof: { x: 195, y: 44 },
  "19": { x: 235, y: 82 },
  "22": { x: 340, y: 78 },
  "25": { x: 275, y: 65 },
  "26": { x: 305, y: 108 },
};

// Hatchback: Compact rear, slanted tailgate
const HATCH_OVERRIDES_LR3Q: Record<string, ViewAnchorPosition> = {
  "16": { x: 195, y: 44 },
  roof: { x: 195, y: 44 },
  "19": { x: 235, y: 86 },
  "22": { x: 340, y: 82 },
  "25": { x: 270, y: 72 },
  "26": { x: 305, y: 110 },
};

// ---------------------------------------------------------------------------
// 3. VEHICLE TEMPLATES
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
      "right-front-3q": BASE_ANCHORS_RF3Q,
      "left-rear-3q": BASE_ANCHORS_LR3Q,
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
      "right-front-3q": { ...BASE_ANCHORS_RF3Q, ...SUV_OVERRIDES_RF3Q },
      "left-rear-3q": { ...BASE_ANCHORS_LR3Q, ...SUV_OVERRIDES_LR3Q },
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
      "right-front-3q": BASE_ANCHORS_RF3Q,
      "left-rear-3q": { ...BASE_ANCHORS_LR3Q, ...HATCH_OVERRIDES_LR3Q },
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
      "right-front-3q": BASE_ANCHORS_RF3Q,
      "left-rear-3q": { ...BASE_ANCHORS_LR3Q, ...WAGON_OVERRIDES_LR3Q },
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
      "right-front-3q": BASE_ANCHORS_RF3Q,
      "left-rear-3q": BASE_ANCHORS_LR3Q,
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
