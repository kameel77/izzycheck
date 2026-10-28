import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { CREDIT_TYPE_LABELS, LEDGER_TYPE_LABELS, formatCreditAmount } from "../labels.ts";

describe("formatCreditAmount", () => {
  test("zero is shown as free usage", () => {
    assert.equal(formatCreditAmount(0), "0 (bez opłaty)");
  });

  test("positive amounts get a plus sign", () => {
    assert.equal(formatCreditAmount(10), "+10");
  });

  test("negative amounts keep their minus sign", () => {
    assert.equal(formatCreditAmount(-1), "-1");
  });
});

describe("labels", () => {
  test("every ledger and credit type has a Polish label", () => {
    assert.deepEqual(LEDGER_TYPE_LABELS, { USAGE: "Zużycie", MANUAL_ADJUSTMENT: "Korekta", PURCHASE: "Zakup" });
    assert.deepEqual(CREDIT_TYPE_LABELS, { VALUATION: "Wycena", CLAIM_DETAILS: "Szczegóły szkód" });
  });
});
