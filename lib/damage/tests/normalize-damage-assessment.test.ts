import assert from "node:assert";
import { test, describe } from "node:test";
import { buildDamagePresentation } from "../build-damage-presentation.ts";
import { normalizeZoneCode } from "../audatex-classification.ts";
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
    assert.strictEqual(m01.labelPl, "Strefa 01: Przód, lewa strona, góra");
    assert.deepStrictEqual(m01.viewAnchors, ["left-rear-3q"]);

    const m05 = res.markers.find((m) => m.sourceCode === "05");
    assert.ok(m05);
    assert.strictEqual(m05.labelPl, "Strefa 05: Przód, prawa strona, środek");
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

    // Zone codes are present (05, 18), so the glass flag is text-only and gets no marker
    assert.strictEqual(fallback.glassFlags["front"], true);
    assert.ok(!fallback.markers.some((m) => m.sourceKind === "glass_flag"));

    const mPart004 = fallback.markers.find((m) => m.sourceCode === "004");
    assert.ok(mPart004);
    assert.strictEqual(mPart004.primaryCategory, "BODY");
  });

  test("Builds approximate flag markers for historical reports without any zone code", () => {
    const fallback = buildFallbackDamageAssessment(["Szyba przednia", "Przód"], []);

    const mGlass = fallback.markers.find((m) => m.sourceKind === "glass_flag");
    assert.ok(mGlass);
    assert.strictEqual(mGlass.primaryCategory, "GLASS_LIGHTING");
    assert.strictEqual(mGlass.anchorZone, "07");
    assert.strictEqual(mGlass.approximate, true);
    assert.deepStrictEqual(mGlass.viewAnchors, ["right-front-3q"]);

    const mFront = fallback.markers.find((m) => m.sourceKind === "general_flag");
    assert.ok(mFront);
    assert.strictEqual(mFront.anchorZone, "08");
  });

  test("Zone markers carry a prefix-free title and an orientation hint; zone 00 has no hint", () => {
    const res = normalizeDamageAssessment({ damagePositionCodes: ["22", "00"] });
    const m22 = res.markers.find((m) => m.sourceCode === "22");
    assert.ok(m22);
    assert.strictEqual(m22.titlePl, "Tył, prawa strona, góra");
    assert.strictEqual(m22.hintPl, "okolice: prawy słupek C (orientacyjnie)");
    const m00 = res.markers.find((m) => m.sourceCode === "00");
    assert.ok(m00);
    assert.strictEqual(m00.labelPl, "Strefa nieokreślona");
    assert.strictEqual(m00.titlePl, "Strefa nieokreślona");
    assert.strictEqual(m00.hintPl, undefined);
  });

  test("Unpadded part group code '4' is normalised to 004 and mapped to the Polish name", () => {
    const res = normalizeDamageAssessment({ significantPartGroupCodes: ["4", "007", "004"] });
    const groups = res.markers.filter((m) => m.sourceKind === "group");
    assert.deepStrictEqual(
      groups.map((m) => [m.sourceCode, m.labelPl]),
      [
        ["004", "Elementy poszycia zewnętrznego nadwozia"],
        ["007", "Oszklenie"],
      ],
      "'4' and '004' are the same group (one marker)"
    );
    assert.deepStrictEqual(res.significantPartGroupCodes, ["004", "007", "004"]);
  });

  test("Legacy stored group labels still map back to their codes after the rename", () => {
    const legacy = [
      ["Systemy bezpieczeństwa czynnego (ABS / ESP)", "002"],
      ["Systemy bezpieczeństwa biernego (Airbag / Pasy)", "001"],
      ["Układ zawieszenia i jezdny", "003"],
      ["Konstrukcja nośna nadwozia / rama", "005"],
      ["Tapicerka i wykończenie wnętrza", "011"],
      ["Skrzynia biegów i układ przeniesienia napędu", "013"],
      ["Układ elektryczny / wysokie napięcie (EV / Hybrid)", "015"],
      ["Oszklenie nadwozia", "007"],
    ] as const;
    const fb = buildFallbackDamageAssessment([], legacy.map(([label]) => label));
    assert.deepStrictEqual(fb.significantPartGroupCodes, legacy.map(([, code]) => code));
  });

  test("A lone zone code stored unpadded ('5', parsed as a number from XML) becomes zone 05 on photo 1", () => {
    const res = normalizeDamageAssessment({ damagePositionCodes: ["5"], generalFlags: { rear: true } });
    assert.strictEqual(res.markers.length, 1, "no flag fallback markers: the zone code counts");
    assert.strictEqual(res.markers[0].sourceCode, "05");
    assert.strictEqual(res.markers[0].labelPl, "Strefa 05: Przód, prawa strona, środek");
    assert.deepStrictEqual(res.markers[0].viewAnchors, ["right-front-3q"]);
    assert.deepStrictEqual(res.damagePositionCodes, ["05"]);

    const presentation = buildDamagePresentation("c", res, "", "ALL", "Sedan");
    assert.strictEqual(presentation.markers[0].view, "rf3q");
    assert.ok(presentation.markers[0].rf3qAnchor);

    // "0" is the undefined zone, two-digit codes are untouched
    assert.strictEqual(normalizeDamageAssessment({ damagePositionCodes: ["0"] }).markers[0].sourceCode, "00");
    assert.strictEqual(normalizeDamageAssessment({ damagePositionCodes: ["27"] }).markers[0].sourceCode, "27");
    assert.strictEqual(normalizeZoneCode(" 7 "), "07");
  });
});
