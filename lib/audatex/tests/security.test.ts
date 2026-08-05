import assert from "node:assert";
import { test, describe } from "node:test";
import { AudatexValuationAdapter } from "../valuation.ts";
import { AudatexHistoryAdapter } from "../history.ts";
import { NonRetryableError } from "../types.ts";
import { computeRequestHash } from "../hash.ts";

process.env.AUDATEX_MOCK_MODE = "true";
process.env.JWT_SECRET = "test-jwt-secret-key-123456789";

describe("Production Security & Resilience Tests", () => {
  test("NonRetryableError is immediately re-thrown without retrying", async () => {
    const valuationAdapter = new AudatexValuationAdapter();

    // Mock fetch that returns a 401 Unauthorized
    let callCount = 0;
    const originalFetch = global.fetch;
    global.fetch = (async () => {
      callCount++;
      return {
        ok: false,
        status: 401,
        text: async () => "<SOAP-ENV:Envelope><faultstring>Not Authorized</faultstring></SOAP-ENV:Envelope>",
      } as Response;
    }) as typeof fetch;

    try {
      await valuationAdapter.postSoapWithRetry("https://example.com/soap", "<xml/>", "SOAPAction");
      assert.fail("Should have thrown NonRetryableError");
    } catch (err: any) {
      assert.strictEqual(err instanceof NonRetryableError, true);
      assert.strictEqual(err.isNonRetryable, true);
      // CALL COUNT MUST BE DEDICATED TO 1 (NO RETRY FOR 401!)
      assert.strictEqual(callCount, 1, "401 Unauthorized must NOT be retried");
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("Computes request hashes correctly for idempotency deduplication", () => {
    const payload1 = {
      vin: "WBA3N51030KS15173",
      firstRegistrationDate: "2021-04-15",
      mileage: 45200,
      valuationDate: "2026-08-05",
      modules: { includeValuation: true, includeClaimCheck: true },
    };

    const payload2 = {
      vin: "WBA3N51030KS15173",
      firstRegistrationDate: "2021-04-15",
      mileage: 45200,
      valuationDate: "2026-08-05",
      modules: { includeValuation: true, includeClaimCheck: true },
    };

    const payloadDifferentModule = {
      vin: "WBA3N51030KS15173",
      firstRegistrationDate: "2021-04-15",
      mileage: 45200,
      valuationDate: "2026-08-05",
      modules: { includeValuation: true, includeClaimCheck: true, includeClaimDetails: true }, // Added details!
    };

    const hash1 = computeRequestHash(payload1);
    const hash2 = computeRequestHash(payload2);
    const hashDiff = computeRequestHash(payloadDifferentModule);

    assert.strictEqual(hash1, hash2, "Identical requests must yield identical hashes");
    assert.notStrictEqual(hash1, hashDiff, "Different module selections MUST yield different hashes so they do not falsely deduplicate");
  });

  test("Negative claim check returns hasHistory: false for WVW vin", async () => {
    const historyAdapter = new AudatexHistoryAdapter();
    const res = await historyAdapter.checkClaimHistory({ vin: "WVWZZZ3CZWE123456" });

    assert.strictEqual(res.hasHistory, false);
    assert.strictEqual(res.photosStatus, "NO_PHOTOS");
  });
});
