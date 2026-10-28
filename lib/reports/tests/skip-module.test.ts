import assert from "node:assert";
import { test, describe, beforeEach, afterEach } from "node:test";
import { skipReportModule } from "../skip-module.ts";
import { ModuleExecutionError } from "../module-executor.ts";

function makeReport(modules: any[], overrides: Record<string, unknown> = {}) {
  return {
    id: "rep-skip-1",
    vin: "WBA3N51030KS15173",
    firstRegistrationDate: "2021-04-15",
    valuationDate: "2026-08-06",
    status: "PROCESSING",
    createdById: "owner-1",
    organizationId: "org-1",
    moduleResults: modules,
    vehicleSnapshot: null,
    damageClaims: [],
    createdBy: { id: "owner-1", name: "Jan", email: "jan@izzy.pl" },
    ...overrides,
  };
}

const owner = { userId: "owner-1", role: "USER" as const, organizationId: "org-1" };

describe("skipReportModule", () => {
  beforeEach(() => {
    globalThis.__mockRenderToBuffer = async () => Buffer.from("%PDF-1.4 MOCK BYTES");
  });

  afterEach(() => {
    globalThis.__mockRenderToBuffer = undefined;
  });

  test("refuses to skip CLAIM_CHECK", async () => {
    const report = makeReport([{ id: "m-check", moduleId: "CLAIM_CHECK", status: "PENDING" }]);
    const mockPrisma = { report: { findUnique: async () => report } };

    await assert.rejects(
      skipReportModule("rep-skip-1", "CLAIM_CHECK", { customPrisma: mockPrisma, ...owner }),
      (err: any) => {
        assert.ok(err instanceof ModuleExecutionError);
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.message, "Tego modułu nie można pominąć.");
        return true;
      }
    );
  });

  test("refuses to skip a RUNNING module", async () => {
    const report = makeReport([{ id: "m-val", moduleId: "VALUATION", status: "RUNNING" }]);
    const mockPrisma = { report: { findUnique: async () => report } };

    await assert.rejects(
      skipReportModule("rep-skip-1", "VALUATION", { customPrisma: mockPrisma, ...owner }),
      (err: any) => {
        assert.ok(err instanceof ModuleExecutionError);
        assert.strictEqual(err.statusCode, 409);
        return true;
      }
    );
  });

  test("refuses a USER who does not own the report", async () => {
    const report = makeReport([{ id: "m-val", moduleId: "VALUATION", status: "PENDING" }]);
    const mockPrisma = { report: { findUnique: async () => report } };

    await assert.rejects(
      skipReportModule("rep-skip-1", "VALUATION", {
        customPrisma: mockPrisma,
        userId: "someone-else",
        role: "USER",
        organizationId: "org-1",
      }),
      (err: any) => {
        assert.ok(err instanceof ModuleExecutionError);
        assert.strictEqual(err.statusCode, 403);
        return true;
      }
    );
  });

  test("skips a PENDING VALUATION and finalizes the report", async () => {
    const modules: any[] = [
      { id: "m-check", moduleId: "CLAIM_CHECK", status: "SUCCEEDED" },
      { id: "m-val", moduleId: "VALUATION", status: "PENDING", errorMessage: null },
    ];
    const report: any = makeReport(modules);
    let moduleUpdate: any = null;
    let reportUpdate: any = null;

    const mockPrisma: any = {
      report: {
        findUnique: async () => report,
        update: async ({ data }: any) => {
          reportUpdate = data;
          return { ...report, ...data };
        },
      },
      reportModuleResult: {
        update: async (args: any) => {
          moduleUpdate = args;
          const mod = modules.find((m) => m.id === args.where.id);
          Object.assign(mod, args.data);
          return mod;
        },
      },
      // releaseCredit locks the hold row via $queryRaw; no hold -> nothing to release
      $queryRaw: async () => [],
      $transaction: async (fn: any) => fn(mockPrisma),
    };

    const res = await skipReportModule("rep-skip-1", "VALUATION", { customPrisma: mockPrisma, ...owner });

    assert.deepStrictEqual(res, { success: true, moduleId: "VALUATION" });
    assert.strictEqual(moduleUpdate.where.id, "m-val");
    assert.strictEqual(moduleUpdate.data.status, "NOT_REQUESTED");
    assert.strictEqual(moduleUpdate.data.errorMessage, null);
    assert.ok(reportUpdate, "report must be finalized");
    assert.strictEqual(reportUpdate.status, "COMPLETED");
  });
});
