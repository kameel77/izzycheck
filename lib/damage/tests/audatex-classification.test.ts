import assert from "node:assert";
import { test, describe } from "node:test";
import {
  getPrimaryCategory,
  CATEGORY_DEFINITIONS,
  AUDATEX_ZONE_LABELS,
  AUDATEX_PART_GROUPS,
  classifyZoneCode,
  classifyGeneralFlag,
} from "../audatex-classification.ts";

describe("Audatex Classification Module", () => {
  test("Determines primary category with priority: UNDERBODY > GLASS_LIGHTING > MECHANICAL > BODY > OTHER", () => {
    assert.strictEqual(getPrimaryCategory(["BODY", "UNDERBODY"]), "UNDERBODY");
    assert.strictEqual(getPrimaryCategory(["BODY", "GLASS_LIGHTING"]), "GLASS_LIGHTING");
    assert.strictEqual(getPrimaryCategory(["BODY", "MECHANICAL"]), "MECHANICAL");
    assert.strictEqual(getPrimaryCategory(["BODY"]), "BODY");
    assert.strictEqual(getPrimaryCategory([]), "OTHER");
  });

  test("Classifies underbody zone 18 correctly", () => {
    assert.deepStrictEqual(classifyZoneCode("18"), ["UNDERBODY"]);
    assert.deepStrictEqual(classifyZoneCode("05"), ["BODY"]);
  });

  test("Classifies general flags correctly", () => {
    assert.deepStrictEqual(classifyGeneralFlag("underbody"), ["UNDERBODY"]);
    assert.deepStrictEqual(classifyGeneralFlag("mechanical"), ["MECHANICAL"]);
    assert.deepStrictEqual(classifyGeneralFlag("front-left"), ["BODY"]);
  });

  test("Maps Audatex zone codes 01-27 to Polish labels", () => {
    assert.strictEqual(AUDATEX_ZONE_LABELS["01"], "Przód lewy góra");
    assert.strictEqual(AUDATEX_ZONE_LABELS["18"], "Podwozie środek");
    assert.strictEqual(AUDATEX_ZONE_LABELS["27"], "Tył środek dół");
  });

  test("Maps Audatex part groups 001-015", () => {
    assert.strictEqual(AUDATEX_PART_GROUPS["004"].labelPl, "Elementy poszycia zewnętrznego nadwozia");
    assert.strictEqual(AUDATEX_PART_GROUPS["006"].subType, "lighting");
    assert.strictEqual(AUDATEX_PART_GROUPS["007"].subType, "glass");
  });
});
