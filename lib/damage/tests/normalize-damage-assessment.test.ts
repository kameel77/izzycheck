import assert from "node:assert";
import { test, describe } from "node:test";
import {
  normalizeDamageAssessment,
  buildFallbackDamageAssessment,
} from "../normalize-damage-assessment.ts";

describe("Normalize Damage Assessment & Legacy Fallback", () => {
  test("Normalizes zone codes 01 (Front Left) to left-rear-3q and 05 (Front Right) to right-front-3q", () => {
    const res = normalizeDamageAssessment({
      damagePositionCodes: ["01", "05", "18"],
    });

    assert.strictEqual(res.markers.length, 3);

    const m01 = res.markers.find((m) => m.sourceCode === "01");
    assert.ok(m01);
    assert.strictEqual(m01.labelPl, "Strefa 01: Przód lewy góra");
    assert.deepStrictEqual(m01.viewAnchors, ["left-rear-3q"]);

    const m05 = res.markers.find((m) => m.sourceCode === "05");
    assert.ok(m05);
    assert.strictEqual(m05.labelPl, "Strefa 05: Przód prawy środek");
    assert.deepStrictEqual(m05.viewAnchors, ["right-front-3q"]);
  });

  test("Builds fallback damage assessment for historical reports with translated strings", () => {
    const rawZones = ["Przód prawy środek", "Podwozie środek", "Szyba przednia"];
    const rawParts = ["Elementy poszycia zewnętrznego nadwozia", "Układ hamulcowy"];

    const fallback = buildFallbackDamageAssessment(rawZones, rawParts);

    assert.ok(fallback.markers.length >= 4);

    const m05 = fallback.markers.find((m) => m.sourceCode === "05");
    assert.ok(m05);
    assert.deepStrictEqual(m05.viewAnchors, ["right-front-3q"]);

    const mGlass = fallback.markers.find((m) => m.sourceKind === "glass_flag");
    assert.ok(mGlass);
    assert.strictEqual(mGlass.primaryCategory, "GLASS_LIGHTING");

    const mPart004 = fallback.markers.find((m) => m.sourceCode === "004");
    assert.ok(mPart004);
    assert.strictEqual(mPart004.primaryCategory, "BODY");
  });
});
