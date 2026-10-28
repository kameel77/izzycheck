export type FakturowniaConfig = {
  /** Subdomain only, without `.fakturownia.pl`. */
  domain: string;
  apiToken: string;
  departmentId: number | null;
};

/**
 * Reads Fakturownia settings from env; null when the domain or token is missing/blank, the domain is not a
 * bare subdomain (so the token can never be sent to another host), or FAKTUROWNIA_DEPARTMENT_ID is set but
 * invalid (fails closed rather than issuing invoices under the wrong department).
 */
export function getFakturowniaConfig(env: Record<string, string | undefined> = process.env): FakturowniaConfig | null {
  const read = (name: string) => (env[name] ?? "").trim();
  const domain = read("FAKTUROWNIA_DOMAIN");
  const apiToken = read("FAKTUROWNIA_API_TOKEN");
  if (!domain || !apiToken || !/^[a-z0-9-]+$/.test(domain)) return null;
  const rawDepartment = read("FAKTUROWNIA_DEPARTMENT_ID");
  let departmentId: number | null = null;
  if (rawDepartment) {
    departmentId = /^\d+$/.test(rawDepartment) ? Number(rawDepartment) : NaN;
    if (!Number.isSafeInteger(departmentId) || departmentId <= 0) return null;
  }
  return { domain, apiToken, departmentId };
}

export type FakturowniaErrorCode = "DUPLICATE_OID" | "VALIDATION" | "AUTH" | "TIMEOUT" | "SERVER";

export class FakturowniaError extends Error {
  status?: number;
  code?: FakturowniaErrorCode;

  constructor(message: string, details: { status?: number; code?: FakturowniaErrorCode } = {}) {
    super(message);
    this.name = "FakturowniaError";
    this.status = details.status;
    this.code = details.code;
  }
}

export type FakturowniaPositionInput = {
  name: string;
  quantity: number;
  tax: number;
  /** Gross line total, e.g. "492.00". */
  total_price_gross: string;
};

export type FakturowniaInvoiceInput = {
  kind: "vat";
  status: "paid";
  paid: string;
  payment_type: "payu";
  issue_date: string;
  sell_date: string;
  currency: "PLN";
  lang: "pl";
  oid: string;
  oid_unique: "yes";
  calculating_strategy: { position: "keep_gross"; sum: "keep_gross" };
  buyer_name: string;
  buyer_tax_no: string;
  buyer_street: string;
  buyer_post_code: string;
  buyer_city: string;
  buyer_country: string;
  buyer_email: string;
  buyer_company: true;
  department_id?: number;
  positions: FakturowniaPositionInput[];
};

