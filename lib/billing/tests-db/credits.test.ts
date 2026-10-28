import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import {
  InsufficientBalanceError,
  NoCreditsError,
  adjustCredits,
  captureCredit,
  releaseCredit,
  reserveCredit,
} from "../credits.ts";
import { createOrg, createReport, createUser, resetDb, setBalance, testPrisma } from "../../test-db/helpers.ts";

beforeEach(async () => {
  await resetDb();
});

after(async () => {
  await testPrisma.$disconnect();
});

async function readBalance(organizationId: string, creditType: "VALUATION" | "CLAIM_DETAILS"): Promise<number> {
  const row = await testPrisma.creditBalance.findUnique({
    where: { organizationId_creditType: { organizationId, creditType } },
  });
  return row?.balance ?? 0;
}

async function setup(balance: number) {
  const org = await createOrg();
  const user = await createUser({ organizationId: org.id });
  if (balance > 0) await setBalance(org.id, "VALUATION", balance);
  return { org, user };
}

function reserveArgs(organizationId: string, reportId: string) {
  return {
    organizationId,
    reportId,
    moduleId: "VALUATION" as const,
    creditType: "VALUATION" as const,
    staleBefore: new Date(Date.now() - 10 * 60_000),
  };
}

test("10 parallel reservations on balance 3 succeed exactly 3 times", async () => {
  const { org, user } = await setup(3);
  const reports = await Promise.all(
    Array.from({ length: 10 }, () =>
      createReport({ organizationId: org.id, createdById: user.id, modules: { VALUATION: "PENDING" } }),
    ),
  );

  const results = await Promise.allSettled(
    reports.map((r) => testPrisma.$transaction((tx) => reserveCredit(tx, reserveArgs(org.id, r.id)))),
  );

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  assert.equal(fulfilled.length, 3);
  assert.equal(rejected.length, 7);
  for (const r of rejected) assert.ok(r.reason instanceof NoCreditsError, String(r.reason));
  assert.equal(await readBalance(org.id, "VALUATION"), 0);
});

test("reserving the same report module twice reuses the hold", async () => {
  const { org, user } = await setup(5);
  const report = await createReport({
    organizationId: org.id,
    createdById: user.id,
    modules: { VALUATION: "PENDING" },
  });

  const first = await testPrisma.$transaction((tx) => reserveCredit(tx, reserveArgs(org.id, report.id)));
  const second = await testPrisma.$transaction((tx) => reserveCredit(tx, reserveArgs(org.id, report.id)));

  assert.deepEqual(first, { reused: false });
  assert.deepEqual(second, { reused: true });
  assert.equal(await readBalance(org.id, "VALUATION"), 4);
});

test("release restores balance once", async () => {
  const { org, user } = await setup(1);
  const report = await createReport({
    organizationId: org.id,
    createdById: user.id,
    modules: { VALUATION: "PENDING" },
  });

  await testPrisma.$transaction((tx) => reserveCredit(tx, reserveArgs(org.id, report.id)));
  assert.equal(await readBalance(org.id, "VALUATION"), 0);

  assert.equal(await releaseCredit(testPrisma, { reportId: report.id, moduleId: "VALUATION" }), true);
  assert.equal(await readBalance(org.id, "VALUATION"), 1);

  assert.equal(await releaseCredit(testPrisma, { reportId: report.id, moduleId: "VALUATION" }), false);
  assert.equal(await readBalance(org.id, "VALUATION"), 1);
});

test("capture is idempotent", async () => {
  const { org, user } = await setup(1);
  const report = await createReport({
    organizationId: org.id,
    createdById: user.id,
    modules: { VALUATION: "PENDING" },
  });
  const captureArgs = {
    organizationId: org.id,
    reportId: report.id,
    moduleId: "VALUATION" as const,
    creditType: "VALUATION" as const,
    userId: user.id,
  };

  await testPrisma.$transaction((tx) => reserveCredit(tx, reserveArgs(org.id, report.id)));
  assert.equal(await captureCredit(testPrisma, captureArgs), "CAPTURED");
  assert.equal(await captureCredit(testPrisma, captureArgs), "ALREADY_CAPTURED");

  const entries = await testPrisma.creditLedgerEntry.findMany({ where: { organizationId: org.id } });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, "USAGE");
  assert.equal(entries[0].amount, -1);
  assert.equal(entries[0].userId, user.id);
  assert.equal(entries[0].idempotencyKey, `usage:${report.id}:VALUATION`);
  assert.equal(await readBalance(org.id, "VALUATION"), 0);
});

