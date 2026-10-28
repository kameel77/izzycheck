const REQUIRED_PAYU_VARS = [
  "PAYU_BASE_URL",
  "PAYU_POS_ID",
  "PAYU_CLIENT_ID",
  "PAYU_CLIENT_SECRET",
  "PAYU_SECOND_KEY",
  "APP_URL",
] as const;

/** True only when every variable needed for online (PayU) payments is set and non-empty. */
export function isPaymentsConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return REQUIRED_PAYU_VARS.every((name) => (env[name] ?? "").trim() !== "");
}
