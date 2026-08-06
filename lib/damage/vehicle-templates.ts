export type VehicleBodyType =
  | "passenger-sedan"
  | "passenger-suv"
  | "passenger-hatchback"
  | "passenger-wagon"
  | "generic-passenger";

export interface ViewAnchorPosition {
  x: number; // percentage or viewBox coordinate (0-400)
  y: number; // percentage or viewBox coordinate (0-200)
}

export interface VehicleTemplateDefinition {
  bodyType: VehicleBodyType;
  labelPl: string;
  isGeneric: boolean;
  anchors: {
    "right-front-3q": Record<string, ViewAnchorPosition>;
    "left-rear-3q": Record<string, ViewAnchorPosition>;
    "underbody-bottom": Record<string, ViewAnchorPosition>;
  };
}

// Universal anchor coordinates for viewBox 0 0 400 200
const COMMON_ANCHORS_RF3Q: Record<string, ViewAnchorPosition> = {
  // Zone codes
  "01": { x: 260, y: 95 },
  "02": { x: 285, y: 115 },
  "03": { x: 300, y: 145 },
  "04": { x: 290, y: 100 },
  "05": { x: 325, y: 125 },
  "06": { x: 345, y: 155 },
  "07": { x: 275, y: 90 },
  "08": { x: 310, y: 120 },
  "09": { x: 325, y: 150 },
  "10": { x: 180, y: 65 },
  "11": { x: 160, y: 105 },
  "12": { x: 155, y: 135 },
  "13": { x: 220, y: 75 },
  "14": { x: 235, y: 110 },
  "15": { x: 240, y: 140 },
  "16": { x: 175, y: 55 },
  "17": { x: 200, y: 85 },
  // General & Glass flags
  front: { x: 310, y: 120 },
  "front-left": { x: 285, y: 115 },
  "front-right": { x: 325, y: 125 },
  "side-right": { x: 235, y: 110 },
  roof: { x: 175, y: 55 },
  interior: { x: 200, y: 85 },
};

const COMMON_ANCHORS_LR3Q: Record<string, ViewAnchorPosition> = {
  // Zone codes
  "10": { x: 210, y: 75 },
  "11": { x: 200, y: 105 },
  "12": { x: 195, y: 135 },
  "16": { x: 190, y: 55 },
  "17": { x: 180, y: 85 },
  "19": { x: 125, y: 85 },
  "20": { x: 115, y: 115 },
  "21": { x: 100, y: 145 },
  "22": { x: 150, y: 80 },
  "23": { x: 145, y: 105 },
  "24": { x: 140, y: 135 },
  "25": { x: 115, y: 80 },
  "26": { x: 100, y: 110 },
  "27": { x: 90, y: 140 },
  // General & Glass flags
  rear: { x: 100, y: 110 },
  "rear-left": { x: 115, y: 115 },
  "rear-right": { x: 145, y: 105 },
  "side-left": { x: 200, y: 105 },
  roof: { x: 190, y: 55 },
  interior: { x: 180, y: 85 },
};

const COMMON_ANCHORS_UNDERBODY: Record<string, ViewAnchorPosition> = {
  "18": { x: 200, y: 100 },
  underbody: { x: 200, y: 100 },
};

export const VEHICLE_TEMPLATES: Record<VehicleBodyType, VehicleTemplateDefinition> = {
  "passenger-sedan": {
    bodyType: "passenger-sedan",
    labelPl: "Sedan / Limuzyna",
    isGeneric: false,
    anchors: {
      "right-front-3q": COMMON_ANCHORS_RF3Q,
      "left-rear-3q": COMMON_ANCHORS_LR3Q,
      "underbody-bottom": COMMON_ANCHORS_UNDERBODY,
    },
  },
  "passenger-suv": {
    bodyType: "passenger-suv",
    labelPl: "SUV / Crossover",
    isGeneric: false,
    anchors: {
      "right-front-3q": COMMON_ANCHORS_RF3Q,
      "left-rear-3q": COMMON_ANCHORS_LR3Q,
      "underbody-bottom": COMMON_ANCHORS_UNDERBODY,
    },
  },
  "passenger-hatchback": {
    bodyType: "passenger-hatchback",
    labelPl: "Hatchback",
    isGeneric: false,
    anchors: {
      "right-front-3q": COMMON_ANCHORS_RF3Q,
      "left-rear-3q": COMMON_ANCHORS_LR3Q,
      "underbody-bottom": COMMON_ANCHORS_UNDERBODY,
    },
  },
  "passenger-wagon": {
    bodyType: "passenger-wagon",
    labelPl: "Kombi",
    isGeneric: false,
    anchors: {
      "right-front-3q": COMMON_ANCHORS_RF3Q,
      "left-rear-3q": COMMON_ANCHORS_LR3Q,
      "underbody-bottom": COMMON_ANCHORS_UNDERBODY,
    },
  },
  "generic-passenger": {
    bodyType: "generic-passenger",
    labelPl: "Pojazd osobowy (makieta poglądowa)",
    isGeneric: true,
    anchors: {
      "right-front-3q": COMMON_ANCHORS_RF3Q,
      "left-rear-3q": COMMON_ANCHORS_LR3Q,
      "underbody-bottom": COMMON_ANCHORS_UNDERBODY,
    },
  },
};

/**
  Match vehicle body type from make / model / variant text.
  Fallback to 'generic-passenger'.
 */
export function resolveVehicleTemplate(makeModelStr?: string): VehicleTemplateDefinition {
  if (!makeModelStr) return VEHICLE_TEMPLATES["generic-passenger"];

  const text = makeModelStr.toLowerCase();

  if (text.includes("suv") || text.includes("vitara") || text.includes("tucson") || text.includes("qashqai") || text.includes("tiguan") || text.includes("x5") || text.includes("rav4")) {
    return VEHICLE_TEMPLATES["passenger-suv"];
  }

  if (text.includes("kombi") || text.includes("estate") || text.includes("touring") || text.includes("variant") || text.includes("avant") || text.includes("wagon")) {
    return VEHICLE_TEMPLATES["passenger-wagon"];
  }

  if (text.includes("hatchback") || text.includes("golf") || text.includes("yaris") || text.includes("corsa") || text.includes("clio") || text.includes("i20")) {
    return VEHICLE_TEMPLATES["passenger-hatchback"];
  }

  if (text.includes("sedan") || text.includes("arteon") || text.includes("passat") || text.includes("superb") || text.includes("seria 3") || text.includes("seria 5") || text.includes("klasa c") || text.includes("klasa e")) {
    return VEHICLE_TEMPLATES["passenger-sedan"];
  }

  return VEHICLE_TEMPLATES["generic-passenger"];
}
