import assert from "node:assert/strict";
import { after, beforeEach, describe, mock, test } from "node:test";
import { NonRetryableError, VinNotFoundError, type VehicleIdentificationRaw } from "../../../audatex/types.ts";
import { generateApiToken, hashApiToken, tokenPrefixOf } from "../../../api-clients/token.ts";
import { createOrg, resetDb, testPrisma } from "../../../test-db/helpers.ts";
import { handleVinIdentification, VIN_CACHE_TTL_MS, VIN_IDENTIFICATION_ENDPOINT } from "../service.ts";
import { parseVinXml } from "../parse.ts";
import { loadFixture, syntheticVin } from "../tests/fixtures.ts";

const VIN = syntheticVin("K");

beforeEach(async () => {
  await resetDb();
});

after(async () => {
  await testPrisma.$disconnect();
});

function fixtureRaw(): VehicleIdentificationRaw {
  const vinXml = loadFixture("bmw-420d.vin.xml");
  const parsed = parseVinXml(vinXml)!;
  return {
    ibsCode: parsed.ibsCode,
    fittedEquipmentCodes: parsed.fittedEquipmentCodes,
    vinXml,
    classificationXml: loadFixture("bmw-420d.cls.xml"),
  };
}

function stubIdentify(impl: (vin: string) => Promise<VehicleIdentificationRaw> = async () => fixtureRaw()) {
  const fn = mock.fn(impl);
  return { fn, identify: (vin: string) => fn(vin) };
}

async function createApiClient(opts: { isActive?: boolean; orgActive?: boolean } = {}) {
  const org = await createOrg();
  if (opts.orgActive === false) await testPrisma.organization.update({ where: { id: org.id }, data: { isActive: false } });
  const token = generateApiToken();
  const client = await testPrisma.apiClient.create({
    data: {
      name: "mamygo (test)",
      organizationId: org.id,
      tokenHash: hashApiToken(token),
      tokenPrefix: tokenPrefixOf(token),
      isActive: opts.isActive ?? true,
    },
  });
  return { org, client, token, authorization: `Bearer ${token}` };
}

/** Kopia klienta Prisma, w której wskazana metoda delegata (np. apiClient.update) rzuca błąd. */
function failingDelegate(delegate: "apiClient" | "apiUsage", method: string): typeof testPrisma {
  return new Proxy(testPrisma, {
    get(target, prop) {
      if (prop !== delegate) return Reflect.get(target, prop);
      const real = target[delegate] as unknown as Record<string, unknown>;
      return new Proxy(real, {
        get(inner, innerProp) {
          if (innerProp === method) {
            return async () => {
              throw new Error(`${delegate}.${method} padło`);
            };
          }
          const value = Reflect.get(inner, innerProp);
          return typeof value === "function" ? value.bind(inner) : value;
        },
      });
    },
  }) as typeof testPrisma;
}

const usageRows = (apiClientId: string) => testPrisma.apiUsage.findMany({ where: { apiClientId }, orderBy: { createdAt: "asc" } });

