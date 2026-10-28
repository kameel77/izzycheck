import assert from "node:assert/strict";
import { mock, test } from "node:test";
import {
  FakturowniaError,
  buildInvoicePayload,
  createFakturowniaClient,
  getFakturowniaConfig,
  getSharedFakturowniaClient,
  type FakturowniaConfig,
} from "../fakturownia.ts";

const TOKEN = "secret-api-token-XYZ123";

const config: FakturowniaConfig = { domain: "izzy-test", apiToken: TOKEN, departmentId: null };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Call = { url: string; init: RequestInit };

function mockFetch(handler: (call: Call, index: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return handler(call, calls.length - 1);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const organization = {
  name: "Auto Serwis Sp. z o.o.",
  nip: "5252445767",
  street: "ul. Nowa 44",
  postalCode: "30-314",
  city: "Kraków",
  country: "PL",
  billingEmail: "faktury@serwis.example",
};

const order = {
  id: "7f0a1c9e-1111-4222-8333-444455556666",
  paidAt: new Date("2026-10-28T10:15:00.000Z"),
  totalGrossGrosze: 51660,
  items: [
    { packageName: "Pakiet wycen 10", quantity: 2, vatRate: 23, lineGrossGrosze: 49200 },
    { packageName: "Pakiet szczegółów szkód 1", quantity: 1, vatRate: 23, lineGrossGrosze: 2460 },
  ],
};

const issueDate = new Date("2026-10-29T08:00:00.000Z");

const validInvoice = buildInvoicePayload(order, organization, null, issueDate);

// --- getFakturowniaConfig ---

const fullEnv = {
  FAKTUROWNIA_DOMAIN: "izzy-test",
  FAKTUROWNIA_API_TOKEN: TOKEN,
  FAKTUROWNIA_DEPARTMENT_ID: "42",
};

test("getFakturowniaConfig: reads and trims env, parses department id", () => {
  assert.deepEqual(getFakturowniaConfig({ ...fullEnv, FAKTUROWNIA_DOMAIN: "  izzy-test ", FAKTUROWNIA_API_TOKEN: ` ${TOKEN} ` }), {
    domain: "izzy-test",
    apiToken: TOKEN,
    departmentId: 42,
  });
});

test("getFakturowniaConfig: department id is optional", () => {
  const { FAKTUROWNIA_DEPARTMENT_ID: _omit, ...rest } = fullEnv;
  assert.equal(getFakturowniaConfig(rest)?.departmentId, null);
  assert.equal(getFakturowniaConfig({ ...rest, FAKTUROWNIA_DEPARTMENT_ID: "  " })?.departmentId, null);
});

test("getFakturowniaConfig: null when domain or token is missing or blank", () => {
  assert.equal(getFakturowniaConfig({}), null);
  assert.equal(getFakturowniaConfig({ ...fullEnv, FAKTUROWNIA_DOMAIN: undefined }), null);
  assert.equal(getFakturowniaConfig({ ...fullEnv, FAKTUROWNIA_DOMAIN: "  " }), null);
  assert.equal(getFakturowniaConfig({ ...fullEnv, FAKTUROWNIA_API_TOKEN: undefined }), null);
  assert.equal(getFakturowniaConfig({ ...fullEnv, FAKTUROWNIA_API_TOKEN: "" }), null);
});

test("getFakturowniaConfig: lowercases the domain before validation", () => {
  assert.equal(getFakturowniaConfig({ ...fullEnv, FAKTUROWNIA_DOMAIN: " Izzy-Test " })?.domain, "izzy-test");
});

test("getFakturowniaConfig: rejects domains that are not a bare subdomain", () => {
  const errorLog = mock.method(console, "error", () => {});
  try {
    for (const bad of [
      "izzy.fakturownia.pl",
      "evil.com/x",
      "evil.com#",
      "a b",
      "izzy_test",
      "https://izzy",
      "izzy@evil.com",
      "izzy:443",
    ]) {
      assert.equal(getFakturowniaConfig({ ...fullEnv, FAKTUROWNIA_DOMAIN: bad }), null, bad);
    }
  } finally {
    errorLog.mock.restore();
  }
});

test("getFakturowniaConfig: an invalid department id disables the config (fail closed)", () => {
  const errorLog = mock.method(console, "error", () => {});
  try {
    for (const bad of ["abc", "1.5", "-3", "0", "4 2"]) {
      assert.equal(getFakturowniaConfig({ ...fullEnv, FAKTUROWNIA_DEPARTMENT_ID: bad }), null, bad);
    }
  } finally {
    errorLog.mock.restore();
  }
});

test("getFakturowniaConfig: logs a set-but-invalid domain or department id once, without the value", () => {
  const errorLog = mock.method(console, "error", () => {});
  try {
    const badDomain = { ...fullEnv, FAKTUROWNIA_DOMAIN: "log-test.evil.com/secret-part" };
    getFakturowniaConfig(badDomain);
    getFakturowniaConfig(badDomain);
    const badDepartment = { ...fullEnv, FAKTUROWNIA_DEPARTMENT_ID: "dept-log-test" };
    getFakturowniaConfig(badDepartment);
    getFakturowniaConfig(badDepartment);
    assert.deepEqual(
      errorLog.mock.calls.map((c) => c.arguments),
      [
        ["[FAKTUROWNIA_CONFIG_INVALID]", { field: "FAKTUROWNIA_DOMAIN" }],
        ["[FAKTUROWNIA_CONFIG_INVALID]", { field: "FAKTUROWNIA_DEPARTMENT_ID" }],
      ],
    );
    // Missing/blank values are "not configured", not "invalid": no log.
    errorLog.mock.resetCalls();
    getFakturowniaConfig({});
    getFakturowniaConfig({ ...fullEnv, FAKTUROWNIA_DOMAIN: " " });
    assert.equal(errorLog.mock.callCount(), 0);
  } finally {
    errorLog.mock.restore();
  }
});

test("getSharedFakturowniaClient: null when unconfigured, cached per config, rebuilt on change", () => {
  assert.equal(getSharedFakturowniaClient({}), null);
  const a = getSharedFakturowniaClient(fullEnv);
  assert.ok(a);
  assert.equal(getSharedFakturowniaClient({ ...fullEnv }), a);
  const b = getSharedFakturowniaClient({ ...fullEnv, FAKTUROWNIA_API_TOKEN: "other-token" });
  assert.ok(b);
  assert.notEqual(b, a);
  assert.equal(getSharedFakturowniaClient({ ...fullEnv, FAKTUROWNIA_API_TOKEN: "other-token" }), b);
});

// --- buildInvoicePayload ---

test("buildInvoicePayload: sets invoice, buyer and position fields", () => {
  assert.deepEqual(validInvoice, {
    kind: "vat",
    status: "paid",
    paid: "516.60",
    payment_type: "payu",
    issue_date: "2026-10-29",
    sell_date: "2026-10-28",
    currency: "PLN",
    lang: "pl",
    oid: order.id,
    oid_unique: "yes",
    calculating_strategy: { position: "keep_gross", sum: "keep_gross" },
    buyer_name: "Auto Serwis Sp. z o.o.",
    buyer_tax_no: "5252445767",
    buyer_street: "ul. Nowa 44",
    buyer_post_code: "30-314",
    buyer_city: "Kraków",
    buyer_country: "PL",
    buyer_email: "faktury@serwis.example",
    buyer_company: true,
    positions: [
      { name: "Pakiet wycen 10", quantity: 2, tax: 23, total_price_gross: "492.00" },
      { name: "Pakiet szczegółów szkód 1", quantity: 1, tax: 23, total_price_gross: "24.60" },
    ],
  });
});

test("buildInvoicePayload: position gross sum equals the order gross", () => {
  const sum = validInvoice.positions.reduce((acc, p) => acc + Math.round(Number(p.total_price_gross) * 100), 0);
  assert.equal(sum, order.totalGrossGrosze);
  assert.equal(validInvoice.paid, "516.60");
});

test("buildInvoicePayload: sell_date uses the Europe/Warsaw calendar day of paidAt", () => {
  // 23:30 UTC on 28 Oct is already 00:30 on 29 Oct in Warsaw (CET, UTC+1).
  const late = buildInvoicePayload({ ...order, paidAt: new Date("2026-10-28T23:30:00.000Z") }, organization, null, issueDate);
  assert.equal(late.sell_date, "2026-10-29");
  // 22:30 UTC on 28 Oct is 23:30 in Warsaw: still the 28th.
  const early = buildInvoicePayload({ ...order, paidAt: new Date("2026-10-28T22:30:00.000Z") }, organization, null, issueDate);
  assert.equal(early.sell_date, "2026-10-28");
  // Summer time (CEST, UTC+2): 22:30 UTC on 30 Jun is 00:30 on 1 Jul.
  const summer = buildInvoicePayload({ ...order, paidAt: new Date("2026-06-30T22:30:00.000Z") }, organization, null, issueDate);
  assert.equal(summer.sell_date, "2026-07-01");
});

test("buildInvoicePayload: issue_date uses the Europe/Warsaw calendar day of issueDate", () => {
  const inv = buildInvoicePayload(order, organization, null, new Date("2026-10-29T23:30:00.000Z"));
  assert.equal(inv.issue_date, "2026-10-30");
});

test("buildInvoicePayload: department_id only when set", () => {
  assert.equal("department_id" in validInvoice, false);
  const withDept = buildInvoicePayload(order, organization, 42, issueDate);
  assert.equal(withDept.department_id, 42);
});

test("buildInvoicePayload: formats grosze with integer arithmetic", () => {
  const inv = buildInvoicePayload(
    {
      ...order,
      totalGrossGrosze: 5 + 100 + 123456 + 10,
      items: [
        { packageName: "a", quantity: 1, vatRate: 23, lineGrossGrosze: 5 },
        { packageName: "b", quantity: 1, vatRate: 23, lineGrossGrosze: 100 },
        { packageName: "c", quantity: 1, vatRate: 8, lineGrossGrosze: 123456 },
        { packageName: "d", quantity: 1, vatRate: 0, lineGrossGrosze: 10 },
      ],
    },
    organization,
    null,
    issueDate,
  );
  assert.deepEqual(
    inv.positions.map((p) => p.total_price_gross),
    ["0.05", "1.00", "1234.56", "0.10"],
  );
  assert.equal(inv.paid, "1235.71");
});

test("buildInvoicePayload: refuses an order whose items do not add up to its gross total", () => {
  assert.throws(() => buildInvoicePayload({ ...order, totalGrossGrosze: 51661 }, organization, null, issueDate), /51661/);
});

test("buildInvoicePayload: refuses an order without paidAt", () => {
  assert.throws(() => buildInvoicePayload({ ...order, paidAt: null }, organization, null, issueDate), /paidAt|płatno/);
});

// --- createInvoice ---

test("createInvoice: posts api_token and invoice in the JSON body, returns id as string", async () => {
  const { calls, fetchImpl } = mockFetch(() => json({ id: 12345, number: "FV/10/2026", token: "pubtoken123" }, 201));
  const client = createFakturowniaClient(config, fetchImpl);
  const result = await client.createInvoice(validInvoice);
  assert.deepEqual(result, { id: "12345", number: "FV/10/2026", token: "pubtoken123" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://izzy-test.fakturownia.pl/invoices.json");
  assert.equal(calls[0].init.method, "POST");
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers["Content-Type"], "application/json");
  assert.equal(headers.Accept, "application/json");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { api_token: TOKEN, invoice: JSON.parse(JSON.stringify(validInvoice)) });
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.equal(calls[0].url.includes(TOKEN), false);
});

test("createInvoice: 422 mentioning oid is DUPLICATE_OID and keeps the raw messages", async () => {
  for (const body of [
    { code: "error", message: { oid: ["has already been taken"] } },
    { message: "Oid has already been taken" },
    { errors: { oid: ["jest już zajęte"] } },
    { message: ["Numer zamówienia (oid) już istnieje"] },
  ]) {
    const { fetchImpl } = mockFetch(() => json(body, 422));
    const client = createFakturowniaClient(config, fetchImpl);
    await assert.rejects(client.createInvoice(validInvoice), (err: unknown) => {
      assert.ok(err instanceof FakturowniaError);
      assert.equal(err.code, "DUPLICATE_OID");
      assert.equal(err.status, 422);
      assert.match(err.message, /oid/i);
      assert.equal(err.message.includes(TOKEN), false);
      return true;
    });
  }
});

test("createInvoice: 422 without oid is VALIDATION with the validation messages", async () => {
  const { fetchImpl } = mockFetch(() => json({ code: "error", message: { buyer_tax_no: ["jest nieprawidłowy"] } }, 422));
  const client = createFakturowniaClient(config, fetchImpl);
  await assert.rejects(client.createInvoice(validInvoice), (err: unknown) => {
    assert.ok(err instanceof FakturowniaError);
    assert.equal(err.code, "VALIDATION");
    assert.equal(err.status, 422);
    assert.match(err.message, /buyer_tax_no/);
    assert.match(err.message, /nieprawidłowy/);
    return true;
  });
});

test("createInvoice: words merely containing 'oid' do not trigger DUPLICATE_OID", async () => {
  const { fetchImpl } = mockFetch(() => json({ message: "Cannot avoid paranoid voided values" }, 422));
  const client = createFakturowniaClient(config, fetchImpl);
  await assert.rejects(client.createInvoice(validInvoice), (err: unknown) => {
    assert.ok(err instanceof FakturowniaError);
    assert.equal(err.code, "VALIDATION");
    return true;
  });
});

test("createInvoice: other 4xx is VALIDATION", async () => {
  const { fetchImpl } = mockFetch(() => json({ message: "Not found" }, 404));
  const client = createFakturowniaClient(config, fetchImpl);
  await assert.rejects(client.createInvoice(validInvoice), (err: unknown) => {
    assert.ok(err instanceof FakturowniaError);
    assert.equal(err.code, "VALIDATION");
    assert.equal(err.status, 404);
    return true;
  });
});

test("createInvoice: 401 and 403 are AUTH", async () => {
  for (const status of [401, 403]) {
    const { fetchImpl } = mockFetch(() => json({ message: "Unauthorized" }, status));
    const client = createFakturowniaClient(config, fetchImpl);
    await assert.rejects(client.createInvoice(validInvoice), (err: unknown) => {
      assert.ok(err instanceof FakturowniaError);
      assert.equal(err.code, "AUTH");
      assert.equal(err.status, status);
      return true;
    });
  }
});

test("createInvoice: 5xx is SERVER, also with a non-JSON body", async () => {
  const { fetchImpl } = mockFetch(() => new Response("<html>Bad gateway</html>", { status: 502 }));
  const client = createFakturowniaClient(config, fetchImpl);
  await assert.rejects(client.createInvoice(validInvoice), (err: unknown) => {
    assert.ok(err instanceof FakturowniaError);
    assert.equal(err.code, "SERVER");
    assert.equal(err.status, 502);
    return true;
  });
});

test("createInvoice: a timeout or abort is TIMEOUT", async () => {
  for (const name of ["TimeoutError", "AbortError"]) {
    const { fetchImpl } = mockFetch(() => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name });
    });
    const client = createFakturowniaClient(config, fetchImpl);
    await assert.rejects(client.createInvoice(validInvoice), (err: unknown) => {
      assert.ok(err instanceof FakturowniaError);
      assert.equal(err.code, "TIMEOUT");
      assert.equal(err.status, undefined);
      return true;
    });
  }
});

