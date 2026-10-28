import { createHash, timingSafeEqual } from "node:crypto";

export type PayuConfig = {
  baseUrl: string;
  posId: string;
  clientId: string;
  clientSecret: string;
  secondKey: string;
  appUrl: string;
  /** True when baseUrl points at the PayU sandbox (secure.snd.payu.com). */
  isSandbox: boolean;
};

let sandboxInProductionLogged = false;

export function isSandboxUrl(baseUrl: string): boolean {
  let host = baseUrl;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    // Not a parsable URL: fall back to matching the raw value.
  }
  const hostname = host.toLowerCase();
  return hostname === "snd.payu.com" || hostname.endsWith(".snd.payu.com");
}

/**
 * Reads PayU settings from env; null when any required variable is missing or blank. Fails closed: the
 * sandbox in production (NODE_ENV=production) disables payments unless PAYU_ALLOW_SANDBOX=true, because
 * sandbox payments would otherwise grant real credits for test money.
 */
export function getPayuConfig(env: Record<string, string | undefined> = process.env): PayuConfig | null {
  const read = (name: string) => (env[name] ?? "").trim();
  const baseUrl = read("PAYU_BASE_URL").replace(/\/+$/, "");
  const posId = read("PAYU_POS_ID");
  const clientId = read("PAYU_CLIENT_ID");
  const clientSecret = read("PAYU_CLIENT_SECRET");
  const secondKey = read("PAYU_SECOND_KEY");
  const appUrl = read("APP_URL").replace(/\/+$/, "");
  if (!baseUrl || !posId || !clientId || !clientSecret || !secondKey || !appUrl) return null;
  const isSandbox = isSandboxUrl(baseUrl);
  if (isSandbox && env.NODE_ENV === "production" && env.PAYU_ALLOW_SANDBOX !== "true") {
    if (!sandboxInProductionLogged) {
      sandboxInProductionLogged = true;
      console.error(
        "[PAYU_SANDBOX_IN_PRODUCTION] Płatności wyłączone: sandbox PayU w środowisku produkcyjnym. Ustaw PAYU_ALLOW_SANDBOX=true, aby świadomie testować.",
      );
    }
    return null;
  }
  return { baseUrl, posId, clientId, clientSecret, secondKey, appUrl, isSandbox };
}

export class PayuError extends Error {
  status?: number;
  payuStatusCode?: string;

  constructor(message: string, details: { status?: number; payuStatusCode?: string } = {}) {
    super(message);
    this.name = "PayuError";
    this.status = details.status;
    this.payuStatusCode = details.payuStatusCode;
  }
}

export type CreateOrderInput = {
  extOrderId: string;
  description: string;
  /** Gross total in grosze. */
  totalAmount: number;
  customerIp: string;
  buyer: { email: string; firstName?: string; lastName?: string };
  /** unitPrice in grosze. */
  products: Array<{ name: string; unitPrice: number; quantity: number }>;
  notifyUrl: string;
  continueUrl: string;
};

export type PayuOrderInfo = {
  status: string;
  totalAmount: number;
  currencyCode: string;
  extOrderId: string;
};

type PayuJson = Record<string, any> | null;

async function readJson(res: Response): Promise<PayuJson> {
  try {
    return (await res.json()) as PayuJson;
  } catch {
    return null;
  }
}

const REQUEST_TIMEOUT_MS = 15000;

