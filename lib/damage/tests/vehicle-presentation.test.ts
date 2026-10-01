import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { test, describe } from "node:test";
import {
  resolveVehicleTemplate,
  VEHICLE_TEMPLATES,
  VehicleBodyType,
  UNDERBODY_VIEWBOX_W,
  UNDERBODY_VIEWBOX_H,
  UNDERBODY_IMAGE_PDF_JPG,
  UNDERBODY_IMAGE_WEBP,
} from "../vehicle-templates.ts";
import { normalizeDamageAssessment } from "../normalize-damage-assessment.ts";
import { buildDamagePresentation, PHOTO_1_CAPTION, PHOTO_2_CAPTION } from "../build-damage-presentation.ts";

describe("Vehicle Templates & Presentation Builder Module", () => {
  test("Resolves vehicle template with technicalSpec.bodyType priority over make/model text", () => {
    // 1. Priority: Audatex technicalSpec.bodyType
    assert.strictEqual(resolveVehicleTemplate("BMW Seria 3", "Kombi").bodyType, "passenger-wagon");
    assert.strictEqual(resolveVehicleTemplate("BMW Seria 3", "SUV").bodyType, "passenger-suv");
    assert.strictEqual(resolveVehicleTemplate("BMW Seria 3", "Hatchback").bodyType, "passenger-hatchback");
    assert.strictEqual(resolveVehicleTemplate("BMW Seria 3", "Limuzyna").bodyType, "passenger-sedan");
    assert.strictEqual(resolveVehicleTemplate("Volkswagen Arteon", "Coupé").bodyType, "passenger-sedan");

    // 2. Secondary heuristic: make/model text
    assert.strictEqual(resolveVehicleTemplate("Suzuki Vitara 1.4").bodyType, "passenger-suv");
    assert.strictEqual(resolveVehicleTemplate("Volkswagen Arteon 2.0 TSI").bodyType, "passenger-sedan");
    assert.strictEqual(resolveVehicleTemplate("Toyota Corolla Kombi").bodyType, "passenger-wagon");
    assert.strictEqual(resolveVehicleTemplate("Volkswagen Golf 1.5 TSI").bodyType, "passenger-hatchback");

    // 3. Fallback: generic-passenger (which uses sedan render)
    assert.strictEqual(resolveVehicleTemplate("Unknown Car XYZ").bodyType, "generic-passenger");
    assert.strictEqual(resolveVehicleTemplate("Unknown Car XYZ").assetPrefix, "sedan");
  });

  test("All vehicle templates have valid asset paths and physical files in public directory", () => {
    const bodyTypes: VehicleBodyType[] = [
      "passenger-sedan",
      "passenger-suv",
      "passenger-hatchback",
      "passenger-wagon",
      "generic-passenger",
    ];

    for (const bt of bodyTypes) {
      const template = VEHICLE_TEMPLATES[bt];
      assert.ok(template.assetFrontWebp.endsWith("-rf3q.webp"));
      assert.ok(template.assetBackWebp.endsWith("-lr3q.webp"));
      assert.ok(template.assetFrontPdfJpg.endsWith("-rf3q.jpg"));
      assert.ok(template.assetBackPdfJpg.endsWith("-lr3q.jpg"));

      // Verify physical existence of WebP and PDF JPEG in public/
      const webpFrontPath = path.join(process.cwd(), "public", template.assetFrontWebp.replace(/^\//, ""));
      const webpBackPath = path.join(process.cwd(), "public", template.assetBackWebp.replace(/^\//, ""));
      const pdfFrontPath = path.join(process.cwd(), "public", "vehicles", "pdf", template.assetFrontPdfJpg);
      const pdfBackPath = path.join(process.cwd(), "public", "vehicles", "pdf", template.assetBackPdfJpg);

      assert.ok(fs.existsSync(webpFrontPath), `WebP front not found: ${webpFrontPath}`);
      assert.ok(fs.existsSync(webpBackPath), `WebP back not found: ${webpBackPath}`);
      assert.ok(fs.existsSync(pdfFrontPath), `PDF front JPG not found: ${pdfFrontPath}`);
      assert.ok(fs.existsSync(pdfBackPath), `PDF back JPG not found: ${pdfBackPath}`);
    }
  });

  test("All anchors are strictly bounded within 0 <= x <= 400 and 0 <= y <= 200", () => {
    const bodyTypes: VehicleBodyType[] = [
      "passenger-sedan",
      "passenger-suv",
      "passenger-hatchback",
      "passenger-wagon",
      "generic-passenger",
    ];

    for (const bt of bodyTypes) {
      const template = VEHICLE_TEMPLATES[bt];

      // Check right front 3/4 anchors
      for (const [key, pos] of Object.entries(template.anchors["right-front-3q"])) {
        assert.ok(pos.x >= 0 && pos.x <= 400, `${bt} RF3Q ${key} x out of bounds: ${pos.x}`);
        assert.ok(pos.y >= 0 && pos.y <= 200, `${bt} RF3Q ${key} y out of bounds: ${pos.y}`);
      }

      // Check left rear 3/4 anchors
      for (const [key, pos] of Object.entries(template.anchors["left-rear-3q"])) {
        assert.ok(pos.x >= 0 && pos.x <= 400, `${bt} LR3Q ${key} x out of bounds: ${pos.x}`);
        assert.ok(pos.y >= 0 && pos.y <= 200, `${bt} LR3Q ${key} y out of bounds: ${pos.y}`);
      }

      // Check underbody anchors
      for (const [key, pos] of Object.entries(template.anchors["underbody-bottom"])) {
        assert.ok(pos.x >= 0 && pos.x <= UNDERBODY_VIEWBOX_W, `${bt} Underbody ${key} x out of bounds: ${pos.x}`);
        assert.ok(pos.y >= 0 && pos.y <= UNDERBODY_VIEWBOX_H, `${bt} Underbody ${key} y out of bounds: ${pos.y}`);
      }
    }
  });

  test("Relational Invariants: columns keep Top < Middle < Bottom order and side zones sit left of the corner zones", () => {
    const bodyTypes: VehicleBodyType[] = [
      "passenger-sedan",
      "passenger-suv",
      "passenger-hatchback",
      "passenger-wagon",
    ];

    // Z rule: Top = A/C-pillar / roofline height, Middle = half of the car height, Bottom = sills / lower bumpers.
    const rfColumns = [["04", "05", "06"], ["07", "08", "09"], ["13", "14", "15"], ["22", "23", "24"]];
    const lrColumns = [["01", "02", "03"], ["10", "11", "12"], ["19", "20", "21"], ["25", "26", "27"]];

    for (const bt of bodyTypes) {
      const t = VEHICLE_TEMPLATES[bt];
      const rf = t.anchors["right-front-3q"];
      const lr = t.anchors["left-rear-3q"];

      for (const [top, mid, bot] of rfColumns) {
        assert.ok(rf[top].y < rf[mid].y && rf[mid].y < rf[bot].y, `${bt} RF3Q column ${top}/${mid}/${bot} Y order`);
      }
      for (const [top, mid, bot] of lrColumns) {
        assert.ok(lr[top].y < lr[mid].y && lr[mid].y < lr[bot].y, `${bt} LR3Q column ${top}/${mid}/${bot} Y order`);
      }

      // Right side doors sit left of the front corner; left side doors sit left of the rear corner.
      assert.ok(rf["14"].x < rf["05"].x, `${bt} RF3Q side door 14 must be to the left of front 05`);
      assert.ok(lr["11"].x < lr["20"].x, `${bt} LR3Q side door 11 must be to the left of rear 20`);
    }
  });

  test("X-order invariants of the per-body anchor tables (all four body types)", () => {
    const bodyTypes: VehicleBodyType[] = ["passenger-sedan", "passenger-suv", "passenger-hatchback", "passenger-wagon"];
    // RF3Q (front + right side): per height row the right-side zones run rear -> middle (doors) -> front
    // (C-pillar/rear fender 22-24 < door/roof line 13-15 < front fender/A-pillar 04-06).
    const rfRows = [
      ["22", "13", "04"],
      ["23", "14", "05"],
      ["24", "15", "06"],
    ];
    // LR3Q (rear + left side): per height row the zones run from the front-left (far end) to the rear centre:
    // front-left < side (doors) < rear-left corner < rear centre.
    const lrRows = [
      ["01", "10", "19", "25"],
      ["02", "11", "20", "26"],
      ["03", "12", "21", "27"],
    ];
    const strictlyIncreasing = (xs: number[]) => xs.every((x, i) => i === 0 || xs[i - 1] < x);

    for (const bt of bodyTypes) {
      const t = VEHICLE_TEMPLATES[bt];
      const rf = t.anchors["right-front-3q"];
      const lr = t.anchors["left-rear-3q"];

      for (const row of rfRows) {
        assert.ok(strictlyIncreasing(row.map((z) => rf[z].x)), `${bt} RF3Q rear < middle < front for ${row.join("/")}`);
      }
      // the front centre (07-09) is right of the front-right corner (04-06) at the same height
      for (const [corner, centre] of [["04", "07"], ["05", "08"], ["06", "09"]]) {
        assert.ok(rf[corner].x < rf[centre].x, `${bt} RF3Q front centre ${centre} right of ${corner}`);
      }
      for (const row of lrRows) {
        assert.ok(strictlyIncreasing(row.map((z) => lr[z].x)), `${bt} LR3Q front-left < side < rear corner < rear centre for ${row.join("/")}`);
      }
    }
  });

  test("Builds damage presentation model with code-sorted rows and view visibility", () => {
    const assessment = normalizeDamageAssessment({
      damagePositionCodes: ["05", "20", "18"],
      significantPartGroupCodes: ["004"],
    });

    const model = buildDamagePresentation("claim-1", assessment, "Suzuki Vitara", "ALL", "SUV");

    assert.strictEqual(model.totalMarkersCount, 4);
    assert.strictEqual(model.hasUnderbodyView, true);
    assert.strictEqual(model.hasLocators, true);
    assert.strictEqual(model.template.bodyType, "passenger-suv");

    const m05 = model.markers.find((m) => m.sourceCode === "05");
    assert.ok(m05);
    assert.strictEqual(m05.markerIndex, 1);
    assert.ok(m05.rf3qAnchor);
    assert.strictEqual(m05.lr3qAnchor, undefined);
    assert.strictEqual(m05.view, "rf3q");

    const m20 = model.markers.find((m) => m.sourceCode === "20");
    assert.ok(m20);
    assert.strictEqual(m20.markerIndex, 3); // zones sorted by code: 05, 18, 20, then groups
    assert.strictEqual(m20.rf3qAnchor, undefined);
    assert.ok(m20.lr3qAnchor);
    assert.strictEqual(m20.view, "lr3q");

    const mGroup = model.markers.find((m) => m.sourceCode === "004");
    assert.ok(mGroup);
    assert.strictEqual(mGroup.view, "none");
  });

  test("Filters presentation model by category", () => {
    const assessment = normalizeDamageAssessment({
      damagePositionCodes: ["05", "18"],
      significantPartGroupCodes: ["007"],
    });

    const modelFiltered = buildDamagePresentation("claim-1", assessment, "Suzuki Vitara", "GLASS_LIGHTING");
    assert.strictEqual(modelFiltered.markers.length, 1);
    assert.strictEqual(modelFiltered.markers[0].primaryCategory, "GLASS_LIGHTING");
  });

  // ---------------------------------------------------------------------------
  // One photo per zone
  // ---------------------------------------------------------------------------
  const RF3Q_ZONES = ["04", "05", "06", "07", "08", "09", "13", "14", "15", "16", "22", "23", "24"];
  const LR3Q_ZONES = ["01", "02", "03", "10", "11", "12", "19", "20", "21", "25", "26", "27"];
  const ALL_BODY_TYPES: VehicleBodyType[] = [
    "passenger-sedan",
    "passenger-suv",
    "passenger-hatchback",
    "passenger-wagon",
    "generic-passenger",
  ];
  const BODY_TYPE_SPEC: Record<VehicleBodyType, string> = {
    "passenger-sedan": "Sedan",
    "passenger-suv": "SUV",
    "passenger-hatchback": "Hatchback",
    "passenger-wagon": "Kombi",
    "generic-passenger": "",
  };

  test("Every zone 01-16, 19-27 lives on exactly one photo per the rule; 17 and 18 are on none, for every body type", () => {
    for (const bt of ALL_BODY_TYPES) {
      const t = VEHICLE_TEMPLATES[bt];
      const rf = t.anchors["right-front-3q"];
      const lr = t.anchors["left-rear-3q"];

      assert.deepStrictEqual(Object.keys(rf).sort(), [...RF3Q_ZONES].sort(), `${bt} RF3Q anchor table`);
      assert.deepStrictEqual(Object.keys(lr).sort(), [...LR3Q_ZONES].sort(), `${bt} LR3Q anchor table`);
      assert.ok(!("17" in rf) && !("17" in lr), `${bt}: zone 17 must not be on a photo`);
      assert.ok(!("18" in rf) && !("18" in lr), `${bt}: zone 18 must not be on a photo`);

      for (let i = 1; i <= 27; i++) {
        const code = String(i).padStart(2, "0");
        const assessment = normalizeDamageAssessment({ damagePositionCodes: [code] });
        const model = buildDamagePresentation("claim-zone", assessment, "", "ALL", BODY_TYPE_SPEC[bt]);
        const marker = model.markers.find((m) => m.sourceCode === code);
        assert.ok(marker, `${bt}: marker for zone ${code} should exist`);

        if (RF3Q_ZONES.includes(code)) {
          assert.strictEqual(marker.view, "rf3q", `${bt} zone ${code}`);
          assert.ok(marker.rf3qAnchor && !marker.lr3qAnchor && !marker.underbodyAnchor, `${bt} zone ${code} only on rf3q`);
        } else if (LR3Q_ZONES.includes(code)) {
          assert.strictEqual(marker.view, "lr3q", `${bt} zone ${code}`);
          assert.ok(marker.lr3qAnchor && !marker.rf3qAnchor && !marker.underbodyAnchor, `${bt} zone ${code} only on lr3q`);
        } else if (code === "17") {
          assert.strictEqual(marker.view, "off-photo");
          assert.ok(!marker.rf3qAnchor && !marker.lr3qAnchor && !marker.underbodyAnchor);
          assert.strictEqual(model.hasOffPhotoMarkers, true);
          assert.strictEqual(model.hasUnderbodyView, false);
        } else {
          assert.strictEqual(code, "18");
          assert.strictEqual(marker.view, "underbody");
          assert.ok(marker.underbodyAnchor && !marker.rf3qAnchor && !marker.lr3qAnchor);
          assert.strictEqual(model.hasUnderbodyView, true);
        }
      }
    }
  });

  test("Generic passenger fallback uses the sedan anchors", () => {
    assert.deepStrictEqual(
      VEHICLE_TEMPLATES["generic-passenger"].anchors["right-front-3q"],
      VEHICLE_TEMPLATES["passenger-sedan"].anchors["right-front-3q"]
    );
    assert.deepStrictEqual(
      VEHICLE_TEMPLATES["generic-passenger"].anchors["left-rear-3q"],
      VEHICLE_TEMPLATES["passenger-sedan"].anchors["left-rear-3q"]
    );
  });

  test("Min distance between any two anchors in the same photo view is >= 28 viewBox units", () => {
    for (const bt of ALL_BODY_TYPES) {
      const t = VEHICLE_TEMPLATES[bt];
      for (const view of ["right-front-3q", "left-rear-3q"] as const) {
        const entries = Object.entries(t.anchors[view]);
        for (let i = 0; i < entries.length; i++) {
          for (let j = i + 1; j < entries.length; j++) {
            const [ka, a] = entries[i];
            const [kb, b] = entries[j];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            assert.ok(d >= 28, `${bt} ${view}: anchors ${ka} and ${kb} are only ${d.toFixed(1)} apart`);
          }
        }
      }
    }
  });

  test("Zone codes present: general and glass flags produce no markers and appear as a text line", () => {
    const assessment = normalizeDamageAssessment({
      damagePositionCodes: ["05", "20"],
      generalFlags: { front: true, "front-left": true, roof: true, mechanical: true },
      glassFlags: { front: true },
    });

    assert.deepStrictEqual(
      assessment.markers.map((m) => m.sourceKind),
      ["zone", "zone"]
    );

    const model = buildDamagePresentation("claim-flags", assessment, "", "ALL", "Sedan");
    assert.strictEqual(model.markers.length, 2);
    assert.ok(model.markers.every((m) => m.sourceKind === "zone"));
    assert.ok(model.markers.every((m) => !m.approximate));
    assert.strictEqual(
      model.flagsText,
      "Flagi ogólne Audatex: przód, przód lewy, dach, mechaniczne · Szyby: przednia"
    );
  });

  test("Flags text omits empty parts and is undefined without flags", () => {
    const onlyGlass = buildDamagePresentation(
      "c",
      normalizeDamageAssessment({ damagePositionCodes: ["05"], glassFlags: { rear: true } }),
      "",
      "ALL",
      "Sedan"
    );
    assert.strictEqual(onlyGlass.flagsText, "Szyby: tylna");

    const onlyGeneral = buildDamagePresentation(
      "c",
      normalizeDamageAssessment({ damagePositionCodes: ["05"], generalFlags: { "rear-right": true } }),
      "",
      "ALL",
      "Sedan"
    );
    assert.strictEqual(onlyGeneral.flagsText, "Flagi ogólne Audatex: tył prawy");

    const none = buildDamagePresentation(
      "c",
      normalizeDamageAssessment({ damagePositionCodes: ["05"] }),
      "",
      "ALL",
      "Sedan"
    );
    assert.strictEqual(none.flagsText, undefined);
  });

  test("No zone codes: flags become approximate markers, one per resulting zone", () => {
    const assessment = normalizeDamageAssessment({
      generalFlags: {
        front: true,
        "front-left": true,
        "front-right": true,
        rear: true,
        "rear-left": true,
        "rear-right": true,
        "side-left": true,
        "side-right": true,
        roof: true,
        interior: true,
        underbody: true,
        mechanical: true,
      },
      glassFlags: { front: true, rear: true, "side-left": true, "side-right": true, roof: true },
    });

    const model = buildDamagePresentation("claim-legacy", assessment, "", "ALL", "Sedan");
    const zoneByFlag = (kind: string, code: string) =>
      assessment.markers.find((m) => m.sourceKind === kind && m.sourceCode === code)?.anchorZone;

    assert.strictEqual(zoneByFlag("general_flag", "front"), "08");
    assert.strictEqual(zoneByFlag("general_flag", "front-left"), "02");
    assert.strictEqual(zoneByFlag("general_flag", "front-right"), "05");
    assert.strictEqual(zoneByFlag("general_flag", "rear"), "26");
    assert.strictEqual(zoneByFlag("general_flag", "rear-left"), "20");
    assert.strictEqual(zoneByFlag("general_flag", "rear-right"), "23");
    assert.strictEqual(zoneByFlag("general_flag", "side-left"), "11");
    assert.strictEqual(zoneByFlag("general_flag", "side-right"), "14");
    assert.strictEqual(zoneByFlag("general_flag", "roof"), "16");
    assert.strictEqual(zoneByFlag("general_flag", "interior"), "17");
    assert.strictEqual(zoneByFlag("general_flag", "underbody"), "18");
    assert.strictEqual(zoneByFlag("glass_flag", "front"), "07");
    assert.strictEqual(zoneByFlag("glass_flag", "rear"), "25");
    assert.strictEqual(zoneByFlag("glass_flag", "side-left"), "10");
    assert.strictEqual(zoneByFlag("glass_flag", "side-right"), "13");

    // mechanical -> no marker; glass roof is deduplicated with general roof (both -> 16)
    assert.ok(!assessment.markers.some((m) => m.sourceCode === "mechanical"));
    assert.ok(!assessment.markers.some((m) => m.sourceKind === "glass_flag" && m.sourceCode === "roof"));
    const zones = assessment.markers.map((m) => m.anchorZone);
    assert.strictEqual(new Set(zones).size, zones.length, "one marker per resulting zone");
    assert.strictEqual(model.markers.length, 15);

    for (const m of model.markers) {
      assert.ok(m.approximate, `${m.sourceCode} must be approximate`);
      assert.ok(m.hintPl?.endsWith("(przybliżona)"), `${m.sourceCode}: ${m.hintPl}`);
      assert.notStrictEqual(m.view, "none");
    }
    const front = model.markers.find((m) => m.sourceCode === "front" && m.sourceKind === "general_flag");
    assert.strictEqual(front?.view, "rf3q");
    assert.strictEqual(front?.hintPl, "(przybliżona)", "flags have no hint of their own");
    const interior = model.markers.find((m) => m.sourceCode === "interior");
    assert.strictEqual(interior?.view, "off-photo");
    assert.strictEqual(interior?.hintPl, "(przybliżona)");
    assert.strictEqual(model.hasOffPhotoMarkers, true);
    assert.strictEqual(model.hasUnderbodyView, true);
  });

  test("Zone 00 gives a table row 'Strefa nieokreślona' and no marker on any view", () => {
    const assessment = normalizeDamageAssessment({ damagePositionCodes: ["00", "05"] });
    const model = buildDamagePresentation("claim-00", assessment, "", "ALL", "Sedan");

    const m00 = model.markers.find((m) => m.sourceCode === "00");
    assert.ok(m00, "zone 00 keeps a table row");
    assert.strictEqual(m00.labelPl, "Strefa nieokreślona");
    assert.strictEqual(m00.view, "none");
    assert.ok(!m00.rf3qAnchor && !m00.lr3qAnchor && !m00.underbodyAnchor);
    assert.strictEqual(m00.hintPl, undefined);
    assert.strictEqual(model.hasOffPhotoMarkers, false);
    assert.strictEqual(model.hasUnderbodyView, false);
  });

  test("Significant part groups (001-015) never get anchors or a photo view", () => {
    const codes = Array.from({ length: 15 }, (_, i) => String(i + 1).padStart(3, "0"));
    const assessment = normalizeDamageAssessment({
      damagePositionCodes: ["05"],
      significantPartGroupCodes: codes,
    });
    const model = buildDamagePresentation("claim-groups", assessment, "", "ALL", "Sedan");

    const groups = model.markers.filter((m) => m.sourceKind === "group");
    assert.strictEqual(groups.length, 15);
    for (const g of groups) {
      assert.strictEqual(g.view, "none");
      assert.ok(!g.rf3qAnchor && !g.lr3qAnchor && !g.underbodyAnchor, `group ${g.sourceCode}`);
    }
  });

  test("Assessments stored with the old rules (flag markers, old view anchors) are re-derived with the current rules", () => {
    const stale = {
      generalFlags: { front: true },
      glassFlags: { front: true },
      damagePositionCodes: ["01"],
      significantPartGroupCodes: [],
      markers: [
        { id: "marker-zone-01", sourceKind: "zone", sourceCode: "01", labelPl: "x", categories: ["BODY"], primaryCategory: "BODY", viewAnchors: ["right-front-3q"], confidence: "zone" },
        { id: "marker-genflag-front", sourceKind: "general_flag", sourceCode: "front", labelPl: "x", categories: ["BODY"], primaryCategory: "BODY", viewAnchors: ["right-front-3q"], confidence: "general" },
      ],
    } as any;

    const model = buildDamagePresentation("claim-stale", stale, "", "ALL", "Sedan");
    assert.strictEqual(model.markers.length, 1);
    assert.strictEqual(model.markers[0].view, "lr3q");
    assert.ok(model.markers[0].lr3qAnchor && !model.markers[0].rf3qAnchor);
  });

  test("Zone list: zone 00 and part groups are not rows; rows by zone code ascending; legend counts only used categories", () => {
    const model = buildDamagePresentation(
      "c",
      normalizeDamageAssessment({
        damagePositionCodes: ["27", "05", "00", "18", "01", "17"],
        significantPartGroupCodes: ["008", "004", "001"],
      }),
      "",
      "ALL",
      "Sedan"
    );
    assert.deepStrictEqual(
      model.zoneList.map((m) => m.sourceCode),
      ["01", "05", "17", "18", "27"]
    );
    assert.deepStrictEqual(
      model.groupChips.map((m) => [m.sourceCode, m.titlePl]),
      [
        ["001", "Systemy bezpieczeństwa biernego"],
        ["004", "Elementy poszycia zewnętrznego nadwozia"],
        ["008", "Układ hamulcowy"],
      ]
    );
    assert.strictEqual(model.hasUndefinedZone, true);
    // BODY (zones, 004), UNDERBODY (18), MECHANICAL (001, 008); zone 00 (OTHER) is not listed so OTHER is absent
    assert.deepStrictEqual(model.legendCategories, ["UNDERBODY", "MECHANICAL", "BODY"]);
    assert.strictEqual(model.categoryCounts.OTHER, 0);

    const only00 = buildDamagePresentation("c", normalizeDamageAssessment({ damagePositionCodes: ["00"] }), "", "ALL", "Sedan");
    assert.strictEqual(only00.zoneList.length, 0);
    assert.strictEqual(only00.hasUndefinedZone, true);
    assert.deepStrictEqual(only00.legendCategories, []);

    const noUndefined = buildDamagePresentation("c", normalizeDamageAssessment({ damagePositionCodes: ["05"] }), "", "ALL", "Sedan");
    assert.strictEqual(noUndefined.hasUndefinedZone, false);
  });

  test("A part group with an unknown code is a chip in the OTHER category", () => {
    const model = buildDamagePresentation(
      "c",
      normalizeDamageAssessment({ damagePositionCodes: ["05"], significantPartGroupCodes: ["099"] }),
      "",
      "ALL",
      "Sedan"
    );
    assert.strictEqual(model.groupChips.length, 1);
    assert.deepStrictEqual(model.legendCategories, ["BODY", "OTHER"]);
  });

  test("Table rows: zones by code ascending, then part groups by code", () => {
    const model = buildDamagePresentation(
      "c",
      normalizeDamageAssessment({
        damagePositionCodes: ["27", "05", "00", "18", "01", "17"],
        significantPartGroupCodes: ["008", "004", "001"],
      }),
      "",
      "ALL",
      "Sedan"
    );
    assert.deepStrictEqual(
      model.markers.map((m) => m.sourceCode),
      ["00", "01", "05", "17", "18", "27", "001", "004", "008"]
    );
    assert.deepStrictEqual(
      model.markers.map((m) => m.markerIndex),
      [1, 2, 3, 4, 5, 6, 7, 8, 9]
    );
  });

  test("Underbody image: assets exist with the 2000:1116 aspect, viewBox matches, one shared anchor set", () => {
    const jpg = path.join(process.cwd(), "public", "vehicles", "pdf", UNDERBODY_IMAGE_PDF_JPG);
    const webp = path.join(process.cwd(), "public", UNDERBODY_IMAGE_WEBP.replace(/^\//, ""));
    assert.ok(fs.existsSync(jpg), `Underbody JPG not found: ${jpg}`);
    assert.ok(fs.existsSync(webp), `Underbody WebP not found: ${webp}`);
    assert.ok(Math.abs(UNDERBODY_VIEWBOX_W / UNDERBODY_VIEWBOX_H - 2000 / 1116) < 0.005);

    const reference = VEHICLE_TEMPLATES["passenger-sedan"].anchors["underbody-bottom"];
    assert.deepStrictEqual(reference["18"], { x: 200, y: 112 });
    assert.deepStrictEqual(reference["underbody"], { x: 200, y: 112 });
    for (const bt of ALL_BODY_TYPES) {
      assert.deepStrictEqual(VEHICLE_TEMPLATES[bt].anchors["underbody-bottom"], reference, bt);
    }
  });

  test("Legacy approximate markers get '(przybliżona)' in the caption", () => {
    const legacy = buildDamagePresentation(
      "c",
      normalizeDamageAssessment({ generalFlags: { "rear-left": true } }),
      "",
      "ALL",
      "Sedan"
    );
    assert.strictEqual(legacy.markers[0].view, "lr3q");
    assert.strictEqual(legacy.markers[0].hintPl, "(przybliżona)");
    assert.strictEqual(legacy.zoneList.length, 1);
  });

  test("Processed items expose prefix-free title and hint caption for the tables", () => {
    const model = buildDamagePresentation(
      "c",
      normalizeDamageAssessment({ damagePositionCodes: ["23", "00"], significantPartGroupCodes: ["4"] }),
      "",
      "ALL",
      "Sedan"
    );
    const m23 = model.markers.find((m) => m.sourceCode === "23");
    assert.strictEqual(m23?.titlePl, "Tył, prawa strona, środek");
    assert.strictEqual(m23?.hintPl, "okolice: prawy błotnik tylny, prawa lampa (orientacyjnie)");
    const group = model.markers.find((m) => m.sourceKind === "group");
    assert.strictEqual(group?.sourceCode, "004");
    assert.strictEqual(group?.titlePl, "Elementy poszycia zewnętrznego nadwozia");
    assert.strictEqual(group?.hintPl, undefined);
  });

  test("Photo captions", () => {
    assert.strictEqual(PHOTO_1_CAPTION, "Zdjęcie 1: przód i prawy bok");
    assert.strictEqual(PHOTO_2_CAPTION, "Zdjęcie 2: tył i lewy bok");
  });

  test("liftback / fastback / coupe / coupé / gran coupe resolve to the sedan template (not generic)", () => {
    for (const bt of ["liftback", "Liftback", "fastback", "coupe", "Coupé", "gran coupe", "Gran Coupé"]) {
      const t = resolveVehicleTemplate("BMW Seria 4 Gran Coupé Diesel F36 17-", bt);
      assert.strictEqual(t.bodyType, "passenger-sedan", bt);
      assert.strictEqual(t.isGeneric, false, bt);
    }
  });
});
