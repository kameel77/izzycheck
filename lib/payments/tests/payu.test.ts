import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mock, test } from "node:test";
import {
  PayuError,
  createPayuClient,
  getPayuConfig,
  getSharedPayuClient,
  parsePayuSignatureHeader,
  verifyPayuSignature,
  type PayuConfig,
} from "../payu.ts";

const config: PayuConfig = {
  baseUrl: "https://secure.snd.payu.com",
  posId: "300746",
  clientId: "client-id-999",
  clientSecret: "client-secret",
  secondKey: "second-key",
  appUrl: "https://app.example.com",
  isSandbox: true,
};

const orderInput = {
  extOrderId: "order-1",
  description: "Kredyty IzzyCheck",
  totalAmount: 12300,
  customerIp: "127.0.0.1",
  buyer: { email: "jan@example.com", firstName: "Jan", lastName: "Kowalski" },
  products: [{ name: "Pakiet 10", unitPrice: 6150, quantity: 2 }],
  notifyUrl: "https://app.example.com/api/payments/payu/notify",
  continueUrl: "https://app.example.com/credits",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Call = { url: string; init: RequestInit };

function mockFetch(handler: (call: Call, index: number) => Response) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return handler(call, calls.length - 1);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const isTokenCall = (call: Call) => call.url.endsWith("/pl/standard/user/oauth/authorize");

// --- getPayuConfig ---

const fullEnv = {
  PAYU_BASE_URL: "https://secure.snd.payu.com/",
  PAYU_POS_ID: "300746",
  PAYU_CLIENT_ID: "client-id-999",
  PAYU_CLIENT_SECRET: "client-secret",
  PAYU_SECOND_KEY: "second-key",
  APP_URL: "https://app.example.com/",
};

test("getPayuConfig maps env and strips trailing slashes", () => {
  assert.deepEqual(getPayuConfig(fullEnv), config);
});

test("getPayuConfig: sandbox in production is disabled and logged once", () => {
  const error = mock.method(console, "error", () => {});
  try {
    const prod = { ...fullEnv, NODE_ENV: "production" };
    assert.equal(getPayuConfig(prod), null);
    assert.equal(getPayuConfig(prod), null);
    assert.equal(getPayuConfig({ ...prod, PAYU_ALLOW_SANDBOX: "false" }), null);
    assert.equal(error.mock.calls.length, 1);
    assert.match(String(error.mock.calls[0].arguments[0]), /^\[PAYU_SANDBOX_IN_PRODUCTION\] Płatności wyłączone/);
  } finally {
    error.mock.restore();
  }
});

test("getPayuConfig: sandbox in production with PAYU_ALLOW_SANDBOX=true is allowed and flagged", () => {
  const cfg = getPayuConfig({ ...fullEnv, NODE_ENV: "production", PAYU_ALLOW_SANDBOX: "true" });
  assert.ok(cfg);
  assert.equal(cfg.isSandbox, true);
});

test("getPayuConfig: production PayU host is not sandbox", () => {
  const cfg = getPayuConfig({ ...fullEnv, NODE_ENV: "production", PAYU_BASE_URL: "https://secure.payu.com" });
  assert.ok(cfg);
  assert.equal(cfg.isSandbox, false);
  assert.equal(cfg.baseUrl, "https://secure.payu.com");
});

test("getPayuConfig: sandbox outside production works", () => {
  assert.equal(getPayuConfig({ ...fullEnv, NODE_ENV: "development" })?.isSandbox, true);
  assert.equal(getPayuConfig(fullEnv)?.isSandbox, true);
});

test("getPayuConfig returns null when PAYU_SECOND_KEY is missing", () => {
  const { PAYU_SECOND_KEY: _omit, ...rest } = fullEnv;
  assert.equal(getPayuConfig(rest), null);
  assert.equal(getPayuConfig({ ...fullEnv, PAYU_SECOND_KEY: "  " }), null);
});

test("getSharedPayuClient returns null without config", () => {
  assert.equal(getSharedPayuClient({}), null);
});

test("getSharedPayuClient reuses the instance for the same config and recreates it when config changes", () => {
  const a = getSharedPayuClient(fullEnv);
  assert.ok(a);
  assert.equal(getSharedPayuClient({ ...fullEnv }), a);
  const b = getSharedPayuClient({ ...fullEnv, PAYU_CLIENT_SECRET: "rotated-secret" });
  assert.ok(b);
  assert.notEqual(b, a);
  assert.equal(getSharedPayuClient({ ...fullEnv, PAYU_CLIENT_SECRET: "rotated-secret" }), b);
  assert.notEqual(getSharedPayuClient(fullEnv), b);
});

// --- OAuth token + createOrder ---

test("createOrder fetches the OAuth token once for two orders", async () => {
  const { calls, fetchImpl } = mockFetch((call) =>
    isTokenCall(call)
      ? json({ access_token: "tok-1", expires_in: 43199 })
      : json({ status: { statusCode: "SUCCESS" }, orderId: "PAYU1", redirectUri: "https://pay/1" }, 302),
  );
  const client = createPayuClient(config, fetchImpl);
  await client.createOrder(orderInput);
  await client.createOrder({ ...orderInput, extOrderId: "order-2" });
  assert.equal(calls.filter(isTokenCall).length, 1);
  assert.equal(calls.filter((c) => !isTokenCall(c)).length, 2);
});

test("token request is form-urlencoded client_credentials", async () => {
  const { calls, fetchImpl } = mockFetch((call) =>
    isTokenCall(call)
      ? json({ access_token: "tok-1", expires_in: 43199 })
      : json({ status: { statusCode: "SUCCESS" }, orderId: "PAYU1", redirectUri: "https://pay/1" }, 201),
  );
  await createPayuClient(config, fetchImpl).createOrder(orderInput);
  const token = calls[0];
  assert.equal(token.init.method, "POST");
  const params = new URLSearchParams(String(token.init.body));
  assert.equal(params.get("grant_type"), "client_credentials");
  assert.equal(params.get("client_id"), "client-id-999");
  assert.equal(params.get("client_secret"), "client-secret");
  assert.match(String((token.init.headers as Record<string, string>)["Content-Type"]), /x-www-form-urlencoded/);
});

test("token is refreshed after it expires", async () => {
  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    const { calls, fetchImpl } = mockFetch((call) =>
      isTokenCall(call)
        ? json({ access_token: "tok", expires_in: 120 })
        : json({ status: { statusCode: "SUCCESS" }, orderId: "P", redirectUri: "u" }, 302),
    );
    const client = createPayuClient(config, fetchImpl);
    await client.createOrder(orderInput);
    now += 30_000; // within expires_in - 60
    await client.createOrder(orderInput);
    assert.equal(calls.filter(isTokenCall).length, 1);
    now += 40_000; // past expires_in - 60
    await client.createOrder(orderInput);
    assert.equal(calls.filter(isTokenCall).length, 2);
  } finally {
    Date.now = realNow;
  }
});

