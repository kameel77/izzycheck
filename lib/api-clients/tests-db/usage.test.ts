import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";
import type { ApiUsageOutcome } from "@prisma/client";
import { createOrg, resetDb, testPrisma } from "../../test-db/helpers.ts";
import { authenticateApiClient } from "../auth.ts";
import { exportApiUsageCsv, getApiUsageSummary } from "../usage.ts";
import { generateApiToken, hashApiToken, tokenPrefixOf } from "../token.ts";

beforeEach(async () => {
  await resetDb();
});

after(async () => {
  await testPrisma.$disconnect();
});

async function createClient(organizationId: string) {
  const token = generateApiToken();
  const client = await testPrisma.apiClient.create({
    data: { name: "klient", organizationId, tokenHash: hashApiToken(token), tokenPrefix: tokenPrefixOf(token) },
  });
  return { client, token };
}

async function addUsage(opts: {
  apiClientId: string;
  organizationId: string;
  createdAt: string;
  outcome?: ApiUsageOutcome;
  billable?: boolean;
  cacheHit?: boolean;
  vin?: string | null;
}) {
  const outcome = opts.outcome ?? "IDENTIFIED";
  await testPrisma.apiUsage.create({
    data: {
      apiClientId: opts.apiClientId,
      organizationId: opts.organizationId,
      endpoint: "POST /api/v1/vehicles/vin-identification",
      vin: opts.vin === undefined ? "ZZZZZZZZZK0000000" : opts.vin,
      httpStatus: outcome === "IDENTIFIED" ? 200 : 400,
      outcome,
      billable: opts.billable ?? outcome === "IDENTIFIED",
      cacheHit: opts.cacheHit ?? false,
      createdAt: new Date(opts.createdAt),
    },
  });
}

describe("getApiUsageSummary", () => {
  test("liczy tylko billable z danej organizacji i miesiąca (granice w czasie polskim)", async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    const a = await createClient(orgA.id);
    const b = await createClient(orgB.id);
    const base = { apiClientId: a.client.id, organizationId: orgA.id };

    // Kwiecień 2026 w PL: od 2026-03-31 22:00 UTC do 2026-04-30 22:00 UTC.
    await addUsage({ ...base, createdAt: "2026-03-31T21:59:59Z" }); // jeszcze marzec
    await addUsage({ ...base, createdAt: "2026-03-31T22:00:00Z" }); // pierwsza sekunda kwietnia
    await addUsage({ ...base, createdAt: "2026-03-31T23:30:00Z", cacheHit: true }); // kwiecień (PL), billable z cache
    await addUsage({ ...base, createdAt: "2026-04-15T10:00:00Z", outcome: "NOT_FOUND" });
    await addUsage({ ...base, createdAt: "2026-04-15T11:00:00Z", outcome: "REJECTED", vin: null });
    await addUsage({ ...base, createdAt: "2026-04-30T21:59:59Z", outcome: "UPSTREAM_ERROR" });
    await addUsage({ ...base, createdAt: "2026-04-30T22:00:00Z" }); // już maj
    await addUsage({ apiClientId: b.client.id, organizationId: orgB.id, createdAt: "2026-04-15T10:00:00Z" }); // inna organizacja

    const april = await getApiUsageSummary(testPrisma, orgA.id, "2026-04");
    assert.equal(april.billableCount, 2);
    assert.equal(april.totalCount, 5);
    assert.deepEqual(april.byOutcome, { IDENTIFIED: 2, NOT_FOUND: 1, UPSTREAM_ERROR: 1, REJECTED: 1, INTERNAL_ERROR: 0 });

    const march = await getApiUsageSummary(testPrisma, orgA.id, "2026-03");
    assert.equal(march.billableCount, 1);
    assert.equal(march.totalCount, 1);

    const may = await getApiUsageSummary(testPrisma, orgA.id, "2026-05");
    assert.equal(may.billableCount, 1);

    const other = await getApiUsageSummary(testPrisma, orgB.id, "2026-04");
    assert.equal(other.billableCount, 1);
    assert.equal(other.totalCount, 1);
  });

  test("pusty miesiąc daje zera", async () => {
    const org = await createOrg();
    const summary = await getApiUsageSummary(testPrisma, org.id, "2026-04");
    assert.deepEqual(summary, {
      organizationId: org.id,
      month: "2026-04",
      billableCount: 0,
      totalCount: 0,
      byOutcome: { IDENTIFIED: 0, NOT_FOUND: 0, UPSTREAM_ERROR: 0, REJECTED: 0, INTERNAL_ERROR: 0 },
    });
  });
});

describe("exportApiUsageCsv", () => {
  test("eksportuje tylko wiersze organizacji z miesiąca, w czasie polskim, rosnąco po dacie", async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    const a = await createClient(orgA.id);
    const b = await createClient(orgB.id);
    const base = { apiClientId: a.client.id, organizationId: orgA.id };

    await addUsage({ ...base, createdAt: "2026-04-15T11:00:00Z", outcome: "REJECTED", vin: null });
    await addUsage({ ...base, createdAt: "2026-03-31T23:30:00Z", cacheHit: true });
    await addUsage({ ...base, createdAt: "2026-03-31T21:59:59Z" }); // marzec
    await addUsage({ apiClientId: b.client.id, organizationId: orgB.id, createdAt: "2026-04-15T10:00:00Z" });

    const csv = await exportApiUsageCsv(testPrisma, orgA.id, "2026-04");
    assert.equal(
      csv,
      "﻿" +
        [
          "data;vin;wynik;status_http;platny;z_cache",
          "2026-04-01 01:30:00;ZZZZZZZZZK0000000;IDENTIFIED;200;tak;tak",
          "2026-04-15 13:00:00;;REJECTED;400;nie;nie",
          "",
        ].join("\r\n"),
    );
  });
});

describe("authenticateApiClient", () => {
  test("aktywny klient po tokenie; nieaktywny klient i nieaktywna organizacja są odrzucani", async () => {
    const org = await createOrg();
    const { client, token } = await createClient(org.id);

    assert.deepEqual(await authenticateApiClient(testPrisma, `Bearer ${token}`), { id: client.id, organizationId: org.id });
    assert.equal(await authenticateApiClient(testPrisma, `Bearer ${token}x`), null);

    await testPrisma.apiClient.update({ where: { id: client.id }, data: { isActive: false } });
    assert.equal(await authenticateApiClient(testPrisma, `Bearer ${token}`), null);

    await testPrisma.apiClient.update({ where: { id: client.id }, data: { isActive: true } });
    await testPrisma.organization.update({ where: { id: org.id }, data: { isActive: false } });
    assert.equal(await authenticateApiClient(testPrisma, `Bearer ${token}`), null);
  });
});
