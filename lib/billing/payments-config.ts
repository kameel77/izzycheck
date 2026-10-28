import { getPayuConfig } from "../payments/payu.ts";

/** True only when every variable needed for online (PayU) payments is set and non-empty. */
export function isPaymentsConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return getPayuConfig(env) !== null;
}
