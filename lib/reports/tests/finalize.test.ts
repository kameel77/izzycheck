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
    assert.strictEqual(updatePayload.pdfBytes, undefined, "pdfBytes must not be frozen for PARTIALLY_FAILED");
    assert.strictEqual(updatePayload.pdfGeneratedAt, undefined);
  });

  test.skip("Slice 4: Module retry endpoint clears pdfBytes, pdfGeneratedAt and pdfGeneratorVersion on successful retry", async () => {
    // Pending implementation in Slice 4 (app/api/reports/[id]/modules/[moduleId]/retry/route.ts)
    // Upon successful retry of a failed module, the handler MUST execute:
    // await prisma.report.update({ where: { id }, data: { pdfBytes: null, pdfGeneratedAt: null, pdfGeneratorVersion: null } });
  });
});
