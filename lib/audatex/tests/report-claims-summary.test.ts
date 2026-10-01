import assert from "node:assert";
import { test } from "node:test";
import { getClaimsHistoryPresentation } from "../../report-claims-summary.ts";

test("reports detected history when hasHistory succeeded but details were not requested", () => {
  assert.strictEqual(
    getClaimsHistoryPresentation({
      claimCount: 0,
      claimCheckStatus: "SUCCEEDED",
      claimDetailsStatus: undefined,
    }),
    "HISTORY_DETECTED_DETAILS_NOT_REQUESTED",
  );
});

test("reports detected history when hasHistory succeeded and details module is NOT_REQUESTED", () => {
  assert.strictEqual(
    getClaimsHistoryPresentation({
      claimCount: 0,
      claimCheckStatus: "SUCCEEDED",
      claimDetailsStatus: "NOT_REQUESTED",
    }),
    "HISTORY_DETECTED_DETAILS_NOT_REQUESTED",
  );
});

test("reports details unavailable when hasHistory succeeded but details module FAILED", () => {
  assert.strictEqual(
    getClaimsHistoryPresentation({
      claimCount: 0,
      claimCheckStatus: "SUCCEEDED",
      claimDetailsStatus: "FAILED",
    }),
    "HISTORY_DETECTED_DETAILS_UNAVAILABLE",
  );
});

test("reports details unavailable when hasHistory succeeded and details SUCCEEDED with 0 claims", () => {
  assert.strictEqual(
    getClaimsHistoryPresentation({
      claimCount: 0,
      claimCheckStatus: "SUCCEEDED",
      claimDetailsStatus: "SUCCEEDED",
    }),
    "HISTORY_DETECTED_DETAILS_UNAVAILABLE",
  );
});

test("reports no history when hasHistory returned no data", () => {
  assert.strictEqual(
    getClaimsHistoryPresentation({
      claimCount: 0,
      claimCheckStatus: "NO_DATA",
      claimDetailsStatus: "NO_DATA",
    }),
    "NO_HISTORY",
  );
});
