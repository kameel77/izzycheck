import assert from "node:assert/strict";
import { after, afterEach, beforeEach, test } from "node:test";
import { executeReportModule, ModuleExecutionError } from "../module-executor.ts";
import { skipReportModule } from "../skip-module.ts";
import { createOrg, createReport, createUser, resetDb, setBalance, testPrisma } from "../../test-db/helpers.ts";

beforeEach(async () => {
  await resetDb();
  globalThis.__mockRenderToBuffer = async () => Buffer.from("%PDF-1.4 MOCK BYTES");
});

afterEach(() => {
  globalThis.__mockRenderToBuffer = undefined;
});

after(async () => {
  await testPrisma.$disconnect();
});

function runOptions(userId: string, extra: Record<string, unknown> = {}) {
  return {
    customPrisma: testPrisma,
    userId,
    role: "USER" as const,
    canGenerateValuation: true,
    canGenerateClaimCheck: true,
    canGenerateClaimDetails: true,
    ...extra,
  };
}

async function readBalance(organizationId: string, creditType: "VALUATION" | "CLAIM_DETAILS"): Promise<number> {
  const row = await testPrisma.creditBalance.findUnique({
    where: { organizationId_creditType: { organizationId, creditType } },
  });
  return row?.balance ?? 0;
}

test("no credits then skip finishes the report", async () => {
  const org = await createOrg({ billingMode: "PREPAID" });
  const user = await createUser({ organizationId: org.id });
  const report = await createReport({
    organizationId: org.id,
    createdById: user.id,
    modules: { VALUATION: "PENDING", CLAIM_CHECK: "PENDING" },
  });

  const histAdapter = {
    checkClaimHistory: async () => ({ hasHistory: true, photosStatus: "NONE", advice: "Są wpisy" }),
  };
  await executeReportModule(report.id, "CLAIM_CHECK", runOptions(user.id, { customHistoryAdapter: histAdapter }));

  await assert.rejects(
    executeReportModule(report.id, "VALUATION", runOptions(user.id)),
    (err: any) => {
      assert.ok(err instanceof ModuleExecutionError);
      assert.equal(err.statusCode, 402);
      assert.equal(err.code, "NO_CREDITS");
      return true;
    },
  );

  const beforeSkip = await testPrisma.report.findUniqueOrThrow({ where: { id: report.id } });
  assert.equal(beforeSkip.status, "PROCESSING");

  const res = await skipReportModule(report.id, "VALUATION", {
    customPrisma: testPrisma,
    userId: user.id,
    role: "USER",
    organizationId: org.id,
  });
  assert.deepEqual(res, { success: true, moduleId: "VALUATION" });

  const finished = await testPrisma.report.findUniqueOrThrow({ where: { id: report.id } });
  assert.equal(finished.status, "COMPLETED");
  assert.ok(finished.pdfBytes && finished.pdfBytes.length > 0, "PDF must be stored");

  const valuation = await testPrisma.reportModuleResult.findFirstOrThrow({
    where: { reportId: report.id, moduleId: "VALUATION" },
  });
  assert.equal(valuation.status, "NOT_REQUESTED");

  assert.equal(await testPrisma.creditHold.count({ where: { reportId: report.id, status: "HELD" } }), 0);
  assert.equal(await readBalance(org.id, "VALUATION"), 0);
});

test("skip releases a dangling credit reservation", async () => {
  const org = await createOrg({ billingMode: "PREPAID" });
  const user = await createUser({ organizationId: org.id });
  const report = await createReport({
    organizationId: org.id,
    createdById: user.id,
    modules: { VALUATION: "FAILED" },
  });
  await setBalance(org.id, "VALUATION", 0);
  await testPrisma.creditHold.create({
    data: {
      organizationId: org.id,
      reportId: report.id,
      moduleId: "VALUATION",
      creditType: "VALUATION",
      status: "HELD",
    },
  });

  await skipReportModule(report.id, "VALUATION", {
    customPrisma: testPrisma,
    userId: user.id,
    role: "USER",
    organizationId: org.id,
  });

  assert.equal(await testPrisma.creditHold.count({ where: { reportId: report.id, status: "HELD" } }), 0);
  assert.equal(await readBalance(org.id, "VALUATION"), 1);
});

test("skip refuses a report with a frozen PDF and changes nothing", async () => {
  const org = await createOrg({ billingMode: "PREPAID" });
  const user = await createUser({ organizationId: org.id });
  const report = await createReport({
    organizationId: org.id,
    createdById: user.id,
    modules: { VALUATION: "FAILED" },
  });
  await testPrisma.report.update({
    where: { id: report.id },
    data: { status: "PARTIALLY_FAILED", pdfBytes: Buffer.from("%PDF-1.4 FROZEN") },
  });

  await assert.rejects(
    skipReportModule(report.id, "VALUATION", {
      customPrisma: testPrisma,
      userId: user.id,
      role: "USER",
      organizationId: org.id,
    }),
    (err: any) => {
      assert.ok(err instanceof ModuleExecutionError);
      assert.equal(err.statusCode, 409);
      return true;
    },
  );

  const after = await testPrisma.report.findUniqueOrThrow({ where: { id: report.id } });
  assert.equal(after.status, "PARTIALLY_FAILED");
  assert.equal(Buffer.from(after.pdfBytes as Uint8Array).toString(), "%PDF-1.4 FROZEN");
  const valuation = await testPrisma.reportModuleResult.findFirstOrThrow({
    where: { reportId: report.id, moduleId: "VALUATION" },
  });
  assert.equal(valuation.status, "FAILED");
});