describe("handleVinIdentification: 200 i cache", () => {
  test("200 zapisuje IDENTIFIED/billable; drugi raz ten sam VIN to cacheHit, billable, bez wywołania Audatex", async () => {
    const { client, org, authorization } = await createApiClient();
    const { fn, identify } = stubIdentify();
    const deps = { db: testPrisma, identify };

    const first = await handleVinIdentification(deps, { authorization, body: { vin: VIN, country: "PL", language: "pl" } });
    assert.equal(first.status, 200);
    const body = first.body as Record<string, unknown>;
    assert.equal(body.vin, VIN);
    assert.equal(body.make, "BMW");
    assert.equal(body.drive, "All wheel drive");
    assert.equal((body.carFeaturesAdditionalWithId as unknown[]).length, 18);
    assert.equal(fn.mock.callCount(), 1);

    const second = await handleVinIdentification(deps, { authorization, body: { vin: VIN } });
    assert.equal(second.status, 200);
    assert.deepEqual(second.body, first.body);
    assert.equal(fn.mock.callCount(), 1, "drugie wywołanie nie może odpytywać Audatex");

    const rows = await usageRows(client.id);
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((r) => ({ outcome: r.outcome, httpStatus: r.httpStatus, billable: r.billable, cacheHit: r.cacheHit, vin: r.vin })),
      [
        { outcome: "IDENTIFIED", httpStatus: 200, billable: true, cacheHit: false, vin: VIN },
        { outcome: "IDENTIFIED", httpStatus: 200, billable: true, cacheHit: true, vin: VIN },
      ],
    );
    assert.equal(rows[0].endpoint, VIN_IDENTIFICATION_ENDPOINT);
    assert.equal(rows[0].organizationId, org.id);
    assert.equal(typeof rows[0].upstreamMs, "number");
    assert.equal(rows[1].upstreamMs, null);

    const cache = await testPrisma.vinIdentificationCache.findUnique({ where: { vin: VIN } });
    assert.equal(cache?.ibsCode, "965894");
    assert.equal(JSON.parse(cache!.fittedEquipmentCodes).length, 18);

    const refreshed = await testPrisma.apiClient.findUniqueOrThrow({ where: { id: client.id } });
    assert.ok(refreshed.lastUsedAt, "lastUsedAt powinno zostać zaktualizowane");
  });

  test("VIN w żądaniu jest normalizowany (małe litery, spacje), a cache jest po znormalizowanym VIN", async () => {
    const { authorization } = await createApiClient();
    const { fn, identify } = stubIdentify();
    const deps = { db: testPrisma, identify };

    await handleVinIdentification(deps, { authorization, body: { vin: `  ${VIN.toLowerCase()} ` } });
    await handleVinIdentification(deps, { authorization, body: { vin: VIN } });
    assert.equal(fn.mock.callCount(), 1);
    assert.deepEqual(fn.mock.calls[0].arguments, [VIN]);
  });

  test("cache starszy niż 30 dni jest odświeżany z Audatex", async () => {
    const { client, authorization } = await createApiClient();
    const staleNow = new Date("2026-10-28T12:00:00Z");
    const raw = fixtureRaw();
    await testPrisma.vinIdentificationCache.create({
      data: {
        vin: VIN,
        ibsCode: "old",
        fittedEquipmentCodes: "[]",
        vinXml: "old",
        classificationXml: loadFixture("kia-sportage.cls.xml"),
        fetchedAt: new Date(staleNow.getTime() - VIN_CACHE_TTL_MS - 60_000),
      },
    });
    const { fn, identify } = stubIdentify(async () => raw);

    const res = await handleVinIdentification({ db: testPrisma, identify, now: () => staleNow }, { authorization, body: { vin: VIN } });

    assert.equal(res.status, 200);
    assert.equal((res.body as Record<string, unknown>).make, "BMW");
    assert.equal(fn.mock.callCount(), 1);
    const cache = await testPrisma.vinIdentificationCache.findUniqueOrThrow({ where: { vin: VIN } });
    assert.equal(cache.ibsCode, "965894");
    assert.equal(cache.fetchedAt.getTime(), staleNow.getTime());
    assert.equal((await usageRows(client.id))[0].cacheHit, false);
  });

  test("świeży cache (29 dni) jest używany", async () => {
    const { authorization } = await createApiClient();
    const now = new Date("2026-10-28T12:00:00Z");
    const raw = fixtureRaw();
    await testPrisma.vinIdentificationCache.create({
      data: {
        vin: VIN,
        ibsCode: raw.ibsCode,
        fittedEquipmentCodes: JSON.stringify(raw.fittedEquipmentCodes),
        vinXml: raw.vinXml,
        classificationXml: raw.classificationXml,
        fetchedAt: new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000),
      },
    });
    const { fn, identify } = stubIdentify();
    const res = await handleVinIdentification({ db: testPrisma, identify, now: () => now }, { authorization, body: { vin: VIN } });
    assert.equal(res.status, 200);
    assert.equal(fn.mock.callCount(), 0);
  });
});