test("createInvoice: a network failure is SERVER and does not leak the URL or token", async () => {
  const { fetchImpl } = mockFetch((call) => {
    throw new TypeError(`fetch failed for ${call.url}?api_token=${TOKEN}`);
  });
  const client = createFakturowniaClient(config, fetchImpl);
  await assert.rejects(client.createInvoice(validInvoice), (err: unknown) => {
    assert.ok(err instanceof FakturowniaError);
    assert.equal(err.code, "SERVER");
    assert.equal(err.message.includes(TOKEN), false);
    assert.equal((err as { cause?: unknown }).cause, undefined);
    return true;
  });
});

test("createInvoice: a 2xx response without id/number/token is a SERVER error", async () => {
  const { fetchImpl } = mockFetch(() => json({ id: 7 }, 201));
  const client = createFakturowniaClient(config, fetchImpl);
  await assert.rejects(client.createInvoice(validInvoice), (err: unknown) => {
    assert.ok(err instanceof FakturowniaError);
    assert.equal(err.code, "SERVER");
    return true;
  });
});

test("the API token never appears in any error message, even when the response echoes it", async () => {
  for (const status of [401, 404, 422, 500]) {
    const { fetchImpl } = mockFetch(() => json({ message: `bad api_token=${TOKEN}`, errors: { api_token: [TOKEN] } }, status));
    const client = createFakturowniaClient(config, fetchImpl);
    const calls: Array<() => Promise<unknown>> = [
      () => client.createInvoice(validInvoice),
      () => client.sendInvoiceByEmail("1", { emailTo: ["a@b.pl"], emailCc: [] }),
      () => client.getInvoiceKsef("1"),
    ];
    for (const call of calls) {
      await assert.rejects(call(), (err: unknown) => {
        assert.ok(err instanceof FakturowniaError);
        assert.equal(err.message.includes(TOKEN), false, `status ${status}`);
        assert.equal(String(err.stack).includes(TOKEN), false);
        return true;
      });
    }
  }
});

