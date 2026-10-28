import assert from "node:assert/strict";
import { after, afterEach, beforeEach, test } from "node:test";
import { executeReportModule, ModuleExecutionError, STALE_LOCK_MS } from "../module-executor.ts";
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

type CreditKind = "VALUATION" | "CLAIM_DETAILS";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function readBalance(organizationId: string, creditType: CreditKind): Promise<number> {
  const row = await testPrisma.creditBalance.findUnique({
    where: { organizationId_creditType: { organizationId, creditType } },
  });
  return row?.balance ?? 0;
}

function valuationResult() {
  return {
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
  };
}

function makeValuationAdapter(opts: { delayMs?: number; fail?: boolean } = {}) {
  const calls = { count: 0 };
  return {
    calls,
    adapter: {
      evaluateVehicle: async () => {
        calls.count += 1;
        if (opts.delayMs) await sleep(opts.delayMs);
        if (opts.fail) throw new Error("Audatex niedostępny");
        return valuationResult();
      },
    },
  };
}

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

async function setupValuation(opts: { balance: number; billingMode?: "PREPAID" | "UNLIMITED" }) {
  const org = await createOrg({ billingMode: opts.billingMode });
  const user = await createUser({ organizationId: org.id });
  if (opts.balance > 0) await setBalance(org.id, "VALUATION", opts.balance);
  const report = await createReport({
    organizationId: org.id,
    createdById: user.id,
    modules: { VALUATION: "PENDING" },
  });
  return { org, user, report };
}

async function moduleState(reportId: string, moduleId: "VALUATION" | "CLAIM_CHECK" | "CLAIM_DETAILS") {
  return testPrisma.reportModuleResult.findFirstOrThrow({ where: { reportId, moduleId } });
}

test("PREPAID with zero VALUATION credits returns 402 NO_CREDITS and leaves module PENDING", async () => {
  const { user, report } = await setupValuation({ balance: 0 });
  const { adapter, calls } = makeValuationAdapter();

  await assert.rejects(
    executeReportModule(report.id, "VALUATION", runOptions(user.id, { customValuationAdapter: adapter })),
    (err: any) => {
      assert.ok(err instanceof ModuleExecutionError);
      assert.equal(err.statusCode, 402);
      assert.equal(err.code, "NO_CREDITS");
      assert.equal(err.creditType, "VALUATION");
      return true;
    },
  );

  assert.equal(calls.count, 0);
  const state = await moduleState(report.id, "VALUATION");
  assert.equal(state.status, "PENDING");
  assert.equal(state.retryCount, 0);
});

test("402 on retry does not consume a retry attempt", async () => {
  const org = await createOrg();
  const user = await createUser({ organizationId: org.id });
  const report = await createReport({
    organizationId: org.id,
    createdById: user.id,
    modules: { VALUATION: "FAILED" },
    retryCount: { VALUATION: 1 },
  });
  const { adapter, calls } = makeValuationAdapter();

  await assert.rejects(
    executeReportModule(report.id, "VALUATION", runOptions(user.id, { customValuationAdapter: adapter })),
    (err: any) => {
      assert.equal(err.statusCode, 402);
      assert.equal(err.code, "NO_CREDITS");
      return true;
    },
  );

  assert.equal(calls.count, 0);
  const state = await moduleState(report.id, "VALUATION");
  assert.equal(state.status, "FAILED");
  assert.equal(state.retryCount, 1);
});

test("successful VALUATION captures one credit billed to the report owner", async () => {
  const { org, user, report } = await setupValuation({ balance: 1 });
  const { adapter } = makeValuationAdapter();

  const res = await executeReportModule(report.id, "VALUATION", runOptions(user.id, { customValuationAdapter: adapter }));
  assert.equal(res.success, true);

  assert.equal(await readBalance(org.id, "VALUATION"), 0);
  const entries = await testPrisma.creditLedgerEntry.findMany({ where: { organizationId: org.id } });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, "USAGE");
  assert.equal(entries[0].amount, -1);
  assert.equal(entries[0].userId, user.id);
  const hold = await testPrisma.creditHold.findFirstOrThrow({ where: { reportId: report.id } });
  assert.equal(hold.status, "CAPTURED");
});

test("failed VALUATION releases the credit", async () => {
  const { org, user, report } = await setupValuation({ balance: 1 });
  const { adapter } = makeValuationAdapter({ fail: true });

  await assert.rejects(
    executeReportModule(report.id, "VALUATION", runOptions(user.id, { customValuationAdapter: adapter })),
    (err: any) => {
      assert.ok(err instanceof ModuleExecutionError);
      assert.equal(err.statusCode, 500);
      return true;
    },
  );

  assert.equal(await readBalance(org.id, "VALUATION"), 1);
  const hold = await testPrisma.creditHold.findFirstOrThrow({ where: { reportId: report.id } });
  assert.equal(hold.status, "RELEASED");
  const entries = await testPrisma.creditLedgerEntry.findMany({ where: { organizationId: org.id } });
  assert.equal(entries.length, 0);
  const state = await moduleState(report.id, "VALUATION");
  assert.equal(state.status, "FAILED");
});