describe("handleVinIdentification: błędy Audatex", () => {
  test("404: VinNotFoundError -> VIN_NOT_FOUND, NOT_FOUND, nie billable, bez cache", async () => {
    const { client, authorization } = await createApiClient();
    const { identify } = stubIdentify(async () => {
      throw new VinNotFoundError();
    });

    const res = await handleVinIdentification({ db: testPrisma, identify }, { authorization, body: { vin: VIN } });

    assert.equal(res.status, 404);
    assert.equal((res.body as { error: string }).error, "VIN_NOT_FOUND");
    const [row] = await usageRows(client.id);
    assert.equal(row.outcome, "NOT_FOUND");
    assert.equal(row.httpStatus, 404);
    assert.equal(row.billable, false);
    assert.equal(row.cacheHit, false);
    assert.equal(await testPrisma.vinIdentificationCache.count(), 0, "404 nie jest cache'owane");
  });

  test("502: NonRetryableError i timeout -> UPSTREAM_ERROR, nie billable, bez cache", async () => {
    const { client, authorization } = await createApiClient();
    const errors = [new NonRetryableError("AUDATEX_VALUATION_ERROR: HTTP 401"), new Error("AUDATEX_TIMEOUT_ERROR: timeout")];
    for (const error of errors) {
      const { identify } = stubIdentify(async () => {
        throw error;
      });
      const res = await handleVinIdentification({ db: testPrisma, identify }, { authorization, body: { vin: VIN } });
      assert.equal(res.status, 502);
      assert.equal((res.body as { error: string }).error, "UPSTREAM_ERROR");
    }
    const rows = await usageRows(client.id);
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.outcome, "UPSTREAM_ERROR");
      assert.equal(row.httpStatus, 502);
      assert.equal(row.billable, false);
    }
    assert.equal(await testPrisma.vinIdentificationCache.count(), 0);
  });

  test("500: błąd wewnętrzny (uszkodzony cache) -> INTERNAL_ERROR, nie billable", async () => {
    const { client, authorization } = await createApiClient();
    await testPrisma.vinIdentificationCache.create({
      data: { vin: VIN, ibsCode: "1", fittedEquipmentCodes: "to-nie-json", vinXml: "x", classificationXml: "x", fetchedAt: new Date() },
    });
    const { identify } = stubIdentify();
    mock.method(console, "error", () => {});
    try {
      const res = await handleVinIdentification({ db: testPrisma, identify }, { authorization, body: { vin: VIN } });
      assert.equal(res.status, 500);
      assert.equal((res.body as { error: string }).error, "INTERNAL_ERROR");
    } finally {
      mock.restoreAll();
    }
    const [row] = await usageRows(client.id);
    assert.equal(row.outcome, "INTERNAL_ERROR");
    assert.equal(row.billable, false);
  });

  test("VIN nie trafia do logów aplikacji (console.*), także gdy błąd go zawiera", async () => {
    const { authorization } = await createApiClient();
    const { identify } = stubIdentify(async () => {
      throw new Error(`Audatex odrzucił VIN ${VIN}`);
    });
    const logged: unknown[][] = [];
    for (const method of ["error", "warn", "log", "info"] as const) {
      mock.method(console, method, (...args: unknown[]) => {
        logged.push(args);
      });
    }
    try {
      await handleVinIdentification({ db: testPrisma, identify }, { authorization, body: { vin: VIN } });
      await handleVinIdentification({ db: testPrisma, identify }, { authorization: "Bearer zly", body: { vin: VIN } });
    } finally {
      mock.restoreAll();
    }
    assert.ok(logged.length >= 2, "oczekiwano logu błędu i ostrzeżenia o 401");
    assert.equal(JSON.stringify(logged).includes(VIN), false);
  });
});

describe("handleVinIdentification: autoryzacja", () => {
  test("nieaktywny klient -> 401 UNAUTHORIZED bez wpisu w ApiUsage", async () => {
    const { authorization } = await createApiClient({ isActive: false });
    const { fn, identify } = stubIdentify();
    mock.method(console, "warn", () => {});
    try {
      const res = await handleVinIdentification({ db: testPrisma, identify }, { authorization, body: { vin: VIN } });
      assert.equal(res.status, 401);
      assert.equal((res.body as { error: string }).error, "UNAUTHORIZED");
    } finally {
      mock.restoreAll();
    }
    assert.equal(await testPrisma.apiUsage.count(), 0);
    assert.equal(fn.mock.callCount(), 0);
  });

  test("brak nagłówka, nieznany token i nieaktywna organizacja -> 401 bez wpisu", async () => {
    const inactiveOrg = await createApiClient({ orgActive: false });
    const { identify } = stubIdentify();
    mock.method(console, "warn", () => {});
    try {
      for (const authorization of [null, "Bearer izc_nieznany", "Token abc", inactiveOrg.authorization]) {
        const res = await handleVinIdentification({ db: testPrisma, identify }, { authorization, body: { vin: VIN } });
        assert.equal(res.status, 401);
      }
    } finally {
      mock.restoreAll();
    }
    assert.equal(await testPrisma.apiUsage.count(), 0);
  });
});