// --- sendInvoiceByEmail ---

test("sendInvoiceByEmail: POSTs to send_by_email.json with encoded api_token, email_to and email_cc", async () => {
  const { calls, fetchImpl } = mockFetch(() => json({}, 200));
  const client = createFakturowniaClient(config, fetchImpl);
  await client.sendInvoiceByEmail("12345", { emailTo: ["faktury@serwis.example", "ksiega+x@firma.pl"], emailCc: ["jan@example.com"] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(
    calls[0].url,
    `https://izzy-test.fakturownia.pl/invoices/12345/send_by_email.json?api_token=${TOKEN}&email_to=faktury%40serwis.example,ksiega%2Bx%40firma.pl&email_cc=jan%40example.com`,
  );
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test("sendInvoiceByEmail: omits email_cc when there is no copy recipient", async () => {
  const { calls, fetchImpl } = mockFetch(() => json({}, 200));
  const client = createFakturowniaClient(config, fetchImpl);
  await client.sendInvoiceByEmail("9", { emailTo: ["a@b.pl"], emailCc: [] });
  assert.equal(calls[0].url, `https://izzy-test.fakturownia.pl/invoices/9/send_by_email.json?api_token=${TOKEN}&email_to=a%40b.pl`);
});

test("sendInvoiceByEmail: failures map to FakturowniaError codes", async () => {
  const { fetchImpl } = mockFetch(() => json({ message: "nope" }, 500));
  const client = createFakturowniaClient(config, fetchImpl);
  await assert.rejects(client.sendInvoiceByEmail("9", { emailTo: ["a@b.pl"], emailCc: [] }), (err: unknown) => {
    assert.ok(err instanceof FakturowniaError);
    assert.equal(err.code, "SERVER");
    return true;
  });
});

// --- getInvoiceKsef ---

test("getInvoiceKsef: GETs the gov fields and maps them", async () => {
  const { calls, fetchImpl } = mockFetch(() =>
    json({
      gov_status: "ok",
      gov_id: "5252445767-20261029-ABC123",
      gov_verification_link: "https://ksef.mf.gov.pl/web/verify/5252445767-20261029-ABC123/hash",
      gov_error_messages: null,
    }),
  );
  const client = createFakturowniaClient(config, fetchImpl);
  const result = await client.getInvoiceKsef("12345");
  assert.deepEqual(result, {
    govStatus: "ok",
    govId: "5252445767-20261029-ABC123",
    verificationLink: "https://ksef.mf.gov.pl/web/verify/5252445767-20261029-ABC123/hash",
    errors: [],
  });
  assert.equal(calls[0].init.method, "GET");
  assert.equal(
    calls[0].url,
    `https://izzy-test.fakturownia.pl/invoices/12345.json?fields[invoice]=gov_status,gov_id,gov_verification_link,gov_error_messages&api_token=${TOKEN}`,
  );
});

test("getInvoiceKsef: missing fields become null and error messages are listed", async () => {
  const { fetchImpl } = mockFetch(() =>
    json({ gov_status: "send_error", gov_id: null, gov_error_messages: ["Błąd NIP", { code: 21405, description: "Zły format" }] }),
  );
  const client = createFakturowniaClient(config, fetchImpl);
  const result = await client.getInvoiceKsef("1");
  assert.equal(result.govStatus, "send_error");
  assert.equal(result.govId, null);
  assert.equal(result.verificationLink, null);
  assert.deepEqual(result.errors, ["Błąd NIP", "21405", "Zły format"]);
});

test("getInvoiceKsef: gov_error_messages as an object of arrays/strings is flattened", async () => {
  const { fetchImpl } = mockFetch(() =>
    json({ gov_status: "send_error", gov_error_messages: { buyer_tax_no: ["zły NIP", "brak"], base: "ogólny błąd", empty: [], none: null } }),
  );
  const client = createFakturowniaClient(config, fetchImpl);
  assert.deepEqual((await client.getInvoiceKsef("1")).errors, ["zły NIP", "brak", "ogólny błąd"]);
  const single = createFakturowniaClient(config, mockFetch(() => json({ gov_error_messages: "jeden błąd" })).fetchImpl);
  assert.deepEqual((await single.getInvoiceKsef("1")).errors, ["jeden błąd"]);
});

test("getInvoiceKsef: an empty object maps to all nulls", async () => {
  const { fetchImpl } = mockFetch(() => json({}));
  const client = createFakturowniaClient(config, fetchImpl);
  assert.deepEqual(await client.getInvoiceKsef("1"), { govStatus: null, govId: null, verificationLink: null, errors: [] });
});

test("getInvoiceKsef: a non-ok response throws FakturowniaError", async () => {
  const { fetchImpl } = mockFetch(() => json({ message: "Not found" }, 404));
  const client = createFakturowniaClient(config, fetchImpl);
  await assert.rejects(client.getInvoiceKsef("1"), (err: unknown) => {
    assert.ok(err instanceof FakturowniaError);
    assert.equal(err.status, 404);
    return true;
  });
});

// --- invoicePdfUrl ---

test("invoicePdfUrl: builds the public token link", () => {
  const client = createFakturowniaClient(config, mockFetch(() => json({})).fetchImpl);
  assert.equal(client.invoicePdfUrl("HBO3Npx2OzSW79RQL7XV2"), "https://izzy-test.fakturownia.pl/invoice/HBO3Npx2OzSW79RQL7XV2.pdf");
  assert.equal(client.invoicePdfUrl("a/b c"), "https://izzy-test.fakturownia.pl/invoice/a%2Fb%20c.pdf");
});

// --- fix round 1 ---

test("429 and 408 are retryable SERVER errors for every operation", async () => {
  for (const status of [429, 408]) {
    const { fetchImpl } = mockFetch(() => json({ message: "slow down" }, status));
    const client = createFakturowniaClient(config, fetchImpl);
    const ops: Array<() => Promise<unknown>> = [
      () => client.createInvoice(validInvoice),
      () => client.sendInvoiceByEmail("1", { emailTo: ["a@b.pl"], emailCc: [] }),
      () => client.getInvoiceKsef("1"),
    ];
    for (const op of ops) {
      await assert.rejects(op(), (err: unknown) => {
        assert.ok(err instanceof FakturowniaError);
        assert.equal(err.code, "SERVER");
        assert.equal(err.status, status);
        return true;
      });
    }
  }
});

test("429 mentioning oid is still SERVER, not DUPLICATE_OID", async () => {
  const { fetchImpl } = mockFetch(() => json({ message: "oid rate limit" }, 429));
  const client = createFakturowniaClient(config, fetchImpl);
  await assert.rejects(client.createInvoice(validInvoice), (err: unknown) => {
    assert.ok(err instanceof FakturowniaError);
    assert.equal(err.code, "SERVER");
    return true;
  });
});

test("DUPLICATE_OID is only detected by createInvoice", async () => {
  const { fetchImpl } = mockFetch(() => json({ message: { oid: ["has already been taken"] } }, 422));
  const client = createFakturowniaClient(config, fetchImpl);
  const others: Array<() => Promise<unknown>> = [
    () => client.sendInvoiceByEmail("1", { emailTo: ["a@b.pl"], emailCc: [] }),
    () => client.getInvoiceKsef("1"),
  ];
  for (const op of others) {
    await assert.rejects(op(), (err: unknown) => {
      assert.ok(err instanceof FakturowniaError);
      assert.equal(err.code, "VALIDATION");
      return true;
    });
  }
  for (const status of [401, 403]) {
    const { fetchImpl: authFetch } = mockFetch(() => json({ message: "oid" }, status));
    await assert.rejects(
      createFakturowniaClient(config, authFetch).getInvoiceKsef("1"),
      (err: unknown) => err instanceof FakturowniaError && err.code === "AUTH",
    );
  }
});

test("every request uses redirect: error", async () => {
  const { calls, fetchImpl } = mockFetch(() => json({ id: 1, number: "FV/1", token: "t" }, 201));
  const client = createFakturowniaClient(config, fetchImpl);
  await client.createInvoice(validInvoice);
  await client.sendInvoiceByEmail("1", { emailTo: ["a@b.pl"], emailCc: [] });
  await client.getInvoiceKsef("1");
  assert.equal(calls.length, 3);
  for (const call of calls) assert.equal(call.init.redirect, "error");
});

test("a rejected redirect (undici TypeError) is a SERVER error without the URL or token", async () => {
  const { fetchImpl } = mockFetch((call) => {
    throw new TypeError("fetch failed", { cause: new Error(`unexpected redirect ${call.url}?api_token=${TOKEN}`) });
  });
  const client = createFakturowniaClient(config, fetchImpl);
  const ops: Array<() => Promise<unknown>> = [
    () => client.createInvoice(validInvoice),
    () => client.sendInvoiceByEmail("1", { emailTo: ["a@b.pl"], emailCc: [] }),
    () => client.getInvoiceKsef("1"),
  ];
  for (const op of ops) {
    await assert.rejects(op(), (err: unknown) => {
      assert.ok(err instanceof FakturowniaError);
      assert.equal(err.code, "SERVER");
      assert.equal(err.message, "Nieoczekiwane przekierowanie z Fakturowni.");
      assert.equal(err.message.includes(TOKEN), false);
      assert.equal((err as { cause?: unknown }).cause, undefined);
      return true;
    });
  }
});

test("a 3xx response is also reported as an unexpected redirect", async () => {
  const { fetchImpl } = mockFetch(() => new Response(null, { status: 302 }));
  const client = createFakturowniaClient(config, fetchImpl);
  await assert.rejects(client.createInvoice(validInvoice), (err: unknown) => {
    assert.ok(err instanceof FakturowniaError);
    assert.equal(err.code, "SERVER");
    assert.equal(err.message, "Nieoczekiwane przekierowanie z Fakturowni.");
    return true;
  });
});

test("sendInvoiceByEmail: de-duplicates case-insensitively and drops cc already in to", async () => {
  const { calls, fetchImpl } = mockFetch(() => json({}, 200));
  const client = createFakturowniaClient(config, fetchImpl);
  await client.sendInvoiceByEmail("1", {
    emailTo: [" A@b.pl ", "a@B.PL", "c@d.pl"],
    emailCc: ["C@D.pl", "e@f.pl", "E@f.pl", ""],
  });
  assert.equal(calls[0].url, `https://izzy-test.fakturownia.pl/invoices/1/send_by_email.json?api_token=${TOKEN}&email_to=A%40b.pl,c%40d.pl&email_cc=e%40f.pl`);
});

test("sendInvoiceByEmail: caps to+cc at 5 addresses, to first", async () => {
  const { calls, fetchImpl } = mockFetch(() => json({}, 200));
  const client = createFakturowniaClient(config, fetchImpl);
  await client.sendInvoiceByEmail("1", {
    emailTo: ["1@x.pl", "2@x.pl", "3@x.pl"],
    emailCc: ["4@x.pl", "5@x.pl", "6@x.pl"],
  });
  const query = new URL(calls[0].url).searchParams;
  assert.equal(query.get("email_to"), "1@x.pl,2@x.pl,3@x.pl");
  assert.equal(query.get("email_cc"), "4@x.pl,5@x.pl");

  const many = mockFetch(() => json({}, 200));
  await createFakturowniaClient(config, many.fetchImpl).sendInvoiceByEmail("1", {
    emailTo: ["1@x.pl", "2@x.pl", "3@x.pl", "4@x.pl", "5@x.pl", "6@x.pl"],
    emailCc: ["7@x.pl"],
  });
  const manyQuery = new URL(many.calls[0].url).searchParams;
  assert.equal(manyQuery.get("email_to"), "1@x.pl,2@x.pl,3@x.pl,4@x.pl,5@x.pl");
  assert.equal(manyQuery.get("email_cc"), null);
});

test("sendInvoiceByEmail: empty recipients throw VALIDATION without calling the API", async () => {
  const { calls, fetchImpl } = mockFetch(() => json({}, 200));
  const client = createFakturowniaClient(config, fetchImpl);
  for (const emailTo of [[], ["  "], [""]]) {
    await assert.rejects(client.sendInvoiceByEmail("1", { emailTo, emailCc: ["x@y.pl"] }), (err: unknown) => {
      assert.ok(err instanceof FakturowniaError);
      assert.equal(err.code, "VALIDATION");
      return true;
    });
  }
  assert.equal(calls.length, 0);
});