test("CLAIM_DETAILS with zero claims is free", async () => {
  const org = await createOrg();
  const user = await createUser({ organizationId: org.id });
  await setBalance(org.id, "CLAIM_DETAILS", 1);
  const report = await createReport({
    organizationId: org.id,
    createdById: user.id,
    modules: { CLAIM_CHECK: "SUCCEEDED", CLAIM_DETAILS: "PENDING" },
  });
  const histAdapter = { getClaimDetails: async () => ({ claims: [] }) };

  const res = await executeReportModule(
    report.id,
    "CLAIM_DETAILS",
    runOptions(user.id, { customHistoryAdapter: histAdapter }),
  );
  assert.equal(res.success, true);

  const state = await moduleState(report.id, "CLAIM_DETAILS");
  assert.equal(state.status, "SUCCEEDED");
  assert.equal(await readBalance(org.id, "CLAIM_DETAILS"), 1);
  const entries = await testPrisma.creditLedgerEntry.findMany({ where: { organizationId: org.id } });
  assert.equal(entries.length, 0);
});

test("two reports racing for the last credit: exactly one runs", async () => {
  const org = await createOrg();
  const user = await createUser({ organizationId: org.id });
  await setBalance(org.id, "VALUATION", 1);
  const reportA = await createReport({ organizationId: org.id, createdById: user.id, modules: { VALUATION: "PENDING" } });
  const reportB = await createReport({ organizationId: org.id, createdById: user.id, modules: { VALUATION: "PENDING" } });
  const { adapter } = makeValuationAdapter({ delayMs: 50 });

  const results = await Promise.allSettled([
    executeReportModule(reportA.id, "VALUATION", runOptions(user.id, { customValuationAdapter: adapter })),
    executeReportModule(reportB.id, "VALUATION", runOptions(user.id, { customValuationAdapter: adapter })),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.statusCode, 402);

  assert.equal(await readBalance(org.id, "VALUATION"), 0);
  const entries = await testPrisma.creditLedgerEntry.findMany({ where: { organizationId: org.id } });
  assert.equal(entries.length, 1);
});

test("same module dispatched twice at once: one 409, one reservation", async () => {
  const { org, user, report } = await setupValuation({ balance: 2 });
  const { adapter, calls } = makeValuationAdapter({ delayMs: 50 });

  const results = await Promise.allSettled([
    executeReportModule(report.id, "VALUATION", runOptions(user.id, { customValuationAdapter: adapter })),
    executeReportModule(report.id, "VALUATION", runOptions(user.id, { customValuationAdapter: adapter })),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.statusCode, 409);

  assert.equal(calls.count, 1);
  assert.equal(await readBalance(org.id, "VALUATION"), 1);
});

test("UNLIMITED organization runs without credits and records zero-amount usage", async () => {
  const { org, user, report } = await setupValuation({ balance: 0, billingMode: "UNLIMITED" });
  const { adapter } = makeValuationAdapter();

  const res = await executeReportModule(report.id, "VALUATION", runOptions(user.id, { customValuationAdapter: adapter }));
  assert.equal(res.success, true);

  const entries = await testPrisma.creditLedgerEntry.findMany({ where: { organizationId: org.id } });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, "USAGE");
  assert.equal(entries[0].amount, 0);
  assert.equal(await readBalance(org.id, "VALUATION"), 0);
});

test("report without organization runs without credit operations", async () => {
  const user = await createUser({ organizationId: null });
  const report = await createReport({ organizationId: null, createdById: user.id, modules: { VALUATION: "PENDING" } });
  const { adapter } = makeValuationAdapter();

  const res = await executeReportModule(report.id, "VALUATION", runOptions(user.id, { customValuationAdapter: adapter }));
  assert.equal(res.success, true);

  assert.equal(await testPrisma.creditLedgerEntry.count(), 0);
  assert.equal(await testPrisma.creditHold.count(), 0);
});

test("CLAIM_CHECK is free on PREPAID", async () => {
  const org = await createOrg();
  const user = await createUser({ organizationId: org.id });
  const report = await createReport({ organizationId: org.id, createdById: user.id, modules: { CLAIM_CHECK: "PENDING" } });
  const histAdapter = {
    checkClaimHistory: async () => ({ hasHistory: false, photosStatus: "NONE", advice: "Brak" }),
  };

  const res = await executeReportModule(
    report.id,
    "CLAIM_CHECK",
    runOptions(user.id, { customHistoryAdapter: histAdapter }),
  );
  assert.equal(res.success, true);

  assert.equal(await testPrisma.creditHold.count(), 0);
  assert.equal(await testPrisma.creditLedgerEntry.count(), 0);
});

/** Adapter whose call stays pending until release() is called; started resolves once evaluateVehicle was entered. */
function makeGatedValuationAdapter(outcome: "succeed" | "fail") {
  let release!: () => void;
  let markStarted!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  return {
    release,
    started,
    adapter: {
      evaluateVehicle: async () => {
        markStarted();
        await gate;
        if (outcome === "fail") throw new Error("Audatex niedostępny (późna awaria)");
        return valuationResult();
      },
    },
  };
}

/** Makes the running module and its hold look older than STALE_LOCK_MS, so the next execution takes over. */
async function makeLockStale(reportId: string) {
  const old = new Date(Date.now() - STALE_LOCK_MS - 5000);
  await testPrisma.$executeRaw`UPDATE report_module_results SET "updatedAt" = ${old} WHERE "reportId" = ${reportId} AND "moduleId" = 'VALUATION'`;
  await testPrisma.$executeRaw`UPDATE credit_holds SET "updatedAt" = ${old} WHERE "reportId" = ${reportId}`;
}

async function ledgerAmounts(organizationId: string): Promise<number[]> {
  const entries = await testPrisma.creditLedgerEntry.findMany({ where: { organizationId } });
  return entries.map((e) => e.amount);
}

test("late failure after takeover does not overwrite a succeeded module", async () => {
  const { org, user, report } = await setupValuation({ balance: 1 });
  const slow = makeGatedValuationAdapter("fail");
  const fast = makeValuationAdapter();

  const first = executeReportModule(
    report.id,
    "VALUATION",
    runOptions(user.id, { customValuationAdapter: slow.adapter }),
  );
  const firstSettled = first.then(
    () => ({ ok: true as const }),
    (error: any) => ({ ok: false as const, error }),
  );
  await slow.started;
  await makeLockStale(report.id);

  const second = await executeReportModule(
    report.id,
    "VALUATION",
    runOptions(user.id, { customValuationAdapter: fast.adapter }),
  );
  assert.equal(second.success, true);
  assert.equal(await readBalance(org.id, "VALUATION"), 0);
  assert.deepEqual(await ledgerAmounts(org.id), [-1]);

  slow.release();
  const outcome = await firstSettled;
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.ok(outcome.error instanceof ModuleExecutionError);
    assert.equal(outcome.error.statusCode, 409);
  }

  const state = await moduleState(report.id, "VALUATION");
  assert.equal(state.status, "SUCCEEDED");
  assert.equal(state.errorMessage, null);
  const hold = await testPrisma.creditHold.findFirstOrThrow({ where: { reportId: report.id } });
  assert.equal(hold.status, "CAPTURED");
  assert.deepEqual(await ledgerAmounts(org.id), [-1]);
  assert.equal(await readBalance(org.id, "VALUATION"), 0);
  const finished = await testPrisma.report.findUniqueOrThrow({ where: { id: report.id } });
  assert.equal(finished.status, "COMPLETED");
});

