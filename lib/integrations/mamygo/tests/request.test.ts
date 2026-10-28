import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { validateVinRequest, vinForUsageLog } from "../request.ts";
import { syntheticVin } from "./fixtures.ts";

describe("validateVinRequest", () => {
  test("poprawny VIN jest normalizowany (trim + wielkie litery)", () => {
    const result = validateVinRequest({ vin: `  ${syntheticVin("k").toLowerCase()} ` });
    assert.deepEqual(result, { ok: true, vin: syntheticVin("K") });
  });

  test("country i language są opcjonalne; PL/pl (bez względu na wielkość liter) przechodzi", () => {
    assert.equal(validateVinRequest({ vin: syntheticVin(), country: "pl", language: "PL" }).ok, true);
    assert.equal(validateVinRequest({ vin: syntheticVin(), country: null, language: null }).ok, true);
  });

  test("inny country lub language to błąd", () => {
    assert.equal(validateVinRequest({ vin: syntheticVin(), country: "DE" }).ok, false);
    assert.equal(validateVinRequest({ vin: syntheticVin(), language: "en" }).ok, false);
    assert.equal(validateVinRequest({ vin: syntheticVin(), country: 1 }).ok, false);
  });

  test("zły VIN: długość, niedozwolone znaki I/O/Q, typ", () => {
    for (const vin of ["", "ZZZZZZZZZK000000", "ZZZZZZZZZK00000000", "ZZZZZZZZZK00000I0", "ZZZZZZZZZK00000O0", "ZZZZZZZZZK00000Q0", "ZZZZZZZZZK0000-00", 123, null]) {
      assert.equal(validateVinRequest({ vin }).ok, false, `VIN ${String(vin)} powinien być odrzucony`);
    }
    assert.equal(validateVinRequest({}).ok, false);
  });

  test("body, które nie jest obiektem JSON, jest odrzucane", () => {
    for (const body of [null, undefined, "x", 5, [], [{ vin: syntheticVin() }]]) {
      assert.equal(validateVinRequest(body).ok, false);
    }
  });
});

describe("vinForUsageLog", () => {
  test("obcina do 32 znaków i zwraca null dla braku tekstu", () => {
    assert.equal(vinForUsageLog({ vin: "a".repeat(50) }), "A".repeat(32));
    assert.equal(vinForUsageLog({ vin: "   " }), null);
    assert.equal(vinForUsageLog({ vin: 5 }), null);
    assert.equal(vinForUsageLog(null), null);
  });
});
