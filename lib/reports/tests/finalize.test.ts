import assert from "node:assert";
import { test, describe, beforeEach, afterEach } from "node:test";
import { finalizeReport } from "../finalize.ts";

describe("Report Finalization & PDF Immutability Rules", () => {
  beforeEach(() => {
    globalThis.__mockRenderToBuffer = async () => Buffer.from("%PDF-1.4 MOCK FINALIZE BYTES");
  });

  afterEach(() => {
    globalThis.__mockRenderToBuffer = undefined;
  });

  test("Freezes pdfBytes into database ONLY when finalStatus is COMPLETED", async () => {
    let updatePayload: any = null;

    const mockPrisma = {
      report: {
        findUnique: async () => ({
          id: "rep-comp-1",
          vin: "WBA3N51030KS15173",
          firstRegistrationDate: "2021-04-15",
          valuationDate: "2026-08-06",
          status: "PROCESSING",
          createdAt: new Date().toISOString(),
          createdBy: { id: "u1", name: "Jan", email: "jan@izzy.pl" },
          vehicleSnapshot: null,
          moduleResults: [],
          damageClaims: [],
        }),
        update: async ({ data }: any) => {
          updatePayload = data;
          return { id: "rep-comp-1", ...data };
        },
      },
    };

    await finalizeReport("rep-comp-1", "COMPLETED", { customPrisma: mockPrisma });

    assert.ok(updatePayload);
    assert.strictEqual(updatePayload.status, "COMPLETED");
    assert.ok(updatePayload.pdfBytes);
    assert.strictEqual(updatePayload.pdfBytes.toString(), "%PDF-1.4 MOCK FINALIZE BYTES");
    assert.ok(updatePayload.pdfGeneratedAt);
    assert.ok(updatePayload.pdfGeneratorVersion);
  });

  test("Does NOT freeze pdfBytes when finalStatus is PARTIALLY_FAILED (renders on the fly)", async () => {
    let updatePayload: any = null;

    const mockPrisma = {
      report: {
        findUnique: async () => ({
          id: "rep-partial-1",
          status: "PROCESSING",
        }),
        update: async ({ data }: any) => {
          updatePayload = data;
          return { id: "rep-partial-1", ...data };
        },
      },
    };

    await finalizeReport("rep-partial-1", "PARTIALLY_FAILED", { customPrisma: mockPrisma });

    assert.ok(updatePayload);
    assert.strictEqual(updatePayload.status, "PARTIALLY_FAILED");
    assert.strictEqual(updatePayload.pdfBytes, undefined, "pdfBytes must not be frozen for PARTIALLY_FAILED without forceFreeze");
    assert.strictEqual(updatePayload.pdfGeneratedAt, undefined);
  });

  test("Freezes pdfBytes when finalStatus is PARTIALLY_FAILED and forceFreeze is true", async () => {
    let updatePayload: any = null;

    const mockPrisma = {
      report: {
        findUnique: async () => ({
          id: "rep-partial-freeze",
          vin: "WBA3N51030KS15173",
          firstRegistrationDate: "2021-04-15",
          valuationDate: "2026-08-06",
          status: "PARTIALLY_FAILED",
          createdAt: new Date().toISOString(),
          createdBy: { id: "u1", name: "Jan", email: "jan@izzy.pl" },
          vehicleSnapshot: null,
          moduleResults: [{ moduleId: "VALUATION", status: "FAILED" }],
          damageClaims: [],
        }),
        update: async ({ data }: any) => {
          updatePayload = data;
          return { id: "rep-partial-freeze", ...data };
        },
      },
    };

    await finalizeReport("rep-partial-freeze", "PARTIALLY_FAILED", {
      customPrisma: mockPrisma,
      forceFreeze: true,
    });

    assert.ok(updatePayload);
    assert.strictEqual(updatePayload.status, "PARTIALLY_FAILED");
    assert.ok(updatePayload.pdfBytes, "pdfBytes must be frozen when forceFreeze is true");
    assert.strictEqual(updatePayload.pdfBytes.toString(), "%PDF-1.4 MOCK FINALIZE BYTES");
    assert.ok(updatePayload.pdfGeneratedAt);
  });

  test("Module retry clears pdfBytes, pdfGeneratedAt and pdfGeneratorVersion on successful retry", async () => {
    const { executeReportModule } = await import("../module-executor.ts");

    let reportUpdatedFields: any = null;
    let finalUpdatePayload: any = null;

    const mockPrisma = {
      report: {
        findUnique: async () => ({
          id: "rep-retry-1",
          vin: "WBA3N51030KS15173",
          firstRegistrationDate: "2021-04-15",
          valuationDate: "2026-08-06",
          status: "PARTIALLY_FAILED",
          pdfBytes: Buffer.from("OLD_FROZEN_PDF"),
          pdfGeneratedAt: new Date("2026-08-01"),
          pdfGeneratorVersion: "0.0.9",
          createdAt: new Date().toISOString(),
          createdBy: { id: "u1", name: "Jan", email: "jan@izzy.pl" },
          moduleResults: [
            {
              id: "mod-1",
              reportId: "rep-retry-1",
              moduleId: "VALUATION",
              status: "FAILED",
              retryCount: 1,
              isNonRetryable: false,
            },
            {
              id: "mod-2",
              reportId: "rep-retry-1",
              moduleId: "CLAIM_CHECK",
              status: "SUCCEEDED",
              retryCount: 0,
              isNonRetryable: false,
            },
          ],
          vehicleSnapshot: null,
          damageClaims: [],
        }),
        update: async ({ data }: any) => {
          if (data.pdfBytes === null) {
            reportUpdatedFields = data;
          }
          finalUpdatePayload = data;
          return { id: "rep-retry-1", ...data };
        },
      },
      reportModuleResult: {
        updateMany: async () => ({ count: 1 }),
        update: async () => ({ id: "mod-1", status: "SUCCEEDED" }),
      },
      vehicleSnapshot: {
        upsert: async () => ({ id: "snap-1" }),
      },
      damageClaim: {
        deleteMany: async () => ({ count: 0 }),
      },
    };

    const mockValAdapter = {
      evaluateVehicle: async () => ({
        ibsCode: "965392",
        make: "BMW",
        model: "Seria 3",
        variant: "320i",
        newPriceCv: 195000,
        marketPriceCob: 120000,
        technicalValueTh: 115000,
        mileageUsed: 65000,
        isAverageMileageUsed: false,
        standardEquipment: [],
        optionalEquipment: [],
        technicalSpec: null,
      }),
    };

    const res = await executeReportModule("rep-retry-1", "VALUATION", {
      customPrisma: mockPrisma,
      customValuationAdapter: mockValAdapter,
      internal: true,
    });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.status, "SUCCEEDED");

    // Invariant check: pdfBytes must be cleared to null
    assert.ok(reportUpdatedFields, "Must execute update clearing pdfBytes on successful retry");
    assert.strictEqual(reportUpdatedFields.pdfBytes, null);
    assert.strictEqual(reportUpdatedFields.pdfGeneratedAt, null);
    assert.strictEqual(reportUpdatedFields.pdfGeneratorVersion, null);
  });
});