export function createPayuClient(config: PayuConfig, fetchImpl: typeof fetch = fetch) {
  let cachedToken: { value: string; expiresAt: number } | null = null;

  /** fetch with a hard timeout; timeouts/aborts surface as PayuError. */
  async function send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
      const name = (err as { name?: string } | null)?.name;
      if (name === "TimeoutError" || name === "AbortError") {
        throw new PayuError("PayU nie odpowiedziało w czasie.");
      }
      throw err;
    }
  }

  async function requestToken(): Promise<string> {
    const res = await send(`${config.baseUrl}/pl/standard/user/oauth/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }).toString(),
    });
    const data = await readJson(res);
    if (!res.ok || typeof data?.access_token !== "string") {
      throw new PayuError("PayU: nie udało się pobrać tokenu OAuth", { status: res.status });
    }
    const expiresIn = Number(data.expires_in) || 0;
    cachedToken = { value: data.access_token, expiresAt: Date.now() + Math.max(expiresIn - 60, 0) * 1000 };
    return data.access_token;
  }

  async function getToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;
    return requestToken();
  }

  /** Authorized request; on 401 refreshes the token and retries exactly once. */
  async function authorized(url: string, init: RequestInit): Promise<Response> {
    const attempt = async (forceRefresh: boolean) => {
      const token = await getToken(forceRefresh);
      return send(url, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
      });
    };
    const first = await attempt(false);
    if (first.status !== 401) return first;
    await first.body?.cancel().catch(() => {});
    return attempt(true);
  }

  function failure(res: Response, data: PayuJson, fallback: string): PayuError {
    const payuStatusCode = typeof data?.status?.statusCode === "string" ? data.status.statusCode : undefined;
    return new PayuError(`${fallback} (HTTP ${res.status}${payuStatusCode ? `, ${payuStatusCode}` : ""})`, {
      status: res.status,
      payuStatusCode,
    });
  }

  async function createOrder(input: CreateOrderInput): Promise<{ payuOrderId: string; redirectUri: string }> {
    const body = {
      notifyUrl: input.notifyUrl,
      continueUrl: input.continueUrl,
      customerIp: input.customerIp,
      merchantPosId: config.posId,
      description: input.description,
      currencyCode: "PLN",
      totalAmount: String(input.totalAmount),
      extOrderId: input.extOrderId,
      buyer: {
        email: input.buyer.email,
        firstName: input.buyer.firstName,
        lastName: input.buyer.lastName,
        language: "pl",
      },
      products: input.products.map((p) => ({
        name: p.name,
        unitPrice: String(p.unitPrice),
        quantity: String(p.quantity),
      })),
    };
    const res = await authorized(`${config.baseUrl}/api/v2_1/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      redirect: "manual",
    });
    const data = await readJson(res);
    const accepted = res.status === 200 || res.status === 201 || res.status === 302;
    if (!accepted || data?.status?.statusCode !== "SUCCESS") {
      throw failure(res, data, "PayU: nie udało się utworzyć zamówienia");
    }
    if (typeof data.orderId !== "string" || typeof data.redirectUri !== "string") {
      throw new PayuError("PayU: niepełna odpowiedź na utworzenie zamówienia", { status: res.status });
    }
    return { payuOrderId: data.orderId, redirectUri: data.redirectUri };
  }

  async function getOrder(payuOrderId: string): Promise<PayuOrderInfo> {
    const res = await authorized(`${config.baseUrl}/api/v2_1/orders/${encodeURIComponent(payuOrderId)}`, {
      method: "GET",
    });
    const data = await readJson(res);
    if (!res.ok) throw failure(res, data, "PayU: nie udało się pobrać zamówienia");
    const order = Array.isArray(data?.orders) ? data.orders[0] : undefined;
    if (!order) throw new PayuError("PayU: brak zamówienia w odpowiedzi", { status: res.status });
    const totalAmount = typeof order.totalAmount === "string" && order.totalAmount.trim() !== "" ? Number(order.totalAmount) : order.totalAmount;
    if (
      typeof totalAmount !== "number" ||
      !Number.isFinite(totalAmount) ||
      typeof order.status !== "string" ||
      typeof order.currencyCode !== "string" ||
      typeof order.extOrderId !== "string"
    ) {
      throw new PayuError("PayU: nieprawidłowa odpowiedź zamówienia", { status: res.status });
    }
    return {
      status: order.status,
      totalAmount,
      currencyCode: order.currencyCode,
      extOrderId: order.extOrderId,
    };
  }

  return { createOrder, getOrder };
}

export type PayuClient = ReturnType<typeof createPayuClient>;

let sharedClient: { key: string; client: PayuClient } | null = null;

/**
 * Process-wide PayU client so the OAuth token cache survives across requests. Recreated when any
 * configuration value changes; null when PayU is not configured.
 */
export function getSharedPayuClient(env: Record<string, string | undefined> = process.env): PayuClient | null {
  const config = getPayuConfig(env);
  if (!config) return null;
  const key = JSON.stringify([config.baseUrl, config.posId, config.clientId, config.clientSecret, config.secondKey, config.appUrl]);
  if (!sharedClient || sharedClient.key !== key) {
    sharedClient = { key, client: createPayuClient(config) };
  }
  return sharedClient.client;
}

export type PayuSignatureAlgorithm = "MD5" | "SHA-256";

/** Parses `sender=checkout;signature=...;algorithm=MD5;content=DOCUMENT`. Missing algorithm means MD5. */
export function parsePayuSignatureHeader(
  header: string | null,
): { signature: string; algorithm: PayuSignatureAlgorithm } | null {
  if (!header) return null;
  const fields: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    fields[part.slice(0, idx).trim().toLowerCase()] = part.slice(idx + 1).trim();
  }
  const signature = fields.signature;
  if (!signature) return null;
  const rawAlgorithm = (fields.algorithm ?? "MD5").toUpperCase().replace(/-/g, "");
  if (rawAlgorithm === "MD5") return { signature, algorithm: "MD5" };
  if (rawAlgorithm === "SHA256") return { signature, algorithm: "SHA-256" };
  return null;
}

/** Verifies OpenPayu-Signature: hex(hash(rawBody + secondKey)) in constant time. */
export function verifyPayuSignature(rawBody: string, header: string | null, secondKey: string): boolean {
  if (!secondKey) return false;
  const parsed = parsePayuSignatureHeader(header);
  if (!parsed) return false;
  const expected = createHash(parsed.algorithm === "MD5" ? "md5" : "sha256")
    .update(rawBody + secondKey)
    .digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(parsed.signature.toLowerCase(), "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
