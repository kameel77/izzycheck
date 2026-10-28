import assert from "node:assert";
import { test, describe } from "node:test";
import { executeReportModule, ModuleExecutionError } from "../module-executor.ts";

describe("RBAC & Fine-Grained Permissions for Module Execution", () => {
  const baseReport = {
    id: "rep-rbac-1",
    vin: "WBA3N51030KS15173",
    firstRegistrationDate: "2021-04-15",
    valuationDate: "2026-08-06",
    status: "PROCESSING",
    createdById: "user-employee-1",
    organizationId: "org-alpha-1",
    moduleResults: [
      { id: "m-val", moduleId: "VALUATION", status: "PENDING", retryCount: 0, isNonRetryable: false },
      { id: "m-check", moduleId: "CLAIM_CHECK", status: "PENDING", retryCount: 0, isNonRetryable: false },
      { id: "m-details", moduleId: "CLAIM_DETAILS", status: "PENDING", retryCount: 0, isNonRetryable: false },
    ],
    vehicleSnapshot: null,
    damageClaims: [],
  };

  test("Refuses VALUATION when USER lacks canGenerateValuation permission", async () => {
    const mockPrisma = {
      report: { findUnique: async () => baseReport },
    };

    await assert.rejects(
      async () =>
        executeReportModule("rep-rbac-1", "VALUATION", {
          customPrisma: mockPrisma,
          userId: "user-employee-1",
          role: "USER",
          organizationId: "org-alpha-1",
          canGenerateValuation: false,
        }),
      (err: any) => {
        assert.ok(err instanceof ModuleExecutionError);
        assert.strictEqual(err.statusCode, 403);
        assert.ok(err.message.includes("wyceny"));
        return true;
      }
    );
  });

  test("Refuses CLAIM_DETAILS when USER lacks canGenerateClaimDetails permission", async () => {
    const mockPrisma = {
      report: { findUnique: async () => baseReport },
    };

    await assert.rejects(
      async () =>
        executeReportModule("rep-rbac-1", "CLAIM_DETAILS", {
          customPrisma: mockPrisma,
          userId: "user-employee-1",
          role: "USER",
          organizationId: "org-alpha-1",
          canGenerateClaimDetails: false,
        }),
      (err: any) => {
        assert.ok(err instanceof ModuleExecutionError);
        assert.strictEqual(err.statusCode, 403);
        assert.ok(err.message.includes("szczegółów szkód"));
        return true;
      }
    );
  });

  test("Allows CLAIM_CHECK when report includes VALUATION and user has canGenerateValuation", async () => {
    let mockUpdateCalled = false;
    const mockPrisma = {
      report: { findUnique: async () => baseReport },
      reportModuleResult: {
        updateMany: async () => ({ count: 1 }),
        update: async () => ({ id: "m-check", moduleId: "CLAIM_CHECK", status: "SUCCEEDED" }),
      },
      damageClaim: { deleteMany: async () => ({ count: 0 }) },
      auditEvent: { create: async () => ({ id: "audit-1" }) },
      $transaction: async (fn: any) => fn(mockPrisma),
    };

    const mockHistAdapter = {
      checkClaimHistory: async () => ({ hasHistory: false }),
    };

    const result = await executeReportModule("rep-rbac-1", "CLAIM_CHECK", {
      customPrisma: mockPrisma,
      customHistoryAdapter: mockHistAdapter,
      userId: "user-employee-1",
      role: "USER",
      organizationId: "org-alpha-1",
      canGenerateValuation: true,
      canGenerateClaimCheck: false, // user does not have standalone claim check, but has valuation
    });

    assert.ok(result);
    assert.strictEqual(result.status, "NO_DATA");
  });

  test("Allows organization MANAGER to execute/retry module on an employee's report within the same organization", async () => {
    const mockPrisma = {
      report: { findUnique: async () => baseReport },
      reportModuleResult: {
        updateMany: async () => ({ count: 1 }),
        update: async () => ({ id: "m-check", moduleId: "CLAIM_CHECK", status: "SUCCEEDED" }),
      },
      damageClaim: { deleteMany: async () => ({ count: 0 }) },
      auditEvent: { create: async () => ({ id: "audit-1" }) },
      $transaction: async (fn: any) => fn(mockPrisma),
    };

    const mockHistAdapter = {
      checkClaimHistory: async () => ({ hasHistory: true }),
    };

    // Manager has different userId ("manager-1") but same organizationId ("org-alpha-1")
    const result = await executeReportModule("rep-rbac-1", "CLAIM_CHECK", {
      customPrisma: mockPrisma,
      customHistoryAdapter: mockHistAdapter,
      userId: "manager-1",
      role: "MANAGER",
      organizationId: "org-alpha-1",
    });

    assert.ok(result);
    assert.strictEqual(result.status, "SUCCEEDED");
  });

  test("Blocks MANAGER from executing module on a report belonging to another organization (Anti-IDOR)", async () => {
    const mockPrisma = {
      report: { findUnique: async () => baseReport },
    };

    await assert.rejects(
      async () =>
        executeReportModule("rep-rbac-1", "CLAIM_CHECK", {
          customPrisma: mockPrisma,
          userId: "manager-other-org",
          role: "MANAGER",
          organizationId: "org-beta-999", // Different organization!
        }),
      (err: any) => {
        assert.ok(err instanceof ModuleExecutionError);
        assert.strictEqual(err.statusCode, 403);
        assert.ok(err.message.includes("Dostęp zabroniony"));
        return true;
      }
    );
  });
});
