import assert from "node:assert";
import { test, describe } from "node:test";
import { AudatexHistoryAdapter } from "../history.ts";
import { AudatexValuationAdapter } from "../valuation.ts";

process.env.AUDATEX_MOCK_MODE = "true";

describe("Audatex Integration Adapters", () => {
  const historyAdapter = new AudatexHistoryAdapter();
  const valuationAdapter = new AudatexValuationAdapter();

  test("Translates mandate codes correctly", () => {
    assert.strictEqual(historyAdapter.translateMandateCode("D1"), "Kolizja drogowa");
    assert.strictEqual(historyAdapter.translateMandateCode("RW"), "Aukcja AON – Szkoda całkowita");
    assert.strictEqual(historyAdapter.translateMandateCode("5J"), "Szkoda szyby – uderzenie kamieniem");
  });

  test("Translates significant parts groups correctly", () => {
    const res = historyAdapter.translateSignificantParts("001,008");
    assert.deepStrictEqual(res, [
      "Systemy bezpieczeństwa biernego (Airbag / Pasy)",
      "Układ hamulcowy",
    ]);
  });

  test("Parses positive mock valuation correctly", async () => {
    const val = await valuationAdapter.evaluateVehicle({
      vin: "WBA3N51030KS15173",
      dateOfFirstReg: "2021-04-15",
      mileage: 45200,
    });

    assert.strictEqual(val.ibsCode, "965392");
    assert.strictEqual(val.make, "BMW");
    assert.strictEqual(val.model, "Seria 4 Coupé F32");
    assert.strictEqual(val.newPriceCv, 208909.0);
    assert.strictEqual(val.marketPriceCob, 124500.0);
  });

  test("Parses claim history positive check", async () => {
    const res = await historyAdapter.checkClaimHistory({
      vin: "WBA3N51030KS15173",
    });

    assert.strictEqual(res.hasHistory, true);
    assert.strictEqual(res.isFullVin, true);
  });

  test("Parses claim details with multiple damage claims", async () => {
    const res = await historyAdapter.getClaimDetails({
      vin: "WBA3N51030KS15173",
    });

    assert.strictEqual(res.claims.length, 2);
    assert.strictEqual(res.claims[0].damageValue, 18450.0);
    assert.strictEqual(res.claims[1].isTotalLoss, true);
  });
});