describe("handleVinIdentification: walidacja i limity", () => {
  test("400 INVALID_REQUEST -> wpis REJECTED z VIN obciętym do 32 znaków, nie billable", async () => {
    const { client, authorization } = await createApiClient();
    const { fn, identify } = stubIdentify();
    const deps = { db: testPrisma, identify };

    const tooLong = "x".repeat(50);
    const cases: unknown[] = [{ vin: tooLong }, { vin: VIN, country: "DE" }, { vin: VIN, language: "en" }, null, { vin: 5 }];
    for (const body of cases) {
      const res = await handleVinIdentification(deps, { authorization, body });
      assert.equal(res.status, 400);
      assert.equal((res.body as { error: string }).error, "INVALID_REQUEST");
    }

    const rows = await usageRows(client.id);
    assert.equal(rows.length, cases.length);
    for (const row of rows) {
      assert.equal(row.outcome, "REJECTED");
      assert.equal(row.httpStatus, 400);
      assert.equal(row.billable, false);
    }
    assert.equal(rows[0].vin, "X".repeat(32));
    assert.equal(rows[1].vin, VIN);
    assert.equal(rows[3].vin, null);
    assert.equal(rows[4].vin, null);
    assert.equal(fn.mock.callCount(), 0);
  });

  test("429 po 60 żądaniach na minutę na klienta; wpis REJECTED; limit jest per klient", async () => {
    const limited = await createApiClient();
    const other = await createApiClient();
    const { fn, identify } = stubIdentify();
    const deps = { db: testPrisma, identify };

    for (let i = 0; i < 60; i += 1) {
      const res = await handleVinIdentification(deps, { authorization: limited.authorization, body: { vin: VIN } });
      assert.equal(res.status, 200);
    }
    const res = await handleVinIdentification(deps, { authorization: limited.authorization, body: { vin: VIN } });
    assert.equal(res.status, 429);
    assert.equal((res.body as { error: string }).error, "RATE_LIMITED");
    assert.ok(Number(res.headers?.["Retry-After"]) >= 1);

    const rows = await usageRows(limited.client.id);
    assert.equal(rows.length, 61);
    const last = rows[rows.length - 1];
    assert.equal(last.outcome, "REJECTED");
    assert.equal(last.httpStatus, 429);
    assert.equal(last.billable, false);
    assert.equal(fn.mock.callCount(), 1, "reszta z cache");

    const otherRes = await handleVinIdentification(deps, { authorization: other.authorization, body: { vin: VIN } });
    assert.equal(otherRes.status, 200);
  });

  test("błąd zapisu ApiUsage nie zmienia odpowiedzi, ale jest logowany", async () => {
    const { client, authorization } = await createApiClient();
    const { identify } = stubIdentify();
    const errorLog = mock.method(console, "error", () => {});
    try {
      const res = await handleVinIdentification(
        { db: failingDelegate("apiUsage", "create"), identify },
        { authorization, body: { vin: VIN } },
      );
      assert.equal(res.status, 200);
      assert.equal(errorLog.mock.calls.some((call) => String(call.arguments[0]).includes("API_USAGE_LOG_ERROR")), true);
    } finally {
      mock.restoreAll();
    }
    assert.equal((await usageRows(client.id)).length, 0);
  });

  test("błąd aktualizacji lastUsedAt nie odbiera wpisu rozliczeniowego ApiUsage", async () => {
    const { client, authorization } = await createApiClient();
    const { identify } = stubIdentify();
    const errorLog = mock.method(console, "error", () => {});
    try {
      const res = await handleVinIdentification(
        { db: failingDelegate("apiClient", "update"), identify },
        { authorization, body: { vin: VIN } },
      );
      assert.equal(res.status, 200);
      assert.equal(errorLog.mock.calls.some((call) => String(call.arguments[0]).includes("API_CLIENT_TOUCH_ERROR")), true);
    } finally {
      mock.restoreAll();
    }
    const rows = await usageRows(client.id);
    assert.equal(rows.length, 1, "wpis rozliczeniowy musi istnieć mimo błędu lastUsedAt");
    assert.equal(rows[0].outcome, "IDENTIFIED");
    assert.equal(rows[0].billable, true);
    assert.equal((await testPrisma.apiClient.findUniqueOrThrow({ where: { id: client.id } })).lastUsedAt, null);
  });

  test("niespodziewany błąd autoryzacji -> 500 INTERNAL_ERROR, bez wpisu ApiUsage, bez tokenu i VIN w logach", async () => {
    const { token } = await createApiClient();
    const { fn, identify } = stubIdentify();
    const logged: unknown[][] = [];
    for (const method of ["error", "warn"] as const) {
      mock.method(console, method, (...args: unknown[]) => {
        logged.push(args);
      });
    }
    // Błąd zawiera zarówno token, jak i VIN (np. echo zapytania w komunikacie sterownika).
    const brokenDb = {
      apiClient: {
        findUnique: async () => {
          throw new Error(`connection lost near ${token} / ${VIN}`);
        },
      },
    } as unknown as typeof testPrisma;
    try {
      const res = await handleVinIdentification(
        { db: brokenDb, identify },
        { authorization: `Bearer ${token}`, body: { vin: VIN } },
      );
      assert.equal(res.status, 500);
      assert.equal((res.body as { error: string }).error, "INTERNAL_ERROR");
    } finally {
      mock.restoreAll();
    }
    assert.ok(logged.length >= 1);
    const serialized = JSON.stringify(logged);
    assert.equal(serialized.includes(VIN), false, "VIN w logach");
    assert.equal(serialized.includes(token), false, "token w logach");
    assert.equal(fn.mock.callCount(), 0);
    assert.equal(await testPrisma.apiUsage.count(), 0);
  });
});

