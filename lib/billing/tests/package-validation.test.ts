import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { parsePackageInput } from "../package-validation.ts";

const FULL = { name: "10 wycen", creditType: "VALUATION", credits: 10, priceNetGrosze: 20000, vatRate: 23 };

function err(body: unknown, partial: boolean) {
  const r = parsePackageInput(body, { partial });
  assert.equal(r.ok, false);
  return r.ok ? "" : r.error;
}

describe("parsePackageInput (full)", () => {
  test("valid input is accepted, name trimmed, optional fields defaulted", () => {
    assert.deepEqual(parsePackageInput({ ...FULL, name: "  10 wycen  " }, { partial: false }), {
      ok: true,
      value: { ...FULL, isActive: true, sortOrder: 0 },
    });
  });

  test("explicit isActive and sortOrder are kept", () => {
    assert.deepEqual(parsePackageInput({ ...FULL, isActive: false, sortOrder: -5 }, { partial: false }), {
      ok: true,
      value: { ...FULL, isActive: false, sortOrder: -5 },
    });
  });

  test("required fields must be present", () => {
    for (const key of ["name", "creditType", "credits", "priceNetGrosze"]) {
      const body: Record<string, unknown> = { ...FULL };
      delete body[key];
      assert.equal(parsePackageInput(body, { partial: false }).ok, false, key);
    }
  });

  test("vatRate defaults to 23 when missing", () => {
    const { vatRate: _vat, ...rest } = FULL;
    const r = parsePackageInput(rest, { partial: false });
    assert.ok(r.ok && r.value.vatRate === 23);
  });

  test("non-object bodies are rejected", () => {
    for (const body of [null, undefined, "x", 5, []]) {
      assert.equal(parsePackageInput(body, { partial: false }).ok, false);
    }
  });
});

describe("parsePackageInput field limits", () => {
  const cases: Array<[string, unknown[], unknown[], string]> = [
    ["name", ["abc", "a".repeat(80), "  abc  "], ["ab", "a".repeat(81), "  ab  ", 5, null], "Nazwa pakietu musi mieć od 3 do 80 znaków."],
    ["credits", [1, 10000], [0, 10001, 1.5, "5", NaN, null], "Liczba kredytów musi być liczbą całkowitą 1–10000."],
    [
      "priceNetGrosze",
      [1, 100000000],
      [0, 100000001, 1.5, "5", NaN, null],
      "Cena netto (w groszach) musi być liczbą całkowitą 1–100000000.",
    ],
    ["vatRate", [0, 100], [-1, 101, 23.5, "23", null], "Stawka VAT musi być liczbą całkowitą 0–100."],
    ["sortOrder", [-3, 0, 99], [1.5, "1", null], "Kolejność musi być liczbą całkowitą."],
    ["isActive", [true, false], ["true", 1, null], "Aktywność musi być wartością logiczną."],
  ];

  for (const [field, good, bad, message] of cases) {
    for (const value of good) {
      test(`${field}=${JSON.stringify(value)} is accepted`, () => {
        assert.equal(parsePackageInput({ ...FULL, [field]: value }, { partial: false }).ok, true);
      });
    }
    for (const value of bad) {
      test(`${field}=${String(value)} is rejected`, () => {
        assert.equal(err({ ...FULL, [field]: value }, false), message);
      });
    }
  }

  test("creditType must come from the enum", () => {
    for (const creditType of ["CLAIM_CHECK", "", 1, null]) {
      assert.equal(err({ ...FULL, creditType }, false), "Nieprawidłowy rodzaj kredytu.");
    }
    assert.equal(parsePackageInput({ ...FULL, creditType: "CLAIM_DETAILS" }, { partial: false }).ok, true);
  });
});

describe("parsePackageInput (partial)", () => {
  test("only provided fields are returned", () => {
    assert.deepEqual(parsePackageInput({ isActive: false }, { partial: true }), {
      ok: true,
      value: { isActive: false },
    });
    assert.deepEqual(parsePackageInput({ priceNetGrosze: 100, name: " Nowa nazwa " }, { partial: true }), {
      ok: true,
      value: { priceNetGrosze: 100, name: "Nowa nazwa" },
    });
  });

  test("provided fields are still validated", () => {
    assert.equal(err({ credits: 0 }, true), "Liczba kredytów musi być liczbą całkowitą 1–10000.");
    assert.equal(err({ creditType: "X" }, true), "Nieprawidłowy rodzaj kredytu.");
    assert.equal(err({ isActive: "yes" }, true), "Aktywność musi być wartością logiczną.");
  });

  test("an empty update is rejected", () => {
    assert.equal(err({}, true), "Brak pól do zmiany.");
    assert.equal(err({ unknown: 1 }, true), "Brak pól do zmiany.");
  });

  test("non-object bodies are rejected", () => {
    for (const body of [null, undefined, "x", 5, []]) {
      assert.equal(parsePackageInput(body, { partial: true }).ok, false);
    }
  });
});