test("late success after takeover does not double-capture", async () => {
  const { org, user, report } = await setupValuation({ balance: 2 });
  const slow = makeGatedValuationAdapter("succeed");
  const fast = makeValuationAdapter();

  const first = executeReportModule(
    report.id,
    "VALUATION",
    runOptions(user.id, { customValuationAdapter: slow.adapter }),
  );
  const firstSettled = first.then(
    () => ({ ok: true as const }),
    (error: any) => ({ ok: false as const, error }),
  );
  await slow.started;
  await makeLockStale(report.id);

  await executeReportModule(report.id, "VALUATION", runOptions(user.id, { customValuationAdapter: fast.adapter }));
  assert.equal(await readBalance(org.id, "VALUATION"), 1);

  slow.release();
  const outcome = await firstSettled;
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.ok(outcome.error instanceof ModuleExecutionError);
    assert.equal(outcome.error.statusCode, 409);
  }

  const state = await moduleState(report.id, "VALUATION");
  assert.equal(state.status, "SUCCEEDED");
  assert.deepEqual(await ledgerAmounts(org.id), [-1]);
  assert.equal(await readBalance(org.id, "VALUATION"), 1);
  const hold = await testPrisma.creditHold.findFirstOrThrow({ where: { reportId: report.id } });
  assert.equal(hold.status, "CAPTURED");
});
