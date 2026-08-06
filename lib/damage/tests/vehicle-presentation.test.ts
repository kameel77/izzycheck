import assert from "node:assert";
import { test, describe } from "node:test";
import { resolveVehicleTemplate } from "../vehicle-templates.ts";
import { normalizeDamageAssessment } from "../normalize-damage-assessment.ts";
import { buildDamagePresentation } from "../build-damage-presentation.ts";

describe("Vehicle Templates & Presentation Builder Module", () => {
  test("Resolves vehicle template correctly by make/model text", () => {
    assert.strictEqual(resolveVehicleTemplate("Suzuki Vitara 1.4").bodyType, "passenger-suv");
    assert.strictEqual(resolveVehicleTemplate("Volkswagen Arteon 2.0 TSI").bodyType, "passenger-sedan");
    assert.strictEqual(resolveVehicleTemplate("Unknown Car XYZ").bodyType, "generic-passenger");
  });

  test("Builds damage presentation model with sequential markers and view visibility", () => {
    const assessment = normalizeDamageAssessment({
      damagePositionCodes: ["05", "20", "18"],
      significantPartGroupCodes: ["004"],
    });

    const model = buildDamagePresentation("claim-1", assessment, "Suzuki Vitara", "ALL");

    assert.strictEqual(model.totalMarkersCount, 4);
    assert.strictEqual(model.hasUnderbodyView, true);
    assert.strictEqual(model.hasLocators, true);

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
});