test("stale HELD hold is released by the next reservation in the organization", async () => {
  const { org, user } = await setup(1);
  const stale = await createReport({
    organizationId: org.id,
    createdById: user.id,
    modules: { VALUATION: "PENDING" },
  });
  const fresh = await createReport({
    organizationId: org.id,
    createdById: user.id,
    modules: { VALUATION: "PENDING" },
  });

  await testPrisma.$transaction((tx) => reserveCredit(tx, reserveArgs(org.id, stale.id)));
  assert.equal(await readBalance(org.id, "VALUATION"), 0);

  const staleBefore = new Date(Date.now() - 10 * 60_000);
  const backdated = new Date(staleBefore.getTime() - 1000);
  await testPrisma.$executeRaw`UPDATE credit_holds SET "updatedAt" = ${backdated} WHERE "reportId" = ${stale.id}`;

  const result = await testPrisma.$transaction((tx) =>
    reserveCredit(tx, { ...reserveArgs(org.id, fresh.id), staleBefore }),
  );

  assert.deepEqual(result, { reused: false });
  const oldHold = await testPrisma.creditHold.findUniqueOrThrow({
    where: { reportId_moduleId: { reportId: stale.id, moduleId: "VALUATION" } },
  });
  assert.equal(oldHold.status, "RELEASED");
  const newHold = await testPrisma.creditHold.findUniqueOrThrow({
    where: { reportId_moduleId: { reportId: fresh.id, moduleId: "VALUATION" } },
  });
  assert.equal(newHold.status, "HELD");
  assert.equal(await readBalance(org.id, "VALUATION"), 0);
});

test("late capture after stale release with zero balance records a free usage", async () => {
  const { org, user } = await setup(0);
  const report = await createReport({
    organizationId: org.id,
    createdById: user.id,
    modules: { VALUATION: "PENDING" },
  });
  await testPrisma.creditHold.create({
    data: {
      organizationId: org.id,
      reportId: report.id,
      moduleId: "VALUATION",
      creditType: "VALUATION",
      status: "RELEASED",
    },
  });

  const outcome = await captureCredit(testPrisma, {
    organizationId: org.id,
    reportId: report.id,
    moduleId: "VALUATION",
    creditType: "VALUATION",
    userId: user.id,
  });

  assert.equal(outcome, "FREE_LATE");
  const entries = await testPrisma.creditLedgerEntry.findMany({ where: { organizationId: org.id } });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].amount, 0);
  assert.equal(await readBalance(org.id, "VALUATION"), 0);
  const hold = await testPrisma.creditHold.findUniqueOrThrow({
    where: { reportId_moduleId: { reportId: report.id, moduleId: "VALUATION" } },
  });
  assert.equal(hold.status, "CAPTURED");
});

test("negative adjustment below zero is rejected", async () => {
  const { org, user } = await setup(2);

  await assert.rejects(
    adjustCredits(testPrisma, {
      organizationId: org.id,
      creditType: "VALUATION",
      amount: -3,
      note: "korekta",
      adminUserId: user.id,
    }),
    InsufficientBalanceError,
  );

  assert.equal(await readBalance(org.id, "VALUATION"), 2);
  assert.equal(await testPrisma.creditLedgerEntry.count({ where: { organizationId: org.id } }), 0);
});

test("positive adjustment creates balance row and ledger entry", async () => {
  const { org, user } = await setup(0);

  const result = await adjustCredits(testPrisma, {
    organizationId: org.id,
    creditType: "VALUATION",
    amount: 10,
    note: "Doładowanie testowe",
    adminUserId: user.id,
  });

  assert.deepEqual(result, { balance: 10 });
  const entries = await testPrisma.creditLedgerEntry.findMany({ where: { organizationId: org.id } });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, "MANUAL_ADJUSTMENT");
  assert.equal(entries[0].amount, 10);
  assert.equal(entries[0].note, "Doładowanie testowe");
  assert.equal(entries[0].userId, user.id);
});