test("createOrder: 302 with SUCCESS returns order id and redirect uri", async () => {
  const { fetchImpl } = mockFetch((call) =>
    isTokenCall(call)
      ? json({ access_token: "tok-1", expires_in: 43199 })
      : json({ status: { statusCode: "SUCCESS" }, orderId: "WZHF5FFDRJ140731GUEST000P01", redirectUri: "https://pay/x" }, 302),
  );
  const result = await createPayuClient(config, fetchImpl).createOrder(orderInput);
  assert.deepEqual(result, { payuOrderId: "WZHF5FFDRJ140731GUEST000P01", redirectUri: "https://pay/x" });
});

test("createOrder request: bearer token, manual redirect, posId and string amounts", async () => {
  const { calls, fetchImpl } = mockFetch((call) =>
    isTokenCall(call)
      ? json({ access_token: "tok-1", expires_in: 43199 })
      : json({ status: { statusCode: "SUCCESS" }, orderId: "P", redirectUri: "u" }, 302),
  );
  await createPayuClient(config, fetchImpl).createOrder(orderInput);
  const order = calls[1];
  assert.equal(order.url, "https://secure.snd.payu.com/api/v2_1/orders");
  assert.equal(order.init.method, "POST");
  assert.equal(order.init.redirect, "manual");
  assert.equal((order.init.headers as Record<string, string>).Authorization, "Bearer tok-1");
  const body = JSON.parse(String(order.init.body));
  assert.equal(body.merchantPosId, "300746");
  assert.notEqual(body.merchantPosId, config.clientId);
  assert.equal(body.currencyCode, "PLN");
  assert.equal(body.totalAmount, "12300");
  assert.equal(body.extOrderId, "order-1");
  assert.equal(body.notifyUrl, orderInput.notifyUrl);
  assert.equal(body.continueUrl, orderInput.continueUrl);
  assert.equal(body.customerIp, "127.0.0.1");
  assert.deepEqual(body.buyer, { email: "jan@example.com", firstName: "Jan", lastName: "Kowalski", language: "pl" });
  assert.deepEqual(body.products, [{ name: "Pakiet 10", unitPrice: "6150", quantity: "2" }]);
});

