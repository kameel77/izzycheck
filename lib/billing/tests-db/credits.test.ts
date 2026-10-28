import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import {
  InsufficientBalanceError,
  NoCreditsError,
  adjustCredits,
  captureCredit,
  recordUnlimitedUsage,
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
  assert.equal(await testPrisma.creditHold.count({ where: { organizationId: org.id, status: "HELD" } }), 3);
  assert.equal(await testPrisma.creditHold.count({ where: { organizationId: org.id } }), 3);
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
  assert.equal(entries[0].userId, user.id);
  assert.equal(entries[0].idempotencyKey, `usage:${report.id}:VALUATION`);
  assert.equal(entries[0].note, "Nie pobrano: brak salda po przeterminowanej rezerwacji");
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function newReport(orgId: string, userId: string) {
  return createReport({ organizationId: orgId, createdById: userId, modules: { VALUATION: "PENDING" } });
}

async function holdOf(reportId: string) {
  return testPrisma.creditHold.findUniqueOrThrow({
    where: { reportId_moduleId: { reportId, moduleId: "VALUATION" } },
  });
}

async function createHold(
  organizationId: string,
  reportId: string,
  status: "HELD" | "CAPTURED" | "RELEASED",
) {
  await testPrisma.creditHold.create({
    data: { organizationId, reportId, moduleId: "VALUATION", creditType: "VALUATION", status },
  });
}

function captureArgsFor(organizationId: string, reportId: string, userId: string) {
  return {
    organizationId,
    reportId,
    moduleId: "VALUATION" as const,
    creditType: "VALUATION" as const,
    userId,
  };
}

/** balance + credits consumed per the ledger + credits currently held must equal the starting balance. */
async function assertCreditsConserved(organizationId: string, initial: number) {
  const balance = await readBalance(organizationId, "VALUATION");
  const ledger = await testPrisma.creditLedgerEntry.aggregate({
    where: { organizationId },
    _sum: { amount: true },
  });
  const held = await testPrisma.creditHold.count({ where: { organizationId, status: "HELD" } });
  assert.equal(balance + -(ledger._sum.amount ?? 0) + held, initial);
  assert.ok(balance >= 0);
}

test("reserve after capture is a no-op", async () => {
  const { org, user } = await setup(3);
  const report = await newReport(org.id, user.id);

  await reserveCredit(testPrisma, reserveArgs(org.id, report.id));
  assert.equal(await captureCredit(testPrisma, captureArgsFor(org.id, report.id, user.id)), "CAPTURED");
  assert.equal(await readBalance(org.id, "VALUATION"), 2);

  const again = await reserveCredit(testPrisma, reserveArgs(org.id, report.id));

  assert.deepEqual(again, { reused: true });
  assert.equal(await readBalance(org.id, "VALUATION"), 2);
  assert.equal((await holdOf(report.id)).status, "CAPTURED");
  assert.equal(await testPrisma.creditLedgerEntry.count({ where: { organizationId: org.id } }), 1);
  // A later capture stays idempotent instead of colliding with the ledger key.
  assert.equal(await captureCredit(testPrisma, captureArgsFor(org.id, report.id, user.id)), "ALREADY_CAPTURED");
});

test("concurrent reserves of the same report module decrement once", async () => {
  const { org, user } = await setup(3);
  const report = await newReport(org.id, user.id);

  const tx1 = testPrisma.$transaction(async (tx) => {
    const result = await reserveCredit(tx, reserveArgs(org.id, report.id));
    await sleep(300);
    return result;
  });
  await sleep(100);
  const tx2 = testPrisma.$transaction((tx) => reserveCredit(tx, reserveArgs(org.id, report.id)));
  const results = await Promise.all([tx1, tx2]);

  assert.deepEqual(results, [{ reused: false }, { reused: true }]);
  assert.equal(await readBalance(org.id, "VALUATION"), 2);
  assert.equal(await testPrisma.creditHold.count({ where: { organizationId: org.id } }), 1);
  assert.equal((await holdOf(report.id)).status, "HELD");
});

test("concurrent late captures charge once", async () => {
  const { org, user } = await setup(3);
  const report = await newReport(org.id, user.id);
  await createHold(org.id, report.id, "RELEASED");

  const results = await Promise.all(
    Array.from({ length: 4 }, () => captureCredit(testPrisma, captureArgsFor(org.id, report.id, user.id))),
  );

  assert.deepEqual([...results].sort(), ["ALREADY_CAPTURED", "ALREADY_CAPTURED", "ALREADY_CAPTURED", "CAPTURED_LATE"]);
  assert.equal(await readBalance(org.id, "VALUATION"), 2);
  const entries = await testPrisma.creditLedgerEntry.findMany({ where: { organizationId: org.id } });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].amount, -1);
  assert.equal(entries[0].note, "Pobrano po zwolnieniu przeterminowanej rezerwacji");
  assert.equal((await holdOf(report.id)).status, "CAPTURED");
});