describe("handleVinIdentification: tryb mock (useCache=false)", () => {
  test("nie czyta i nie zapisuje cache, ale loguje ApiUsage jak zwykle", async () => {
    const { client, authorization } = await createApiClient();
    const raw = fixtureRaw();
    // Cache z innym autem pod tym samym VIN: tryb mock ma go zignorować.
    await testPrisma.vinIdentificationCache.create({
      data: {
        vin: VIN,
        ibsCode: "stary",
        fittedEquipmentCodes: "[]",
        vinXml: "x",
        classificationXml: loadFixture("kia-sportage.cls.xml"),
        fetchedAt: new Date(),
      },
    });
    const { fn, identify } = stubIdentify(async () => raw);
    const deps = { db: testPrisma, identify, useCache: false };

    for (let i = 0; i < 2; i += 1) {
      const res = await handleVinIdentification(deps, { authorization, body: { vin: VIN } });
      assert.equal(res.status, 200);
      assert.equal((res.body as Record<string, unknown>).make, "BMW", "wynik z identify, nie z cache");
    }
    assert.equal(fn.mock.callCount(), 2, "bez cache każde żądanie woła identify");

    const cache = await testPrisma.vinIdentificationCache.findMany();
    assert.equal(cache.length, 1);
    assert.equal(cache[0].ibsCode, "stary", "istniejący wpis nie został nadpisany");

    const rows = await usageRows(client.id);
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.outcome, "IDENTIFIED");
      assert.equal(row.billable, true);
      assert.equal(row.cacheHit, false);
    }
  });

  test("tryb mock nie tworzy wpisu cache dla nowego VIN", async () => {
    const { authorization } = await createApiClient();
    const { identify } = stubIdentify();
    await handleVinIdentification({ db: testPrisma, identify, useCache: false }, { authorization, body: { vin: VIN } });
    assert.equal(await testPrisma.vinIdentificationCache.count(), 0);
  });
});