test("createOrder: error status code becomes PayuError with payuStatusCode", async () => {
  const { fetchImpl } = mockFetch((call) =>
    isTokenCall(call)
      ? json({ access_token: "tok-1", expires_in: 43199 })
      : json({ status: { statusCode: "ERROR_VALUE_INVALID", codeLiteral: "X" } }, 400),
  );
  await assert.rejects(
    () => createPayuClient(config, fetchImpl).createOrder(orderInput),
    (err: unknown) =>
      err instanceof PayuError && err.payuStatusCode === "ERROR_VALUE_INVALID" && err.status === 400,
  );
});

test("createOrder: 200 without SUCCESS is a PayuError", async () => {
  const { fetchImpl } = mockFetch((call) =>
    isTokenCall(call)
      ? json({ access_token: "tok-1", expires_in: 43199 })
      : json({ status: { statusCode: "WARNING_CONTINUE_3DS" }, orderId: "P", redirectUri: "u" }, 200),
  );
  await assert.rejects(
    () => createPayuClient(config, fetchImpl).createOrder(orderInput),
    (err: unknown) => err instanceof PayuError && err.payuStatusCode === "WARNING_CONTINUE_3DS",
  );
});

test("createOrder: 401 refreshes the token and retries once", async () => {
  let orderCalls = 0;
  let tokenCalls = 0;
  const { calls, fetchImpl } = mockFetch((call) => {
    if (isTokenCall(call)) {
      tokenCalls += 1;
      return json({ access_token: `tok-${tokenCalls}`, expires_in: 43199 });
    }
    orderCalls += 1;
    return orderCalls === 1
      ? json({ status: { statusCode: "UNAUTHORIZED" } }, 401)
      : json({ status: { statusCode: "SUCCESS" }, orderId: "P2", redirectUri: "u2" }, 302);
  });
  const result = await createPayuClient(config, fetchImpl).createOrder(orderInput);
  assert.equal(result.payuOrderId, "P2");
  assert.equal(tokenCalls, 2);
  assert.equal(orderCalls, 2);
  const orderAuth = calls
    .filter((c) => !isTokenCall(c))
    .map((c) => (c.init.headers as Record<string, string>).Authorization);
  assert.deepEqual(orderAuth, ["Bearer tok-1", "Bearer tok-2"]);
});

test("createOrder: a second 401 is not retried again", async () => {
  let orderCalls = 0;
  const { fetchImpl } = mockFetch((call) => {
    if (isTokenCall(call)) return json({ access_token: "tok", expires_in: 43199 });
    orderCalls += 1;
    return json({ status: { statusCode: "UNAUTHORIZED" } }, 401);
  });
  await assert.rejects(
    () => createPayuClient(config, fetchImpl).createOrder(orderInput),
    (err: unknown) => err instanceof PayuError && err.status === 401,
  );
  assert.equal(orderCalls, 2);
});

test("token endpoint failure is a PayuError", async () => {
  const { fetchImpl } = mockFetch(() => json({ error: "invalid_client" }, 401));
  await assert.rejects(
    () => createPayuClient(config, fetchImpl).createOrder(orderInput),
    (err: unknown) => err instanceof PayuError && err.status === 401,
  );
});

