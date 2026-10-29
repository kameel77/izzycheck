// Pages reachable without a valid session. Everything else matched by proxy.ts is guarded.
// `/credits/payment-return` handles its own "unauthorized" state for PayU returns.
const PUBLIC_PATHS = ["/login", "/credits/payment-return"];

export function isPublicPath(pathname: string): boolean {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return PUBLIC_PATHS.includes(normalized);
}
