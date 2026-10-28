/**
 * Prepaid report credits (per organization, per credit type).
 *
 * Money-critical rules: a balance only ever decreases through a conditional updateMany (`balance >= n`).
 * Every operation on one (reportId, moduleId) is serialized with a row lock on its credit_holds row
 * (SELECT ... FOR UPDATE; lock order: own hold -> other holds via SKIP LOCKED -> balance), so status
 * transitions are decided on the locked, current status. Functions taking `db` accept either a
 * transaction client or a full client (then they open their own transaction).
 */
import { randomUUID } from "node:crypto";
import type {
  BillingMode,
  CreditHoldStatus,
  CreditType,
  PrismaClient,
  Prisma,
  ReportModuleId,
} from "@prisma/client";

type Db = Prisma.TransactionClient;

const CREDIT_TYPES: CreditType[] = ["VALUATION", "CLAIM_DETAILS"];

export function creditTypeForModule(moduleId: ReportModuleId): CreditType | null {
  if (moduleId === "VALUATION") return "VALUATION";
  if (moduleId === "CLAIM_DETAILS") return "CLAIM_DETAILS";
  return null;
}

export function isPrepaid(org: { billingMode: BillingMode } | null | undefined): boolean {
  return org?.billingMode === "PREPAID";
}

export class NoCreditsError extends Error {
  creditType: CreditType;
  constructor(creditType: CreditType) {
    super(`Brak kredytów (${creditType}) do wykonania modułu.`);
    this.name = "NoCreditsError";
    this.creditType = creditType;
  }
}

export class InsufficientBalanceError extends Error {
  constructor() {
    super("Saldo kredytów nie może spaść poniżej zera.");
    this.name = "InsufficientBalanceError";
  }
}

function usageKey(reportId: string, moduleId: ReportModuleId): string {
  return `usage:${reportId}:${moduleId}`;
}

async function incrementBalance(
  tx: Db,
  organizationId: string,
  creditType: CreditType,
  amount: number,
): Promise<number> {
  const row = await tx.creditBalance.upsert({
    where: { organizationId_creditType: { organizationId, creditType } },
    update: { balance: { increment: amount } },
    create: { organizationId, creditType, balance: amount },
  });
  return row.balance;
}

/** Conditional decrement by 1; false when the balance is too low (nothing changed). */
async function tryDecrementBalance(tx: Db, organizationId: string, creditType: CreditType): Promise<boolean> {
  const { count } = await tx.creditBalance.updateMany({
    where: { organizationId, creditType, balance: { gte: 1 } },
    data: { balance: { decrement: 1 } },
  });
  return count === 1;
}

export async function getBalances(db: Db, organizationId: string): Promise<Record<CreditType, number>> {
  const rows = await db.creditBalance.findMany({ where: { organizationId } });
  const result = Object.fromEntries(CREDIT_TYPES.map((t) => [t, 0])) as Record<CreditType, number>;
  for (const row of rows) result[row.creditType] = row.balance;
  return result;
}

/** Runs fn in its own transaction for a full client, or directly when already inside one. */
async function runInTx<T>(db: Db | PrismaClient, fn: (tx: Db) => Promise<T>): Promise<T> {
  if (typeof (db as PrismaClient).$transaction === "function") {
    return (db as PrismaClient).$transaction((tx) => fn(tx));
  }
  return fn(db as Db);
}

interface LockedHold {
  id: string;
  status: CreditHoldStatus;
  organizationId: string;
  creditType: CreditType;
  updatedAt: Date;
}

/**
 * Serializes everything touching one (reportId, moduleId) with a row lock. With createIfMissing a RELEASED
 * placeholder row is inserted first (ON CONFLICT DO NOTHING), so there is always a row to lock.
 * Lock order everywhere: own hold row -> other holds (SKIP LOCKED) -> balance row.
 */
async function lockHold(
  tx: Db,
  args: {
    reportId: string;
    moduleId: ReportModuleId;
    organizationId?: string;
    creditType?: CreditType;
    createIfMissing: boolean;
  },
): Promise<LockedHold | null> {
  const { reportId, moduleId, organizationId, creditType, createIfMissing } = args;
  if (createIfMissing && organizationId && creditType) {
    await tx.creditHold.createMany({
      data: [{ organizationId, reportId, moduleId, creditType, status: "RELEASED" }],
      skipDuplicates: true,
    });
  }
  const rows = await tx.$queryRaw<LockedHold[]>`
    SELECT id, status, "organizationId", "creditType", "updatedAt"
    FROM credit_holds
    WHERE "reportId" = ${reportId} AND "moduleId" = ${moduleId}::"ReportModuleId"
    FOR UPDATE`;
  return rows[0] ?? null;
}