// --- getOrder ---

test("getOrder returns the first order with numeric amount", async () => {
  const { calls, fetchImpl } = mockFetch((call) =>
    isTokenCall(call)
      ? json({ access_token: "tok-1", expires_in: 43199 })
      : json({
          orders: [
            { orderId: "P1", extOrderId: "order-1", status: "COMPLETED", totalAmount: "12300", currencyCode: "PLN" },
          ],
          status: { statusCode: "SUCCESS" },
        }),
  );
  const result = await createPayuClient(config, fetchImpl).getOrder("P1");
  assert.deepEqual(result, { status: "COMPLETED", totalAmount: 12300, currencyCode: "PLN", extOrderId: "order-1" });
  assert.equal(calls[1].url, "https://secure.snd.payu.com/api/v2_1/orders/P1");
  assert.equal((calls[1].init.headers as Record<string, string>).Authorization, "Bearer tok-1");
});

test("getOrder: empty orders list or non-OK response is a PayuError", async () => {
  const empty = mockFetch((call) =>
    isTokenCall(call) ? json({ access_token: "t", expires_in: 43199 }) : json({ orders: [] }),
  );
  await assert.rejects(() => createPayuClient(config, empty.fetchImpl).getOrder("P1"), PayuError);

  const notFound = mockFetch((call) =>
    isTokenCall(call)
      ? json({ access_token: "t", expires_in: 43199 })
      : json({ status: { statusCode: "DATA_NOT_FOUND" } }, 404),
  );
  await assert.rejects(
    () => createPayuClient(config, notFound.fetchImpl).getOrder("P1"),
    (err: unknown) => err instanceof PayuError && err.status === 404 && err.payuStatusCode === "DATA_NOT_FOUND",
  );
});

// --- signatures ---

const body = '{"order":{"orderId":"P1","status":"COMPLETED"}}';
const hash = (algo: "md5" | "sha256", text: string) => createHash(algo).update(text).digest("hex");

test("parsePayuSignatureHeader parses canonical and tolerant formats", () => {
  assert.deepEqual(
    parsePayuSignatureHeader("sender=checkout;signature=abc123;algorithm=MD5;content=DOCUMENT"),
    { signature: "abc123", algorithm: "MD5" },
  );
  assert.deepEqual(parsePayuSignatureHeader(" sender = checkout ; signature = abc ; algorithm = sha-256 "), {
    signature: "abc",
    algorithm: "SHA-256",
  });
  assert.equal(parsePayuSignatureHeader("signature=abc;algorithm=SHA256")?.algorithm, "SHA-256");
  assert.equal(parsePayuSignatureHeader("signature=abc")?.algorithm, "MD5");
});

test("parsePayuSignatureHeader returns null for missing, empty or unknown", () => {
  assert.equal(parsePayuSignatureHeader(null), null);
  assert.equal(parsePayuSignatureHeader(""), null);
  assert.equal(parsePayuSignatureHeader("sender=checkout;algorithm=MD5"), null);
  assert.equal(parsePayuSignatureHeader("signature=abc;algorithm=SHA-512"), null);
});

test("verifyPayuSignature accepts a valid MD5 signature", () => {
  const sig = hash("md5", body + "second-key");
  assert.equal(verifyPayuSignature(body, `sender=checkout;signature=${sig};algorithm=MD5;content=DOCUMENT`, "second-key"), true);
  assert.equal(verifyPayuSignature(body, `signature=${sig}`, "second-key"), true);
});

test("verifyPayuSignature accepts a valid SHA-256 signature (SHA256 and SHA-256)", () => {
  const sig = hash("sha256", body + "second-key");
  assert.equal(verifyPayuSignature(body, `signature=${sig};algorithm=SHA-256`, "second-key"), true);
  assert.equal(verifyPayuSignature(body, `signature=${sig};algorithm=sha256`, "second-key"), true);
});

