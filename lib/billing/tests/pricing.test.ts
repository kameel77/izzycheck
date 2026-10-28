import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { priceCart, priceLine } from "../pricing.ts";

const CLAIM_10 = {
  id: "p-claim-10",
  name: "10 szkód",
  creditType: "CLAIM_DETAILS" as const,
  credits: 10,
  priceNetGrosze: 42000,
  vatRate: 23,
  isActive: true,
};
const VAL_1 = {
  id: "p-val-1",
  name: "1 wycena",
  creditType: "VALUATION" as const,
  credits: 1,
  priceNetGrosze: 2500,
  vatRate: 23,
  isActive: true,
};
const INACTIVE = { ...VAL_1, id: "p-off", isActive: false };

function unitFor(unitNet: number) {
  return priceLine({ ...VAL_1, priceNetGrosze: unitNet }, 1);
}

describe("priceLine", () => {
  test("package of 10 claims, quantity 1", () => {
    assert.deepEqual(priceLine(CLAIM_10, 1), {
      packageId: "p-claim-10",
      packageName: "10 szkód",
      creditType: "CLAIM_DETAILS",
      creditsPerPackage: 10,
      quantity: 1,
      unitNetGrosze: 42000,
      unitGrossGrosze: 51660,
      vatRate: 23,
      lineNetGrosze: 42000,
      lineVatGrosze: 9660,
      lineGrossGrosze: 51660,
    });
  });

  test("single valuation, quantity 3", () => {
    const line = priceLine(VAL_1, 3);
    assert.equal(line.unitGrossGrosze, 3075);
    assert.equal(line.lineNetGrosze, 7500);
    assert.equal(line.lineGrossGrosze, 9225);
    assert.equal(line.lineVatGrosze, 1725);
  });

  test("VAT per unit is rounded half up", () => {
    assert.equal(unitFor(101).unitGrossGrosze - 101, 23); // 23.23
    assert.equal(unitFor(102).unitGrossGrosze - 102, 23); // 23.46
    assert.equal(unitFor(2).unitGrossGrosze - 2, 0); // 0.46
    assert.equal(unitFor(3).unitGrossGrosze - 3, 1); // 0.69
    assert.equal(unitFor(50).unitGrossGrosze - 50, 12); // 11.5 -> 12
  });

  test("zero VAT rate leaves gross equal to net", () => {
    const line = priceLine({ ...VAL_1, vatRate: 0 }, 2);
    assert.equal(line.unitGrossGrosze, 2500);
    assert.equal(line.lineVatGrosze, 0);
  });

  test("line VAT is computed from per-unit rounding", () => {
    // unit net 3 -> unit VAT 1 -> x10 = 10, not round(30 * 23%) = 7
    assert.equal(priceLine({ ...VAL_1, priceNetGrosze: 3 }, 10).lineVatGrosze, 10);
  });
});

describe("priceCart", () => {
  test("totals equal the sum of line totals", () => {
    const result = priceCart(
      [CLAIM_10, VAL_1],
      [
        { packageId: "p-claim-10", quantity: 1 },
        { packageId: "p-val-1", quantity: 25 },
      ]
    );
    assert.ok(!("error" in result));
    assert.equal(result.lines.length, 2);
    assert.equal(result.totalNetGrosze, 42000 + 25 * 2500);
    assert.equal(result.totalGrossGrosze, 51660 + 25 * 3075);
    assert.equal(result.totalVatGrosze, result.totalGrossGrosze - result.totalNetGrosze);
    assert.equal(
      result.totalVatGrosze,
      result.lines.reduce((sum, l) => sum + l.lineVatGrosze, 0)
    );
  });

  test("duplicate packageIds are merged and quantities summed", () => {
    const result = priceCart(
      [VAL_1],
      [
        { packageId: "p-val-1", quantity: 2 },
        { packageId: "p-val-1", quantity: 3 },
      ]
    );
    assert.ok(!("error" in result));
    assert.equal(result.lines.length, 1);
    assert.equal(result.lines[0].quantity, 5);
    assert.equal(result.totalGrossGrosze, 5 * 3075);
  });

  test("merged quantity above 100 is rejected", () => {
    assert.deepEqual(
      priceCart(
        [VAL_1],
        [
          { packageId: "p-val-1", quantity: 60 },
          { packageId: "p-val-1", quantity: 60 },
        ]
      ),
      { error: "Nieprawidłowa ilość (1–100)." }
    );
  });

  test("merged quantity of exactly 100 is accepted", () => {
    const result = priceCart(
      [VAL_1],
      [
        { packageId: "p-val-1", quantity: 60 },
        { packageId: "p-val-1", quantity: 40 },
      ]
    );
    assert.ok(!("error" in result));
    assert.equal(result.lines[0].quantity, 100);
  });

  test("empty cart is rejected", () => {
    assert.deepEqual(priceCart([VAL_1], []), { error: "Koszyk jest pusty." });
  });

  test("more than 20 lines is rejected, exactly 20 is accepted", () => {
    const packages = Array.from({ length: 21 }, (_, i) => ({ ...VAL_1, id: `p${i}` }));
    const items = packages.map((p) => ({ packageId: p.id, quantity: 1 }));
    assert.deepEqual(priceCart(packages, items), { error: "Koszyk może mieć maks. 20 pozycji." });
    assert.ok(!("error" in priceCart(packages, items.slice(0, 20))));
  });

  test("quantity 0, 101, fractional and non-numeric are rejected", () => {
    for (const quantity of [0, 101, -1, 1.5, NaN, "2", null, undefined]) {
      assert.deepEqual(priceCart([VAL_1], [{ packageId: "p-val-1", quantity: quantity as number }]), {
        error: "Nieprawidłowa ilość (1–100).",
      });
    }
  });

  test("unknown and inactive packages are unavailable", () => {
    assert.deepEqual(priceCart([VAL_1], [{ packageId: "nope", quantity: 1 }]), {
      error: "Pakiet jest niedostępny.",
    });
    assert.deepEqual(priceCart([VAL_1, INACTIVE], [{ packageId: "p-off", quantity: 1 }]), {
      error: "Pakiet jest niedostępny.",
    });
  });
});