test("takeover reserve racing a late capture charges once", async () => {
  for (let i = 0; i < 5; i += 1) {
    await resetDb();
    const { org, user } = await setup(3);
    const report = await newReport(org.id, user.id);
    await createHold(org.id, report.id, "RELEASED");

    const [reserved, captured] = await Promise.allSettled([
      testPrisma.$transaction((tx) => reserveCredit(tx, reserveArgs(org.id, report.id))),
      captureCredit(testPrisma, captureArgsFor(org.id, report.id, user.id)),
    ]);

    assert.equal(reserved.status, "fulfilled", String((reserved as PromiseRejectedResult).reason));
    assert.equal(captured.status, "fulfilled", String((captured as PromiseRejectedResult).reason));
    assert.equal(await readBalance(org.id, "VALUATION"), 2);
    assert.equal((await holdOf(report.id)).status, "CAPTURED");
    const entries = await testPrisma.creditLedgerEntry.findMany({ where: { organizationId: org.id } });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].amount, -1);
    await assertCreditsConserved(org.id, 3);
  }
});

test("stale release racing capture settles exactly once", async () => {
  for (let i = 0; i < 5; i += 1) {
    await resetDb();
    const { org, user } = await setup(1);
    const stale = await newReport(org.id, user.id);
    const other = await newReport(org.id, user.id);

    await reserveCredit(testPrisma, reserveArgs(org.id, stale.id));
    const staleBefore = new Date(Date.now() - 10 * 60_000);
    const backdated = new Date(staleBefore.getTime() - 1000);
    await testPrisma.$executeRaw`UPDATE credit_holds SET "updatedAt" = ${backdated} WHERE "reportId" = ${stale.id}`;

    const [reserved, captured] = await Promise.allSettled([
      testPrisma.$transaction((tx) => reserveCredit(tx, { ...reserveArgs(org.id, other.id), staleBefore })),
      captureCredit(testPrisma, captureArgsFor(org.id, stale.id, user.id)),
    ]);

    assert.equal(captured.status, "fulfilled", String((captured as PromiseRejectedResult).reason));
    if (reserved.status === "rejected") assert.ok(reserved.reason instanceof NoCreditsError, String(reserved.reason));
    assert.equal((await holdOf(stale.id)).status, "CAPTURED");
    assert.equal(
      await testPrisma.creditLedgerEntry.count({ where: { organizationId: org.id, reportId: stale.id } }),
      1,
    );
    assert.equal(
      await testPrisma.creditHold.count({ where: { reportId: other.id } }),
      reserved.status === "fulfilled" ? 1 : 0,
    );
    await assertCreditsConserved(org.id, 1);
  }
});

test("recordUnlimitedUsage is idempotent", async () => {
  const { org, user } = await setup(0);
  const report = await newReport(org.id, user.id);
  const args = captureArgsFor(org.id, report.id, user.id);

  await recordUnlimitedUsage(testPrisma, args);
  await recordUnlimitedUsage(testPrisma, args);

  const entries = await testPrisma.creditLedgerEntry.findMany({ where: { organizationId: org.id } });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].amount, 0);
  assert.equal(entries[0].type, "USAGE");
  assert.equal(entries[0].idempotencyKey, `usage:${report.id}:VALUATION`);
});

test("adjustCredits rejects zero and non-integer amounts", async () => {
  const { org, user } = await setup(2);
  for (const amount of [0, 1.5, Number.NaN]) {
    await assert.rejects(
      adjustCredits(testPrisma, {
        organizationId: org.id,
        creditType: "VALUATION",
        amount,
        note: "x",
        adminUserId: user.id,
      }),
      /całkowit/,
    );
  }
  assert.equal(await readBalance(org.id, "VALUATION"), 2);
  assert.equal(await testPrisma.creditLedgerEntry.count({ where: { organizationId: org.id } }), 0);
});
