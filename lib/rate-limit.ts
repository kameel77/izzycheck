interface RateLimitStore {
  count: number;
  resetTime: number;
}

const stores = new Map<string, Map<string, RateLimitStore>>();

/**
 * Simple in-memory rate limiter helper for API routes.
 * @param windowMs Time window in milliseconds (e.g. 60000ms = 1 min)
 * @param maxMax Maximum allowed requests per window
 * @param key Unique identifier key (e.g. IP address or User ID)
 * @param namespace Namespace for rate limiter (e.g. "login", "reports")
 */
export function isRateLimited(
  namespace: string,
  key: string,
  maxAllowed: number = 10,
  windowMs: number = 60000
): { limited: boolean; remaining: number; resetMs: number } {
  if (!stores.has(namespace)) {
    stores.set(namespace, new Map());
  }

  const storeMap = stores.get(namespace)!;
  const now = Date.now();
  const record = storeMap.get(key);

  if (!record || now > record.resetTime) {
    storeMap.set(key, { count: 1, resetTime: now + windowMs });
    return { limited: false, remaining: maxAllowed - 1, resetMs: windowMs };
  }

  if (record.count >= maxAllowed) {
    return { limited: true, remaining: 0, resetMs: record.resetTime - now };
  }

  record.count++;
  return { limited: false, remaining: maxAllowed - record.count, resetMs: record.resetTime - now };
}