/** Grosze to a "516.60" style string using integer arithmetic only. */
function formatGrosze(grosze: number): string {
  if (!Number.isSafeInteger(grosze)) throw new Error(`Nieprawidłowa kwota w groszach: ${grosze}`);
  const sign = grosze < 0 ? "-" : "";
  const abs = Math.abs(grosze);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

const warsawDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Warsaw",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** YYYY-MM-DD of the given instant in Europe/Warsaw. */
function warsawDate(date: Date): string {
  const parts = Object.fromEntries(warsawDay.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export type InvoiceOrderInput = {
  id: string;
  paidAt: Date | null;
  totalGrossGrosze: number;
  items: Array<{ packageName: string; quantity: number; vatRate: number; lineGrossGrosze: number }>;
};

export type InvoiceOrganizationInput = {
  name: string;
  nip: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  billingEmail: string;
};

/**
 * Pure builder of the Fakturownia invoice for a paid order. Positions are sent as gross line totals with
 * keep_gross so the invoice total equals what the customer paid; throws when the lines do not add up to the
 * order total or the order has no paidAt.
 */
export function buildInvoicePayload(
  order: InvoiceOrderInput,
  organization: InvoiceOrganizationInput,
  _purchaserEmail: string,
  departmentId: number | null,
  issueDate: Date,
): FakturowniaInvoiceInput {
  if (!order.paidAt) throw new Error(`Zamówienie ${order.id} nie ma daty płatności (paidAt)`);
  const linesGross = order.items.reduce((sum, item) => sum + item.lineGrossGrosze, 0);
  if (linesGross !== order.totalGrossGrosze) {
    throw new Error(
      `Pozycje zamówienia ${order.id} (${linesGross} gr) nie sumują się do kwoty brutto zamówienia (${order.totalGrossGrosze} gr)`,
    );
  }
  const invoice: FakturowniaInvoiceInput = {
    kind: "vat",
    status: "paid",
    paid: formatGrosze(order.totalGrossGrosze),
    payment_type: "payu",
    issue_date: warsawDate(issueDate),
    sell_date: warsawDate(order.paidAt),
    currency: "PLN",
    lang: "pl",
    oid: order.id,
    oid_unique: "yes",
    calculating_strategy: { position: "keep_gross", sum: "keep_gross" },
    buyer_name: organization.name,
    buyer_tax_no: organization.nip,
    buyer_street: organization.street,
    buyer_post_code: organization.postalCode,
    buyer_city: organization.city,
    buyer_country: organization.country,
    buyer_email: organization.billingEmail,
    buyer_company: true,
    positions: order.items.map((item) => ({
      name: item.packageName,
      quantity: item.quantity,
      tax: item.vatRate,
      total_price_gross: formatGrosze(item.lineGrossGrosze),
    })),
  };
  if (departmentId !== null) invoice.department_id = departmentId;
  return invoice;
}

export type FakturowniaKsefInfo = {
  govStatus: string | null;
  govId: string | null;
  verificationLink: string | null;
  errors: string[];
};

const REQUEST_TIMEOUT_MS = 20000;
const MAX_MESSAGE_LENGTH = 500;
const OID_PATTERN = /(^|[^a-z0-9])oid([^a-z0-9]|$)/i;

const asString = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

export function createFakturowniaClient(config: FakturowniaConfig, fetchImpl: typeof fetch = fetch) {
  const baseUrl = `https://${config.domain}.fakturownia.pl`;

  /** Never let the API token reach an error message, even if Fakturownia echoes it back. */
  function redact(text: string): string {
    return text.split(config.apiToken).join("***");
  }

  /** fetch with a hard timeout; timeouts and network failures surface as FakturowniaError without the URL. */
  async function send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
      const name = (err as { name?: string } | null)?.name;
      if (name === "TimeoutError" || name === "AbortError") {
        throw new FakturowniaError("Fakturownia nie odpowiedziała w czasie.", { code: "TIMEOUT" });
      }
      throw new FakturowniaError("Fakturownia: błąd połączenia.", { code: "SERVER" });
    }
  }

  async function readText(res: Response): Promise<string> {
    try {
      return await res.text();
    } catch {
      return "";
    }
  }

  function readJson(text: string): Record<string, any> | null {
    try {
      const data = JSON.parse(text);
      return data && typeof data === "object" ? data : null;
    } catch {
      return null;
    }
  }

  /** Raw validation messages from a JSON body (message/errors, any shape) or the plain text, token removed. */
  function describeBody(text: string): string {
    const data = readJson(text);
    const value: unknown = data ? (data.message ?? data.errors ?? data) : text;
    const out = typeof value === "string" ? value : JSON.stringify(value);
    return redact((out ?? "").trim()).slice(0, MAX_MESSAGE_LENGTH);
  }

  async function failure(res: Response, fallback: string): Promise<FakturowniaError> {
    const text = await readText(res);
    const details = describeBody(text);
    const suffix = `(HTTP ${res.status})${details ? `: ${details}` : ""}`;
    const status = res.status;
    if (status === 401 || status === 403) {
      return new FakturowniaError(`Fakturownia: odmowa dostępu, sprawdź token API ${suffix}`, { status, code: "AUTH" });
    }
    if (status >= 400 && status < 500) {
      if (OID_PATTERN.test(text)) {
        return new FakturowniaError(`Fakturownia: faktura dla tego zamówienia (oid) już istnieje ${suffix}`, {
          status,
          code: "DUPLICATE_OID",
        });
      }
      return new FakturowniaError(`${fallback} ${suffix}`, { status, code: "VALIDATION" });
    }
    return new FakturowniaError(`${fallback} ${suffix}`, { status, code: "SERVER" });
  }

  async function createInvoice(invoice: FakturowniaInvoiceInput): Promise<{ id: string; number: string; token: string }> {
    const res = await send(`${baseUrl}/invoices.json`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ api_token: config.apiToken, invoice }),
    });
    if (!res.ok) throw await failure(res, "Fakturownia: nie udało się wystawić faktury");
    const data = readJson(await readText(res));
    const id = typeof data?.id === "number" || typeof data?.id === "string" ? String(data.id) : null;
    const number = asString(data?.number);
    const token = asString(data?.token);
    if (!id || !number || !token) {
      throw new FakturowniaError("Fakturownia: niepełna odpowiedź na wystawienie faktury", { status: res.status, code: "SERVER" });
    }
    return { id, number, token };
  }

  async function sendInvoiceByEmail(id: string, recipients: { emailTo: string[]; emailCc: string[] }): Promise<void> {
    const query = [`api_token=${encodeURIComponent(config.apiToken)}`];
    if (recipients.emailTo.length > 0) query.push(`email_to=${recipients.emailTo.map(encodeURIComponent).join(",")}`);
    if (recipients.emailCc.length > 0) query.push(`email_cc=${recipients.emailCc.map(encodeURIComponent).join(",")}`);
    const res = await send(`${baseUrl}/invoices/${encodeURIComponent(id)}/send_by_email.json?${query.join("&")}`, {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw await failure(res, "Fakturownia: nie udało się wysłać faktury e-mailem");
    await readText(res);
  }

  async function getInvoiceKsef(id: string): Promise<FakturowniaKsefInfo> {
    const fields = "gov_status,gov_id,gov_verification_link,gov_error_messages";
    const res = await send(
      `${baseUrl}/invoices/${encodeURIComponent(id)}.json?fields[invoice]=${fields}&api_token=${encodeURIComponent(config.apiToken)}`,
      { method: "GET", headers: { Accept: "application/json" } },
    );
    if (!res.ok) throw await failure(res, "Fakturownia: nie udało się pobrać statusu KSeF");
    const raw = readJson(await readText(res));
    const data = raw?.invoice && typeof raw.invoice === "object" ? raw.invoice : raw;
    const rawErrors: unknown = data?.gov_error_messages;
    const errors = Array.isArray(rawErrors)
      ? rawErrors.map((e) => (typeof e === "string" ? e : JSON.stringify(e)))
      : asString(rawErrors)
        ? [rawErrors as string]
        : [];
    return {
      govStatus: asString(data?.gov_status),
      govId: asString(data?.gov_id),
      verificationLink: asString(data?.gov_verification_link),
      errors,
    };
  }

  /** Public PDF link; the invoice token is the secret, no API token needed. */
  function invoicePdfUrl(token: string): string {
    return `${baseUrl}/invoice/${encodeURIComponent(token)}.pdf`;
  }

  return { createInvoice, sendInvoiceByEmail, getInvoiceKsef, invoicePdfUrl };
}

export type FakturowniaClient = ReturnType<typeof createFakturowniaClient>;

let sharedClient: { key: string; client: FakturowniaClient } | null = null;

/** Process-wide client, recreated when any configuration value changes; null when Fakturownia is not configured. */
export function getSharedFakturowniaClient(env: Record<string, string | undefined> = process.env): FakturowniaClient | null {
  const config = getFakturowniaConfig(env);
  if (!config) return null;
  const key = JSON.stringify([config.domain, config.apiToken, config.departmentId]);
  if (!sharedClient || sharedClient.key !== key) {
    sharedClient = { key, client: createFakturowniaClient(config) };
  }
  return sharedClient.client;
}
