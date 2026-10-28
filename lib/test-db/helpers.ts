import { randomUUID } from "node:crypto";
import {
  PrismaClient,
  type CreditType,
  type ModuleStatus,
  type ReportModuleId,
  type Role,
} from "@prisma/client";
import { assertTestDatabaseUrl } from "./guard.ts";

// Przed utworzeniem klienta: resetDb() robi TRUNCATE, nigdy na bazie innej niż *_test.
assertTestDatabaseUrl(process.env.DATABASE_URL);

export const testPrisma = new PrismaClient();

const MODULE_IDS: ReportModuleId[] = ["VALUATION", "CLAIM_CHECK", "CLAIM_DETAILS"];
const NIP_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7];

let nipCounter = 0;

/** Unikalny NIP z poprawną sumą kontrolną (wagi jak w lib/validators/nip.ts). */
function generateNip(): string {
  for (;;) {
    nipCounter += 1;
    const base = String(100000000 + ((Date.now() + nipCounter * 7919) % 899999999)).slice(0, 9);
    const sum = base.split("").reduce((acc, d, i) => acc + Number(d) * NIP_WEIGHTS[i], 0);
    const check = sum % 11;
    if (check !== 10) return base + check;
  }
}

export async function resetDb(): Promise<void> {
  const tables = await testPrisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await testPrisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);
}

export async function createOrg(
  opts: { billingMode?: "PREPAID" | "UNLIMITED" } = {},
): Promise<{ id: string }> {
  return testPrisma.organization.create({
    data: {
      name: `Test Org ${randomUUID().slice(0, 8)}`,
      nip: generateNip(),
      street: "ul. Testowa 1",
      postalCode: "00-001",
      city: "Warszawa",
      billingEmail: "test@example.com",
      ...(opts.billingMode ? { billingMode: opts.billingMode } : {}),
    },
    select: { id: true },
  });
}

export async function createUser(opts: {
  organizationId: string | null;
  role?: Role;
}): Promise<{ id: string }> {
  return testPrisma.user.create({
    data: {
      email: `user-${randomUUID()}@example.com`,
      name: "Test User",
      passwordHash: "not-a-real-hash",
      role: opts.role ?? "USER",
      organizationId: opts.organizationId,
    },
    select: { id: true },
  });
}

export async function createReport(opts: {
  organizationId: string | null;
  createdById: string;
  modules: Partial<Record<ReportModuleId, ModuleStatus>>;
  retryCount?: Partial<Record<ReportModuleId, number>>;
}): Promise<{ id: string }> {
  return testPrisma.report.create({
    data: {
      vin: "TESTVIN0000000000",
      firstRegistrationDate: "2020-01-01",
      valuationDate: "2026-10-28",
      createdById: opts.createdById,
      organizationId: opts.organizationId,
      moduleResults: {
        create: MODULE_IDS.map((moduleId) => ({
          moduleId,
          status: opts.modules[moduleId] ?? "NOT_REQUESTED",
          retryCount: opts.retryCount?.[moduleId] ?? 0,
        })),
      },
    },
    select: { id: true },
  });
}

export async function setBalance(
  organizationId: string,
  creditType: CreditType,
  balance: number,
): Promise<void> {
  await testPrisma.creditBalance.upsert({
    where: { organizationId_creditType: { organizationId, creditType } },
    update: { balance },
    create: { organizationId, creditType, balance },
  });
}
