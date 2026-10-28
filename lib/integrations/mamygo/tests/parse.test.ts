import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseClassificationXml, parseVinXml } from "../parse.ts";
import { loadFixture } from "./fixtures.ts";

describe("parseVinXml", () => {
  test("czyta IbsCode i kody wyposażenia z VIN (kolejność zachowana)", () => {
    const parsed = parseVinXml(loadFixture("bmw-420d.vin.xml"));
    assert.equal(parsed?.ibsCode, "965894");
    assert.equal(parsed?.fittedEquipmentCodes.length, 18);
    assert.deepEqual(parsed?.fittedEquipmentCodes.slice(0, 3), ["K4B", "B1T", "K26"]);
  });

  test("pojedynczy kod wyposażenia to nadal tablica", () => {
    assert.deepEqual(parseVinXml(loadFixture("vw-id3.vin.xml"))?.fittedEquipmentCodes, ["J16"]);
  });

  test("fault Audatex (brak dopasowania) nie ma IbsCode", () => {
    assert.equal(parseVinXml(loadFixture("suzuki-not-found.vin.xml")), null);
  });
});

describe("parseClassificationXml", () => {
  test("zwraca wszystkie parametry bez filtrowania", () => {
    const { params } = parseClassificationXml(loadFixture("bmw-420d.cls.xml"));
    assert.equal(params.manufacturerName, "BMW");
    assert.equal(params.engineKW, "140");
    assert.equal(params.petrolConsumptionEHKcity, "5,2");
    assert.equal(params.tireFront, "225/50 R17");
    assert.equal(params["valves per cylinder"], "4");
    assert.equal(Object.keys(params).length > 100, true);
  });

  test("wartości zostają tekstem dokładnie jak w XML (bez parsowania liczb)", () => {
    const { params } = parseClassificationXml(loadFixture("bmw-420d.cls.xml"));
    assert.equal(params.productionBeginMonth, "03");
    assert.equal(params.KP_UNI, "0.015");
  });

  test("dzieli wyposażenie na Standard i Optional (bez pakietów)", () => {
    const bmw = parseClassificationXml(loadFixture("bmw-420d.cls.xml"));
    assert.equal(bmw.standard.length, 67);
    assert.equal(bmw.optional.length, 46);
    assert.deepEqual(bmw.standard[0], { code: "B01", name: "ABS" });
  });

  test("pusta odpowiedź daje puste struktury", () => {
    assert.deepEqual(parseClassificationXml("<soap:Envelope/>"), { params: {}, standard: [], optional: [] });
  });
});
