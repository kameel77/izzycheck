import assert from "node:assert";
import { test, describe, beforeEach, afterEach } from "node:test";
import { executeReportModule, ModuleExecutionError, isModuleLockStale, STALE_LOCK_MS } from "../module-executor.ts";

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
      async () => executeReportModule("rep-dep-1", "CLAIM_DETAILS", { customPrisma: mockPrisma, internal: true }),
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

    const res = await executeReportModule("rep-nodata-1", "CLAIM_DETAILS", { customPrisma: mockPrisma, internal: true });
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
      async () => executeReportModule("rep-lock-1", "VALUATION", { customPrisma: mockPrisma, internal: true }),
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
      async () => executeReportModule("rep-limit-1", "VALUATION", { customPrisma: mockPrisma, internal: true }),
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
      async () => executeReportModule("rep-nonret-1", "VALUATION", { customPrisma: mockPrisma, internal: true }),
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
      internal: true,
    });
    assert.strictEqual(res.success, true);
    assert.strictEqual(deletedClaims, true, "Must delete old claims on re-checking history");
    assert.strictEqual(detailsResetStatus, "PENDING", "Must reset dependent CLAIM_DETAILS to PENDING when history is found");
  });
  describe("Report ownership check (IDOR)", () => {
    function buildOwnershipPrisma(calls: { updateMany: number; update: number }) {
      return {
        report: {
          findUnique: async () => ({
            id: "rep-own-1",
            vin: "WBA3N51030KS15173",
            firstRegistrationDate: "2021-04-15",
            valuationDate: "2026-08-06",
            status: "PROCESSING",
            createdById: "owner-1",
            moduleResults: [
              { id: "m-val", moduleId: "VALUATION", status: "PENDING", retryCount: 0 },
            ],
            vehicleSnapshot: null,
            damageClaims: [],
          }),
          update: async () => ({ id: "rep-own-1" }),
        },
        reportModuleResult: {
          updateMany: async () => {
            calls.updateMany++;
            return { count: 1 };
          },
          update: async ({ where, data }: any) => {
            calls.update++;
            return { id: where.id, ...data };
          },
        },
        vehicleSnapshot: { upsert: async () => ({}) },
      };
    }

    const mockValAdapter = {
      evaluateVehicle: async () => ({
        ibsCode: "IBS1",
        make: "BMW",
        model: "3",
        variant: "320d",
        newPriceCv: 1,
        marketPriceCob: 1,
        technicalValueTh: 1,
        mileageUsed: 1,
        isAverageMileageUsed: false,
        standardEquipment: [],
        optionalEquipment: [],
      }),
    };

    test("OPERATOR on someone else's report gets 403 and no lock/update is performed", async () => {
      const calls = { updateMany: 0, update: 0 };
      await assert.rejects(
        async () =>
          executeReportModule("rep-own-1", "VALUATION", {
            customPrisma: buildOwnershipPrisma(calls),
            customValuationAdapter: mockValAdapter,
            userId: "intruder-1",
            role: "OPERATOR",
          }),
        (err: any) => {
          assert.ok(err instanceof ModuleExecutionError);
          assert.strictEqual(err.statusCode, 403);
          return true;
        }
      );
      assert.strictEqual(calls.updateMany, 0, "Must not take the lock");
      assert.strictEqual(calls.update, 0, "Must not update module results");
    });

    test("Fails closed with 403 when neither userId nor internal is provided", async () => {
      const calls = { updateMany: 0, update: 0 };
      await assert.rejects(
        async () =>
          executeReportModule("rep-own-1", "VALUATION", {
            customPrisma: buildOwnershipPrisma(calls),
            customValuationAdapter: mockValAdapter,
          }),
        (err: any) => {
          assert.ok(err instanceof ModuleExecutionError);
          assert.strictEqual(err.statusCode, 403);
          return true;
        }
      );
      assert.strictEqual(calls.updateMany, 0);
      assert.strictEqual(calls.update, 0);
    });

    test("ADMIN on someone else's report proceeds", async () => {
      const calls = { updateMany: 0, update: 0 };
      const res = await executeReportModule("rep-own-1", "VALUATION", {
        customPrisma: buildOwnershipPrisma(calls),
        customValuationAdapter: mockValAdapter,
        userId: "admin-1",
        role: "ADMIN",
      });
      assert.strictEqual(res.success, true);
      assert.strictEqual(calls.updateMany, 1);
    });

    test("Owner OPERATOR proceeds", async () => {
      const calls = { updateMany: 0, update: 0 };
      const res = await executeReportModule("rep-own-1", "VALUATION", {
        customPrisma: buildOwnershipPrisma(calls),
        customValuationAdapter: mockValAdapter,
        userId: "owner-1",
        role: "OPERATOR",
      });
      assert.strictEqual(res.success, true);
      assert.strictEqual(calls.updateMany, 1);
    });
  });

  describe("isModuleLockStale", () => {
    const now = Date.parse("2026-10-01T12:00:00.000Z");

    test("RUNNING module older than STALE_LOCK_MS is stale", () => {
      const updatedAt = new Date(now - STALE_LOCK_MS - 1000);
      assert.strictEqual(isModuleLockStale({ status: "RUNNING", updatedAt }, now), true);
    });

    test("RUNNING module younger than STALE_LOCK_MS is not stale", () => {
      const updatedAt = new Date(now - STALE_LOCK_MS + 1000);
      assert.strictEqual(isModuleLockStale({ status: "RUNNING", updatedAt }, now), false);
    });

    test("Non-RUNNING modules are never stale, even when old", () => {
      const updatedAt = new Date(now - STALE_LOCK_MS * 10);
      for (const status of ["PENDING", "FAILED", "SUCCEEDED", "NO_DATA", "NOT_REQUESTED"]) {
        assert.strictEqual(isModuleLockStale({ status, updatedAt }, now), false);
      }
    });

    test("Accepts ISO string updatedAt (JSON-serialised)", () => {
      const updatedAt = new Date(now - STALE_LOCK_MS - 5000).toISOString();
      assert.strictEqual(isModuleLockStale({ status: "RUNNING", updatedAt }, now), true);
    });
  });
});
