import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";
import { Prisma } from "@prisma/client";
import { createOrg, resetDb, setBalance, testPrisma } from "./helpers.ts";

beforeEach(async () => {
  await resetDb();
});

after(async () => {
  await testPrisma.$disconnect();
});

test("migration marks pre-existing organizations as UNLIMITED and new ones default to PREPAID", async () => {
  // Wiersze sprzed migracji nie istnieją w czystej bazie testowej, więc sprawdzamy SQL migracji.
  const sql = readFileSync(
    new URL("../../prisma/migrations/20261028120000_add_credits/migration.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /UPDATE "organizations" SET "billingMode" = 'UNLIMITED';/);

  const org = await createOrg();
  const row = await testPrisma.organization.findUniqueOrThrow({ where: { id: org.id } });
  assert.equal(row.billingMode, "PREPAID");
});

test("credit_balances enforces one row per organization and credit type", async () => {
  const org = await createOrg();
  await setBalance(org.id, "VALUATION", 5);

  await assert.rejects(
    testPrisma.creditBalance.create({
      data: { organizationId: org.id, creditType: "VALUATION", balance: 1 },
    }),
    (err: unknown) =>
      err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002",
  );
});
