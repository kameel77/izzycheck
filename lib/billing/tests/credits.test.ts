import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { creditTypeForModule, isPrepaid } from "../credits.ts";

describe("creditTypeForModule", () => {
  test("maps paid modules to their credit type", () => {
    assert.equal(creditTypeForModule("VALUATION"), "VALUATION");
    assert.equal(creditTypeForModule("CLAIM_DETAILS"), "CLAIM_DETAILS");
  });

  test("CLAIM_CHECK is free", () => {
    assert.equal(creditTypeForModule("CLAIM_CHECK"), null);
  });
});

describe("isPrepaid", () => {
  test("only an explicit PREPAID organization is prepaid", () => {
    assert.equal(isPrepaid(null), false);
    assert.equal(isPrepaid(undefined), false);
    assert.equal(isPrepaid({ billingMode: "UNLIMITED" }), false);
    assert.equal(isPrepaid({ billingMode: "PREPAID" }), true);
  });
});
