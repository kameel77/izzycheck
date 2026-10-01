import assert from "node:assert";
import { test, describe } from "node:test";
import {
  getPrimaryCategory,
  CATEGORY_DEFINITIONS,
  AUDATEX_ZONE_LABELS,
  AUDATEX_PART_GROUPS,
  AUDATEX_ZONES,
  zoneHintCaption,
  normalizePartGroupCode,
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

  test("Zone table covers all 28 codes 00-27 with natural axis descriptions derived from the 3x3x3 grid", () => {
    assert.deepStrictEqual(
      Object.keys(AUDATEX_ZONES).sort(),
      Array.from({ length: 28 }, (_, i) => String(i).padStart(2, "0"))
    );
    assert.deepStrictEqual(AUDATEX_ZONES["00"], { titlePl: "Strefa nieokreślona" });

    // Blocks of three (top, middle, bottom): F-L, F-R, F-M, M-L, M-R, M-M, R-L, R-R, R-M
    const blocks = [
      ["Przód", "lewa strona"],
      ["Przód", "prawa strona"],
      ["Przód", "oś pojazdu"],
      ["Środek", "lewa strona"],
      ["Środek", "prawa strona"],
      ["Środek", "oś pojazdu"],
      ["Tył", "lewa strona"],
      ["Tył", "prawa strona"],
      ["Tył", "oś pojazdu"],
    ];
    const zWords = ["góra", "środek", "dół"];
    for (let n = 1; n <= 27; n++) {
      const [x, y] = blocks[Math.floor((n - 1) / 3)];
      const z = zWords[(n - 1) % 3];
      assert.strictEqual(AUDATEX_ZONES[String(n).padStart(2, "0")].titlePl, `${x}, ${y}, ${z}`, `zone ${n}`);
    }
    assert.strictEqual(AUDATEX_ZONES["22"].titlePl, "Tył, prawa strona, góra");
    assert.strictEqual(AUDATEX_ZONES["17"].titlePl, "Środek, oś pojazdu, środek");
    assert.strictEqual(AUDATEX_ZONES["18"].titlePl, "Środek, oś pojazdu, dół");
  });

  test("Zone hints match the approved orientation list and render as an 'okolice' caption", () => {
    const hints: Record<string, string> = {
      "01": "lewy słupek A",
      "02": "lewy reflektor, lewy błotnik przedni",
      "03": "lewa część zderzaka przedniego",
      "04": "prawy słupek A",
      "05": "prawy reflektor, prawy błotnik przedni",
      "06": "prawa część zderzaka przedniego",
      "07": "szyba przednia",
      "08": "atrapa chłodnicy, maska",
      "09": "dolna część zderzaka przedniego",
      "10": "lewa linia dachu, lewe szyby boczne",
      "11": "lewe drzwi",
      "12": "lewy próg",
      "13": "prawa linia dachu, prawe szyby boczne",
      "14": "prawe drzwi",
      "15": "prawy próg",
      "16": "dach",
      "17": "wnętrze kabiny",
      "18": "podwozie",
      "19": "lewy słupek C",
      "20": "lewy błotnik tylny, lewa lampa",
      "21": "lewa część zderzaka tylnego",
      "22": "prawy słupek C",
      "23": "prawy błotnik tylny, prawa lampa",
      "24": "prawa część zderzaka tylnego",
      "25": "szyba tylna",
      "26": "klapa bagażnika",
      "27": "dolna część zderzaka tylnego",
    };
    for (const [code, hint] of Object.entries(hints)) {
      assert.strictEqual(AUDATEX_ZONES[code].hintPl, hint, `hint ${code}`);
      assert.strictEqual(zoneHintCaption(code), `okolice: ${hint} (orientacyjnie)`);
    }
    assert.strictEqual(AUDATEX_ZONES["00"].hintPl, undefined);
    assert.strictEqual(zoneHintCaption("00"), undefined);
    assert.strictEqual(zoneHintCaption("99"), undefined);
    assert.strictEqual(zoneHintCaption("22"), "okolice: prawy słupek C (orientacyjnie)");
  });

  test("Part groups 001-015 use the Audatex spec names (010 does not exist)", () => {
    const names: Record<string, string> = {
      "001": "Systemy bezpieczeństwa biernego",
      "002": "Systemy bezpieczeństwa czynnego",
      "003": "Zawieszenie",
      "004": "Elementy poszycia zewnętrznego nadwozia",
      "005": "Elementy konstrukcyjne nadwozia",
      "006": "Oświetlenie zewnętrzne",
      "007": "Oszklenie",
      "008": "Układ hamulcowy",
      "009": "Układ chłodzenia i klimatyzacji",
      "011": "Tapicerka",
      "012": "Osprzęt silnika",
      "013": "Skrzynia biegów i układ napędowy",
      "014": "Układ kierowniczy",
      "015": "Instalacja elektryczna (pojazdy elektryczne i hybrydowe)",
    };
    assert.deepStrictEqual(Object.keys(AUDATEX_PART_GROUPS).sort(), Object.keys(names).sort());
    for (const [code, name] of Object.entries(names)) assert.strictEqual(AUDATEX_PART_GROUPS[code].labelPl, name);
  });

  test("Part group codes are padded to 3 digits", () => {
    assert.strictEqual(normalizePartGroupCode("4"), "004");
    assert.strictEqual(normalizePartGroupCode(" 4 "), "004");
    assert.strictEqual(normalizePartGroupCode("15"), "015");
    assert.strictEqual(normalizePartGroupCode("004"), "004");
    assert.strictEqual(normalizePartGroupCode("X1"), "X1");
  });

  test("Maps Audatex part groups 001-015", () => {
    assert.strictEqual(AUDATEX_PART_GROUPS["004"].labelPl, "Elementy poszycia zewnętrznego nadwozia");
    assert.strictEqual(AUDATEX_PART_GROUPS["006"].subType, "lighting");
    assert.strictEqual(AUDATEX_PART_GROUPS["007"].subType, "glass");
  });
});
