import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { checkCreditsForNewReport } from "../report-guard.ts";

const ZERO = { VALUATION: 0, CLAIM_DETAILS: 0 };
const ONE = { VALUATION: 1, CLAIM_DETAILS: 1 };

describe("checkCreditsForNewReport", () => {
  test("non-prepaid organization is never blocked", () => {
    assert.deepEqual(
      checkCreditsForNewReport({ prepaid: false, balances: ZERO, includeValuation: true, includeClaimDetails: true }),
      { ok: true },
    );
  });

  test("blocks valuation without VALUATION credits", () => {
    assert.deepEqual(
      checkCreditsForNewReport({ prepaid: true, balances: ZERO, includeValuation: true, includeClaimDetails: false }),
      {
        ok: false,
        creditType: "VALUATION",
        message: "Brak kredytów na wycenę pojazdu. Dokup kredyty, aby zlecić ten raport.",
      },
    );
  });

  test("blocks claim details without CLAIM_DETAILS credits", () => {
    assert.deepEqual(
      checkCreditsForNewReport({
        prepaid: true,
        balances: { VALUATION: 5, CLAIM_DETAILS: 0 },
        includeValuation: false,
        includeClaimDetails: true,
      }),
      {
        ok: false,
        creditType: "CLAIM_DETAILS",
        message: "Brak kredytów na szczegóły szkód. Dokup kredyty, aby zlecić ten raport.",
      },
    );
  });

  test("claim check only is free even with zero balances", () => {
    assert.deepEqual(
      checkCreditsForNewReport({ prepaid: true, balances: ZERO, includeValuation: false, includeClaimDetails: false }),
      { ok: true },
    );
  });

  test("passes when every requested paid module has credits", () => {
    assert.deepEqual(
      checkCreditsForNewReport({ prepaid: true, balances: ONE, includeValuation: true, includeClaimDetails: true }),
      { ok: true },
    );
  });
});