test("verifyPayuSignature rejects wrong signature, changed body, wrong key", () => {
  const sig = hash("md5", body + "second-key");
  assert.equal(verifyPayuSignature(body, "signature=" + "0".repeat(32) + ";algorithm=MD5", "second-key"), false);
  assert.equal(verifyPayuSignature(body + " ", `signature=${sig};algorithm=MD5`, "second-key"), false);
  assert.equal(verifyPayuSignature(body, `signature=${sig};algorithm=MD5`, "other-key"), false);
  assert.equal(verifyPayuSignature(body, "signature=short;algorithm=MD5", "second-key"), false);
});

test("verifyPayuSignature rejects a missing header or unknown algorithm", () => {
  const sig = hash("md5", body + "second-key");
  assert.equal(verifyPayuSignature(body, null, "second-key"), false);
  assert.equal(verifyPayuSignature(body, `signature=${sig};algorithm=SHA-512`, "second-key"), false);
});

test("verifyPayuSignature rejects everything when secondKey is empty", () => {
  const forged = hash("md5", body);
  assert.equal(verifyPayuSignature(body, `signature=${forged};algorithm=MD5`, ""), false);
});

// --- hardening ---

test("all PayU fetches carry a timeout signal", async () => {
  const { calls, fetchImpl } = mockFetch((call) => {
    if (isTokenCall(call)) return json({ access_token: "t", expires_in: 43199 });
    return call.init.method === "GET"
      ? json({ orders: [{ status: "NEW", totalAmount: "1", currencyCode: "PLN", extOrderId: "e" }] })
      : json({ status: { statusCode: "SUCCESS" }, orderId: "P", redirectUri: "u" }, 302);
  });
  const client = createPayuClient(config, fetchImpl);
  await client.createOrder(orderInput);
  await client.getOrder("P");
  assert.equal(calls.length, 3);
  for (const call of calls) assert.ok(call.init.signal instanceof AbortSignal);
});

test("a timeout surfaces as PayuError", async () => {
  for (const name of ["TimeoutError", "AbortError"]) {
    const fetchImpl = (async () => {
      throw new DOMException("timed out", name);
    }) as typeof fetch;
    await assert.rejects(
      () => createPayuClient(config, fetchImpl).createOrder(orderInput),
      (err: unknown) => err instanceof PayuError && err.message === "PayU nie odpowiedziało w czasie.",
    );
  }
});

test("401 retry consumes the first response body", async () => {
  let orderCalls = 0;
  let cancelled = false;
  const { fetchImpl } = mockFetch((call) => {
    if (isTokenCall(call)) return json({ access_token: "tok", expires_in: 43199 });
    orderCalls += 1;
    if (orderCalls > 1) return json({ status: { statusCode: "SUCCESS" }, orderId: "P", redirectUri: "u" }, 302);
    const res = json({ status: { statusCode: "UNAUTHORIZED" } }, 401);
    const originalCancel = res.body!.cancel.bind(res.body);
    res.body!.cancel = (reason?: unknown) => {
      cancelled = true;
      return originalCancel(reason);
    };
    return res;
  });
  await createPayuClient(config, fetchImpl).createOrder(orderInput);
  assert.equal(cancelled, true);
});

test("getOrder rejects malformed order payloads", async () => {
  const bad: unknown[] = [
    { orders: [{ status: "NEW", currencyCode: "PLN", extOrderId: "e" }] },
    { orders: [{ status: "NEW", totalAmount: "abc", currencyCode: "PLN", extOrderId: "e" }] },
    { orders: [{ totalAmount: "1", currencyCode: "PLN", extOrderId: "e" }] },
    { orders: [{ status: "NEW", totalAmount: "1", extOrderId: "e" }] },
    { orders: [{ status: "NEW", totalAmount: "1", currencyCode: "PLN" }] },
  ];
  for (const payload of bad) {
    const { fetchImpl } = mockFetch((call) =>
      isTokenCall(call) ? json({ access_token: "t", expires_in: 43199 }) : json(payload),
    );
    await assert.rejects(() => createPayuClient(config, fetchImpl).getOrder("P1"), PayuError);
  }
});
