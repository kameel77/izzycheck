import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";
import { addCredits } from "../credits.ts";
import { createOrder, createOrg, createUser, resetDb, testPrisma } from "../../test-db/helpers.ts";

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

async function setup() {
  const org = await createOrg();
  const user = await createUser({ organizationId: org.id });
  const order = await createOrder({ organizationId: org.id, userId: user.id });
  return { org, user, order };
}

function args(ctx: Awaited<ReturnType<typeof setup>>, overrides: Partial<Parameters<typeof addCredits>[1]> = {}) {
  return {
    organizationId: ctx.org.id,
    creditType: "VALUATION" as const,
    amount: 10,
    idempotencyKey: `purchase:${ctx.order.id}:VALUATION`,
    userId: ctx.user.id,
    orderId: ctx.order.id,
    note: "Zakup online",
    ...overrides,
  };
}

test("addCredits adds the balance and writes a PURCHASE ledger entry linked to the order", async () => {
  const ctx = await setup();

  const result = await addCredits(testPrisma, args(ctx));
  assert.deepEqual(result, { added: true });
  assert.equal(await readBalance(ctx.org.id, "VALUATION"), 10);

  const entries = await testPrisma.creditLedgerEntry.findMany({ where: { organizationId: ctx.org.id } });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, "PURCHASE");
  assert.equal(entries[0].amount, 10);
  assert.equal(entries[0].creditType, "VALUATION");
  assert.equal(entries[0].orderId, ctx.order.id);
  assert.equal(entries[0].userId, ctx.user.id);
  assert.equal(entries[0].idempotencyKey, `purchase:${ctx.order.id}:VALUATION`);
  assert.equal(entries[0].note, "Zakup online");
});

test("addCredits is idempotent: the same key again returns added=false and leaves the balance unchanged", async () => {
  const ctx = await setup();

  assert.deepEqual(await addCredits(testPrisma, args(ctx)), { added: true });
  assert.deepEqual(await addCredits(testPrisma, args(ctx)), { added: false });

  assert.equal(await readBalance(ctx.org.id, "VALUATION"), 10);
  assert.equal(await testPrisma.creditLedgerEntry.count({ where: { organizationId: ctx.org.id } }), 1);
});

test("addCredits with the same key called 5x in parallel credits the balance exactly once", async () => {
  const ctx = await setup();

  const results = await Promise.all(Array.from({ length: 5 }, () => addCredits(testPrisma, args(ctx))));

  assert.equal(results.filter((r) => r.added).length, 1);
  assert.equal(await readBalance(ctx.org.id, "VALUATION"), 10);
  assert.equal(await testPrisma.creditLedgerEntry.count({ where: { organizationId: ctx.org.id } }), 1);
});

test("addCredits works inside a caller transaction and rolls back with it", async () => {
  const ctx = await setup();

  await assert.rejects(
    testPrisma.$transaction(async (tx) => {
      assert.deepEqual(await addCredits(tx, args(ctx)), { added: true });
      throw new Error("rollback");
    }),
    /rollback/,
  );

  assert.equal(await readBalance(ctx.org.id, "VALUATION"), 0);
  assert.equal(await testPrisma.creditLedgerEntry.count({ where: { organizationId: ctx.org.id } }), 0);
});

test("addCredits rejects a non-positive or fractional amount without touching the database", async () => {
  const ctx = await setup();

  for (const amount of [0, -1, 1.5, Number.NaN]) {
    await assert.rejects(addCredits(testPrisma, args(ctx, { amount })), /dodatnią liczbą całkowitą/);
  }

  assert.equal(await readBalance(ctx.org.id, "VALUATION"), 0);
  assert.equal(await testPrisma.creditLedgerEntry.count({ where: { organizationId: ctx.org.id } }), 0);
});

test("credit_ledger_entries.orderId is cleared (not blocked) when the order row is removed", async () => {
  const ctx = await setup();
  await addCredits(testPrisma, args(ctx));

  await testPrisma.order.delete({ where: { id: ctx.order.id } });

  const entry = await testPrisma.creditLedgerEntry.findFirstOrThrow({ where: { organizationId: ctx.org.id } });
  assert.equal(entry.orderId, null);
});

test("order_items cascade with their order but keep the package referenced", async () => {
  const ctx = await setup();
  const pkg = await testPrisma.creditPackage.create({
    data: { name: "Testowy pakiet", creditType: "VALUATION", credits: 1, priceNetGrosze: 2500 },
  });
  await testPrisma.orderItem.create({
    data: {
      orderId: ctx.order.id,
      packageId: pkg.id,
      packageName: pkg.name,
      creditType: "VALUATION",
      creditsPerPackage: 1,
      quantity: 1,
      unitNetGrosze: 2500,
      unitGrossGrosze: 3075,
      vatRate: 23,
      lineNetGrosze: 2500,
      lineVatGrosze: 575,
      lineGrossGrosze: 3075,
    },
  });

  await assert.rejects(testPrisma.creditPackage.delete({ where: { id: pkg.id } }), /Foreign key constraint/);
  await testPrisma.order.delete({ where: { id: ctx.order.id } });
  assert.equal(await testPrisma.orderItem.count(), 0);
});

test("credit migration seeds the starting price list: 6 active packages, net prices in grosze, VAT 23%", () => {
  // resetDb() czyści tabele, więc cennik sprawdzamy w SQL migracji.
  const sql = readFileSync(
    new URL("../../../prisma/migrations/20261029100000_credit_orders/migration.sql", import.meta.url),
    "utf8",
  );
  const insert = sql.slice(sql.indexOf('INSERT INTO "credit_packages"'));
  const rows = [...insert.matchAll(/\(gen_random_uuid\(\)::text,'([^']+)','(\w+)',(\d+),(\d+),(\d+),(true|false),(\d+),now\(\)\)/g)].map(
    (m) => ({
      name: m[1],
      creditType: m[2],
      credits: Number(m[3]),
      priceNet: Number(m[4]),
      vat: Number(m[5]),
      active: m[6] === "true",
      sortOrder: Number(m[7]),
    }),
  );

  assert.equal(rows.length, 6);
  assert.ok(rows.every((r) => r.active && r.vat === 23));
  assert.deepEqual(
    rows.map((r) => [r.creditType, r.credits, r.priceNet, r.sortOrder]),
    [
      ["CLAIM_DETAILS", 1, 4500, 10],
      ["CLAIM_DETAILS", 10, 42000, 20],
      ["CLAIM_DETAILS", 100, 390000, 30],
      ["VALUATION", 1, 2500, 10],
      ["VALUATION", 10, 22000, 20],
      ["VALUATION", 100, 190000, 30],
    ],
  );
});

test("addCredits rejects keys outside the purchase namespace (it always writes PURCHASE entries)", async () => {
  const ctx = await setup();

  for (const idempotencyKey of ["usage:r1:VALUATION", `manual:${ctx.order.id}`]) {
    await assert.rejects(addCredits(testPrisma, args(ctx, { idempotencyKey })), /purchase:\{orderId\}/);
  }

  assert.equal(await readBalance(ctx.org.id, "VALUATION"), 0);
  assert.equal(await testPrisma.creditLedgerEntry.count({ where: { organizationId: ctx.org.id } }), 0);
});