export async function releaseStaleHolds(
  db: Db | PrismaClient,
  organizationId: string,
  staleBefore: Date,
): Promise<number> {
  return runInTx(db, async (tx) => {
    const candidates = await tx.creditHold.findMany({
      where: { organizationId, status: "HELD", updatedAt: { lt: staleBefore } },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    let released = 0;
    for (const { id } of candidates) {
      // SKIP LOCKED: a hold being captured/released/reserved right now is not stale for our purposes.
      const rows = await tx.$queryRaw<{ id: string; organizationId: string; creditType: CreditType }[]>`
        SELECT id, "organizationId", "creditType"
        FROM credit_holds
        WHERE id = ${id} AND status = 'HELD'
          AND "updatedAt" < (${staleBefore}::timestamptz AT TIME ZONE 'UTC')
        FOR UPDATE SKIP LOCKED`;
      const hold = rows[0];
      if (!hold) continue;
      await tx.creditHold.update({ where: { id }, data: { status: "RELEASED" } });
      await incrementBalance(tx, hold.organizationId, hold.creditType, 1);
      released += 1;
    }
    return released;
  });
}

export async function reserveCredit(
  db: Db | PrismaClient,
  args: {
    organizationId: string;
    reportId: string;
    moduleId: ReportModuleId;
    creditType: CreditType;
    staleBefore: Date;
  },
): Promise<{ reused: boolean }> {
  const { organizationId, reportId, moduleId, creditType, staleBefore } = args;
  return runInTx(db, async (tx) => {
    const locked = await lockHold(tx, { reportId, moduleId, organizationId, creditType, createIfMissing: true });
    if (!locked) throw new Error("Nie udało się zablokować rezerwacji kredytu.");

    await releaseStaleHolds(tx, organizationId, staleBefore);

    // Re-read: the sweep runs in this transaction and may have released our own (stale) hold.
    const hold = await tx.creditHold.findUniqueOrThrow({ where: { id: locked.id } });

    if (hold.status === "HELD") {
      await tx.creditHold.update({ where: { id: hold.id }, data: { updatedAt: new Date() } });
      return { reused: true };
    }
    if (hold.status === "CAPTURED") return { reused: true };

    if (!(await tryDecrementBalance(tx, organizationId, creditType))) {
      // Rolls back a freshly inserted placeholder row together with the transaction.
      throw new NoCreditsError(creditType);
    }
    await tx.creditHold.update({
      where: { id: hold.id },
      data: { status: "HELD", organizationId, creditType },
    });
    return { reused: false };
  });
}

export async function captureCredit(
  db: Db | PrismaClient,
  args: {
    organizationId: string;
    reportId: string;
    moduleId: ReportModuleId;
    creditType: CreditType;
    userId: string;
  },
): Promise<"CAPTURED" | "ALREADY_CAPTURED" | "CAPTURED_LATE" | "FREE_LATE"> {
  const { organizationId, reportId, moduleId, creditType, userId } = args;
  const idempotencyKey = usageKey(reportId, moduleId);

  return runInTx(db, async (tx) => {
    const hold = await lockHold(tx, { reportId, moduleId, organizationId, creditType, createIfMissing: true });
    if (!hold) throw new Error("Nie udało się zablokować rezerwacji kredytu.");

    if (hold.status === "CAPTURED") return "ALREADY_CAPTURED";

    // The hold lock serializes captures, so an existing usage entry here is an invariant violation, not a retry.
    const writeUsage = async (amount: number, note?: string) => {
      const { count } = await tx.creditLedgerEntry.createMany({
        data: [
          { organizationId, creditType, amount, type: "USAGE", idempotencyKey, reportId, moduleId, userId, note },
        ],
        skipDuplicates: true,
      });
      if (count === 0) throw new Error("Wpis zużycia już istnieje dla tego modułu.");
    };

    if (hold.status === "HELD") {
      await tx.creditHold.update({ where: { id: hold.id }, data: { status: "CAPTURED" } });
      await writeUsage(-1);
      return "CAPTURED";
    }

    // RELEASED: the hold was released as stale before the module finished; charge now if the balance allows.
    const charged = await tryDecrementBalance(tx, organizationId, creditType);
    await writeUsage(
      charged ? -1 : 0,
      charged
        ? "Pobrano po zwolnieniu przeterminowanej rezerwacji"
        : "Nie pobrano: brak salda po przeterminowanej rezerwacji",
    );
    await tx.creditHold.update({ where: { id: hold.id }, data: { status: "CAPTURED" } });
    return charged ? "CAPTURED_LATE" : "FREE_LATE";
  });
}

export async function releaseCredit(
  db: Db | PrismaClient,
  args: { reportId: string; moduleId: ReportModuleId },
): Promise<boolean> {
  const { reportId, moduleId } = args;
  return runInTx(db, async (tx) => {
    const hold = await lockHold(tx, { reportId, moduleId, createIfMissing: false });
    if (!hold || hold.status !== "HELD") return false;

    await tx.creditHold.update({ where: { id: hold.id }, data: { status: "RELEASED" } });
    await incrementBalance(tx, hold.organizationId, hold.creditType, 1);
    return true;
  });
}

export async function recordUnlimitedUsage(
  db: Db | PrismaClient,
  args: {
    organizationId: string;
    reportId: string;
    moduleId: ReportModuleId;
    creditType: CreditType;
    userId: string;
  },
): Promise<void> {
  const { organizationId, reportId, moduleId, creditType, userId } = args;
  await runInTx(db, async (tx) => {
    // skipDuplicates = ON CONFLICT DO NOTHING: an existing entry is ignored without aborting a surrounding transaction.
    await tx.creditLedgerEntry.createMany({
      data: [
        {
          organizationId,
          creditType,
          amount: 0,
          type: "USAGE",
          idempotencyKey: usageKey(reportId, moduleId),
          reportId,
          moduleId,
          userId,
        },
      ],
      skipDuplicates: true,
    });
  });
}

/**
 * Credits an online purchase exactly once per idempotencyKey ("purchase:{orderId}:{creditType}").
 * The PURCHASE ledger entry is written with ON CONFLICT DO NOTHING; the balance is incremented only when
 * this call inserted the row, so retries and parallel calls never double-credit. Always type PURCHASE:
 * other ledger types go through their own functions, so a key outside the purchase namespace is rejected.
 */
export async function addCredits(
  db: Db | PrismaClient,
  args: {
    organizationId: string;
    creditType: CreditType;
    amount: number;
    idempotencyKey: string;
    orderId: string;
    userId?: string | null;
    note?: string;
  },
): Promise<{ added: boolean }> {
  const { organizationId, creditType, amount, idempotencyKey, orderId, userId, note } = args;
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("Doładowanie musi być dodatnią liczbą całkowitą.");
  }
  if (!idempotencyKey.startsWith("purchase:")) {
    throw new Error("Klucz doładowania musi mieć postać purchase:{orderId}:{creditType}.");
  }

  return runInTx(db, async (tx) => {
    const { count } = await tx.creditLedgerEntry.createMany({
      data: [
        {
          organizationId,
          creditType,
          amount,
          type: "PURCHASE",
          idempotencyKey,
          orderId,
          userId: userId ?? null,
          note,
        },
      ],
      skipDuplicates: true,
    });
    if (count === 0) return { added: false };

    await incrementBalance(tx, organizationId, creditType, amount);
    return { added: true };
  });
}

export async function adjustCredits(
  db: PrismaClient,
  args: {
    organizationId: string;
    creditType: CreditType;
    amount: number;
    note: string;
    adminUserId: string;
  },
): Promise<{ balance: number }> {
  const { organizationId, creditType, amount, note, adminUserId } = args;
  if (!Number.isInteger(amount) || amount === 0) {
    throw new Error("Korekta musi być liczbą całkowitą różną od zera.");
  }

  return db.$transaction(async (tx) => {
    let balance: number;
    if (amount > 0) {
      balance = await incrementBalance(tx, organizationId, creditType, amount);
    } else {
      const { count } = await tx.creditBalance.updateMany({
        where: { organizationId, creditType, balance: { gte: -amount } },
        data: { balance: { decrement: -amount } },
      });
      if (count === 0) throw new InsufficientBalanceError();
      const row = await tx.creditBalance.findUniqueOrThrow({
        where: { organizationId_creditType: { organizationId, creditType } },
      });
      balance = row.balance;
    }

    await tx.creditLedgerEntry.create({
      data: {
        organizationId,
        creditType,
        amount,
        type: "MANUAL_ADJUSTMENT",
        idempotencyKey: `manual:${randomUUID()}`,
        userId: adminUserId,
        note,
      },
    });
    return { balance };
  });
}
