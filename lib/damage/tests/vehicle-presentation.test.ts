import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { test, describe } from "node:test";
import { resolveVehicleTemplate, VEHICLE_TEMPLATES, VehicleBodyType } from "../vehicle-templates.ts";
import { normalizeDamageAssessment } from "../normalize-damage-assessment.ts";
import { buildDamagePresentation } from "../build-damage-presentation.ts";

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
        assert.ok(pos.x >= 0 && pos.x <= 400, `${bt} Underbody ${key} x out of bounds: ${pos.x}`);
        assert.ok(pos.y >= 0 && pos.y <= 200, `${bt} Underbody ${key} y out of bounds: ${pos.y}`);
      }
    }
  });

  test("Relational Invariants: RF3Q and LR3Q satisfy anatomic perspective order without inversions", () => {
    const bodyTypes: VehicleBodyType[] = [
      "passenger-sedan",
      "passenger-suv",
      "passenger-hatchback",
      "passenger-wagon",
    ];

    for (const bt of bodyTypes) {
      const t = VEHICLE_TEMPLATES[bt];
      const rf = t.anchors["right-front-3q"];
      const lr = t.anchors["left-rear-3q"];

      // 1. RF3Q Horizontal order (Right near < Center < Left far)
      assert.ok(rf["04"].x < rf["07"].x && rf["07"].x < rf["01"].x, `${bt} RF3Q top row X order: 04 < 07 < 01`);
      assert.ok(rf["05"].x < rf["08"].x && rf["08"].x < rf["02"].x, `${bt} RF3Q mid row X order: 05 < 08 < 02`);
      assert.ok(rf["06"].x < rf["09"].x && rf["09"].x < rf["03"].x, `${bt} RF3Q bot row X order: 06 < 09 < 03`);

      // 2. RF3Q Vertical order (Top < Middle < Bottom)
      assert.ok(rf["04"].y < rf["05"].y && rf["05"].y < rf["06"].y, `${bt} RF3Q right col Y order: 04 < 05 < 06`);
      assert.ok(rf["07"].y < rf["08"].y && rf["08"].y < rf["09"].y, `${bt} RF3Q center col Y order: 07 < 08 < 09`);
      assert.ok(rf["01"].y < rf["02"].y && rf["02"].y < rf["03"].y, `${bt} RF3Q left col Y order: 01 < 02 < 03`);

      // 3. RF3Q Right side vs Front (Side X < Front X)
      assert.ok(rf["14"].x < rf["04"].x, `${bt} RF3Q side door 14 must be to the left of front 04`);
      assert.ok(rf["13"].y < rf["14"].y && rf["14"].y < rf["15"].y, `${bt} RF3Q side col Y order: 13 < 14 < 15`);

      // 4. LR3Q Horizontal order (Left near < Center < Right far)
      assert.ok(lr["19"].x < lr["25"].x && lr["25"].x < lr["22"].x, `${bt} LR3Q top row X order: 19 < 25 < 22`);
      assert.ok(lr["20"].x < lr["26"].x && lr["26"].x < lr["23"].x, `${bt} LR3Q mid row X order: 20 < 26 < 23`);
      assert.ok(lr["21"].x < lr["27"].x && lr["27"].x < lr["24"].x, `${bt} LR3Q bot row X order: 21 < 27 < 24`);

      // 5. LR3Q Vertical order (Top < Middle < Bottom)
      assert.ok(lr["19"].y < lr["20"].y && lr["20"].y < lr["21"].y, `${bt} LR3Q left col Y order: 19 < 20 < 21`);
      assert.ok(lr["25"].y < lr["26"].y && lr["26"].y < lr["27"].y, `${bt} LR3Q center col Y order: 25 < 26 < 27`);
      assert.ok(lr["22"].y < lr["23"].y && lr["23"].y < lr["24"].y, `${bt} LR3Q right col Y order: 22 < 23 < 24`);

      // 6. LR3Q Left side vs Rear (Side X < Rear X)
      assert.ok(lr["11"].x < lr["19"].x, `${bt} LR3Q side door 11 must be to the left of rear 19`);
      assert.ok(lr["10"].y < lr["11"].y && lr["11"].y < lr["12"].y, `${bt} LR3Q side col Y order: 10 < 11 < 12`);
    }
  });

  test("Builds damage presentation model with sequential markers and view visibility", () => {
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
    assert.strictEqual(m05.viewVisibilityText, "Prawy przód");

    const m20 = model.markers.find((m) => m.sourceCode === "20");
    assert.ok(m20);
    assert.strictEqual(m20.markerIndex, 2);
    assert.strictEqual(m20.rf3qAnchor, undefined);
    assert.ok(m20.lr3qAnchor);
    assert.strictEqual(m20.viewVisibilityText, "Lewy tył");

    const mGroup = model.markers.find((m) => m.sourceCode === "004");
    assert.ok(mGroup);
    assert.strictEqual(mGroup.viewVisibilityText, "Brak lokalizacji na makiecie");
  });

  test("Filters presentation model by category", () => {
    const assessment = normalizeDamageAssessment({
      damagePositionCodes: ["05", "18"],
      glassFlags: { front: true },
    });

    const modelFiltered = buildDamagePresentation("claim-1", assessment, "Suzuki Vitara", "GLASS_LIGHTING");
    assert.strictEqual(modelFiltered.markers.length, 1);
    assert.strictEqual(modelFiltered.markers[0].primaryCategory, "GLASS_LIGHTING");
  });

  test("All Audatex damage position codes 01-27 resolve to a valid anchored view", () => {
    for (let i = 1; i <= 27; i++) {
      const code = String(i).padStart(2, "0");
      const assessment = normalizeDamageAssessment({ damagePositionCodes: [code] });
      const model = buildDamagePresentation("claim-test", assessment, "BMW 3", "ALL", "Sedan");
      const marker = model.markers.find((m) => m.sourceCode === code);
      assert.ok(marker, `Marker for zone ${code} should exist`);
      assert.notStrictEqual(
        marker.viewVisibilityText,
        "Brak lokalizacji na makiecie",
        `Zone ${code} must resolve to at least one valid view anchor`
      );
    }
  });
});
