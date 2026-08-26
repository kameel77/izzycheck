import assert from "node:assert";
import { test, describe, beforeEach, afterEach } from "node:test";
import { executeReportModule, ModuleExecutionError } from "../module-executor.ts";

describe("Module Executor, Concurrency Lock & Server-Side Dependencies", () => {
  beforeEach(() => {
    globalThis.__mockRenderToBuffer = async () => Buffer.from("%PDF-1.4 MOCK BYTES");
  });

  afterEach(() => {
    globalThis.__mockRenderToBuffer = undefined;
  });

  test("Refuses CLAIM_DETAILS with 412 Precondition Failed when CLAIM_CHECK has not SUCCEEDED", async () => {
    const mockPrisma = {
      report: {
        findUnique: async () => ({
          id: "rep-dep-1",
          vin: "WBA3N51030KS15173",
          firstRegistrationDate: "2021-04-15",
          valuationDate: "2026-08-06",
          status: "PROCESSING",
          moduleResults: [
            { id: "m-check", moduleId: "CLAIM_CHECK", status: "FAILED" },
            { id: "m-details", moduleId: "CLAIM_DETAILS", status: "PENDING", retryCount: 0 },
          ],
          vehicleSnapshot: null,
          damageClaims: [],
        }),
      },
    };

    await assert.rejects(
      async () => executeReportModule("rep-dep-1", "CLAIM_DETAILS", { customPrisma: mockPrisma }),
      (err: any) => {
        assert.ok(err instanceof ModuleExecutionError);
        assert.strictEqual(err.statusCode, 412);
        assert.ok(err.message.includes("CLAIM_CHECK"));
        return true;
      }
    );
  });

  test("CLAIM_DETAILS completes directly as NO_DATA when CLAIM_CHECK is NO_DATA without calling API", async () => {
    let updatePayload: any = null;

    const mockPrisma = {
      report: {
        findUnique: async () => ({
          id: "rep-nodata-1",
          vin: "WBA3N51030KS15173",
          firstRegistrationDate: "2021-04-15",
          valuationDate: "2026-08-06",
          status: "PROCESSING",
          moduleResults: [
            { id: "m-check", moduleId: "CLAIM_CHECK", status: "NO_DATA" },
            { id: "m-details", moduleId: "CLAIM_DETAILS", status: "PENDING", retryCount: 0 },
          ],
          vehicleSnapshot: null,
          damageClaims: [],
        }),
        update: async () => ({ id: "rep-nodata-1", status: "COMPLETED" }),
      },
      reportModuleResult: {
        update: async ({ data }: any) => {
          updatePayload = data;
          return { id: "m-details", ...data };
        },
      },
    };

    const res = await executeReportModule("rep-nodata-1", "CLAIM_DETAILS", { customPrisma: mockPrisma });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.status, "NO_DATA");
    assert.strictEqual(res.skippedDueToNoHistory, true);
    assert.strictEqual(updatePayload.status, "NO_DATA");
  });

  test("Rejects concurrent execution with 409 Conflict when module is currently RUNNING", async () => {
    const mockPrisma = {
      report: {
        findUnique: async () => ({
          id: "rep-lock-1",
          vin: "WBA3N51030KS15173",
          firstRegistrationDate: "2021-04-15",
          valuationDate: "2026-08-06",
          status: "PROCESSING",
          moduleResults: [
            { id: "m-val", moduleId: "VALUATION", status: "PENDING", retryCount: 0 },
          ],
          vehicleSnapshot: null,
          damageClaims: [],
        }),
      },
      reportModuleResult: {
        updateMany: async () => ({ count: 0 }), // Lock failed
      },
    };

    await assert.rejects(
      async () => executeReportModule("rep-lock-1", "VALUATION", { customPrisma: mockPrisma }),
      (err: any) => {
        assert.ok(err instanceof ModuleExecutionError);
        assert.strictEqual(err.statusCode, 409);
        assert.ok(err.message.includes("przetwarzany"));
        return true;
      }
    );
  });

  test("Blocks retry with 422 when retryCount reaches limit of 3 retries", async () => {
    const mockPrisma = {
      report: {
        findUnique: async () => ({
          id: "rep-limit-1",
          vin: "WBA3N51030KS15173",
          firstRegistrationDate: "2021-04-15",
          valuationDate: "2026-08-06",
          status: "PARTIALLY_FAILED",
          moduleResults: [
            { id: "m-val", moduleId: "VALUATION", status: "FAILED", retryCount: 3, isNonRetryable: false },
          ],
          vehicleSnapshot: null,
          damageClaims: [],
        }),
      },
    };

    await assert.rejects(
      async () => executeReportModule("rep-limit-1", "VALUATION", { customPrisma: mockPrisma }),
      (err: any) => {
        assert.ok(err instanceof ModuleExecutionError);
        assert.strictEqual(err.statusCode, 422);
        assert.ok(err.message.includes("limit 3 ponowień"));
        return true;
      }
    );
  });

  test("Blocks retry with 422 when isNonRetryable is true (D-6 protection against double billing)", async () => {
    const mockPrisma = {
      report: {
        findUnique: async () => ({
          id: "rep-nonret-1",
          vin: "WBA3N51030KS15173",
          firstRegistrationDate: "2021-04-15",
          valuationDate: "2026-08-06",
          status: "PARTIALLY_FAILED",
          moduleResults: [
            { id: "m-val", moduleId: "VALUATION", status: "FAILED", retryCount: 1, isNonRetryable: true },
          ],
          vehicleSnapshot: null,
          damageClaims: [],
        }),
      },
    };

    await assert.rejects(
      async () => executeReportModule("rep-nonret-1", "VALUATION", { customPrisma: mockPrisma }),
      (err: any) => {
        assert.ok(err instanceof ModuleExecutionError);
        assert.strictEqual(err.statusCode, 422);
        assert.strictEqual(err.isNonRetryable, true);
        assert.ok(err.message.includes("nienaprawialny"));
        return true;
      }
    );
  });

  test("Cascade Invalidation: CLAIM_CHECK deletes old DamageClaim records and resets CLAIM_DETAILS to PENDING", async () => {
    let deletedClaims = false;
    let detailsResetStatus: string | null = null;

    const mockPrisma = {
      report: {
        findUnique: async () => ({
          id: "rep-casc-1",
          vin: "WBA3N51030KS15173",
          firstRegistrationDate: "2021-04-15",
          valuationDate: "2026-08-06",
          status: "PROCESSING",
          moduleResults: [
            { id: "m-check", moduleId: "CLAIM_CHECK", status: "FAILED", retryCount: 1, isNonRetryable: false },
            { id: "m-details", moduleId: "CLAIM_DETAILS", status: "FAILED", retryCount: 1, isNonRetryable: false },
          ],
          vehicleSnapshot: null,
          damageClaims: [{ id: "c1" }],
        }),
        update: async () => ({ id: "rep-casc-1" }),
      },
      reportModuleResult: {
        updateMany: async () => ({ count: 1 }),
        update: async ({ where, data }: any) => {
          if (where.id === "m-details") {
            detailsResetStatus = data.status;
          }
          return { id: where.id, ...data };
        },
      },
      damageClaim: {
        deleteMany: async () => {
          deletedClaims = true;
          return { count: 1 };
        },
      },
    };

    const mockHistAdapter = {
      checkClaimHistory: async () => ({
        hasHistory: true,
        photosStatus: "AVAILABLE",
        advice: "Wykryto zdarzenia szkodowe",
      }),
    };

    const res = await executeReportModule("rep-casc-1", "CLAIM_CHECK", {
      customPrisma: mockPrisma,
      customHistoryAdapter: mockHistAdapter,
    });
    assert.strictEqual(res.success, true);
    assert.strictEqual(deletedClaims, true, "Must delete old claims on re-checking history");
    assert.strictEqual(detailsResetStatus, "PENDING", "Must reset dependent CLAIM_DETAILS to PENDING when history is found");
  });
});
