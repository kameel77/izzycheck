/**
 * Prepaid report credits (per organization, per credit type).
 *
 * Money-critical rules: a balance only ever decreases through a conditional updateMany (`balance >= n`),
 * and a hold changes status only through a conditional updateMany on its current status, acting only when
 * `count === 1`. All functions taking `tx` also work with a client outside a transaction.
 */
import { randomUUID } from "node:crypto";
import type {
  BillingMode,
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

export async function releaseStaleHolds(tx: Db, organizationId: string, staleBefore: Date): Promise<number> {
  const stale = await tx.creditHold.findMany({
    where: { organizationId, status: "HELD", updatedAt: { lt: staleBefore } },
  });
  let released = 0;
  for (const hold of stale) {
    const { count } = await tx.creditHold.updateMany({
      where: { id: hold.id, status: "HELD" },
      data: { status: "RELEASED" },
    });
    if (count === 1) {
      await incrementBalance(tx, hold.organizationId, hold.creditType, 1);
      released += 1;
    }
  }
  return released;
}

export async function reserveCredit(
  tx: Db,
  args: {
    organizationId: string;
    reportId: string;
    moduleId: ReportModuleId;
    creditType: CreditType;
    staleBefore: Date;
  },
): Promise<{ reused: boolean }> {
  const { organizationId, reportId, moduleId, creditType, staleBefore } = args;

  await releaseStaleHolds(tx, organizationId, staleBefore);

  // Existing live hold: refresh updatedAt so it is not treated as stale, charge nothing again.
  const refreshed = await tx.creditHold.updateMany({
    where: { reportId, moduleId, status: "HELD" },
    data: { updatedAt: new Date() },
  });
  if (refreshed.count === 1) return { reused: true };

  if (!(await tryDecrementBalance(tx, organizationId, creditType))) {
    throw new NoCreditsError(creditType);
  }

  await tx.creditHold.upsert({
    where: { reportId_moduleId: { reportId, moduleId } },
    update: { organizationId, creditType, status: "HELD" },
    create: { organizationId, reportId, moduleId, creditType, status: "HELD" },
  });
  return { reused: false };
}

export async function captureCredit(
  tx: Db,
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

  const { count } = await tx.creditHold.updateMany({
    where: { reportId, moduleId, status: "HELD" },
    data: { status: "CAPTURED" },
  });
  if (count === 1) {
    await tx.creditLedgerEntry.create({
      data: { organizationId, creditType, amount: -1, type: "USAGE", idempotencyKey, reportId, moduleId, userId },
    });
    return "CAPTURED";
  }

  const existing = await tx.creditLedgerEntry.findUnique({ where: { idempotencyKey } });
  if (existing) return "ALREADY_CAPTURED";

  // The hold was released as stale before the module finished: charge now if the balance allows.
  const charged = await tryDecrementBalance(tx, organizationId, creditType);
  await tx.creditLedgerEntry.create({
    data: {
      organizationId,
      creditType,
      amount: charged ? -1 : 0,
      type: "USAGE",
      idempotencyKey,
      reportId,
      moduleId,
      userId,
      note: charged
        ? "Pobrano po zwolnieniu przeterminowanej rezerwacji"
        : "Nie pobrano: brak salda po przeterminowanej rezerwacji",
    },
  });
  await tx.creditHold.upsert({
    where: { reportId_moduleId: { reportId, moduleId } },
    update: { status: "CAPTURED" },
    create: { organizationId, reportId, moduleId, creditType, status: "CAPTURED" },
  });
  return charged ? "CAPTURED_LATE" : "FREE_LATE";
}

export async function releaseCredit(tx: Db, args: { reportId: string; moduleId: ReportModuleId }): Promise<boolean> {
  const { reportId, moduleId } = args;
  const hold = await tx.creditHold.findUnique({ where: { reportId_moduleId: { reportId, moduleId } } });
  if (!hold) return false;

  const { count } = await tx.creditHold.updateMany({
    where: { id: hold.id, status: "HELD" },
    data: { status: "RELEASED" },
  });
  if (count !== 1) return false;

  await incrementBalance(tx, hold.organizationId, hold.creditType, 1);
  return true;
}

export async function recordUnlimitedUsage(
  tx: Db,
  args: {
    organizationId: string;
    reportId: string;
    moduleId: ReportModuleId;
    creditType: CreditType;
    userId: string;
  },
): Promise<void> {
  const { organizationId, reportId, moduleId, creditType, userId } = args;
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
