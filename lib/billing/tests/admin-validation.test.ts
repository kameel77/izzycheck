import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { parseAdjustment } from "../admin-validation.ts";

const AMOUNT_ERROR = "Ilość musi być liczbą całkowitą różną od zera (maks. 100 000).";

describe("parseAdjustment", () => {
  test("valid input is accepted and the note is trimmed", () => {
    assert.deepEqual(parseAdjustment({ creditType: "VALUATION", amount: 10, note: "  Zakup pakietu  " }), {
      ok: true,
      value: { creditType: "VALUATION", amount: 10, note: "Zakup pakietu" },
    });
  });

  test("negative amount within limits is accepted", () => {
    assert.deepEqual(parseAdjustment({ creditType: "CLAIM_DETAILS", amount: -2, note: "Korekta błędu" }), {
      ok: true,
      value: { creditType: "CLAIM_DETAILS", amount: -2, note: "Korekta błędu" },
    });
  });

  test("the limit itself is accepted in both directions", () => {
    assert.equal(parseAdjustment({ creditType: "VALUATION", amount: 100000, note: "abc" }).ok, true);
    assert.equal(parseAdjustment({ creditType: "VALUATION", amount: -100000, note: "abc" }).ok, true);
  });

  for (const amount of [0, 1.5, 100001, -100001, "5", null, undefined, NaN]) {
    test(`amount ${String(amount)} is rejected`, () => {
      assert.deepEqual(parseAdjustment({ creditType: "VALUATION", amount, note: "Powód" }), {
        ok: false,
        error: AMOUNT_ERROR,
      });
    });
  }

  test("note shorter than 3 characters after trim is rejected", () => {
    assert.deepEqual(parseAdjustment({ creditType: "VALUATION", amount: 1, note: "  a " }), {
      ok: false,
      error: "Podaj powód korekty (min. 3 znaki).",
    });
  });

  test("missing or non-string note is rejected", () => {
    assert.equal(parseAdjustment({ creditType: "VALUATION", amount: 1 }).ok, false);
    assert.equal(parseAdjustment({ creditType: "VALUATION", amount: 1, note: 123 }).ok, false);
  });

  test("CLAIM_CHECK and unknown credit types are rejected", () => {
    for (const creditType of ["CLAIM_CHECK", "", undefined, 1]) {
      assert.deepEqual(parseAdjustment({ creditType, amount: 1, note: "Powód" }), {
        ok: false,
        error: "Nieprawidłowy rodzaj kredytu.",
      });
    }
  });

  test("non-object bodies are rejected", () => {
    for (const body of [null, undefined, "x", 5, []]) {
      assert.equal(parseAdjustment(body).ok, false);
    }
  });
});
