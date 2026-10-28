import { timingSafeEqual } from "node:crypto";
import type { BillingCronResult } from "./service.ts";

function isAuthorized(header: string | null, secret: string): boolean {
  const received = Buffer.from(header ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  // timingSafeEqual needs equal lengths; a length mismatch is rejected without comparing.
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/**
 * Request handling of POST /api/internal/billing-cron, kept apart from the route so it can be tested without
 * Next. No secret configured: 503; missing or wrong Bearer secret: 401; otherwise only the counters are returned.
 */
export async function handleBillingCronRequest(
  req: Request,
  deps: { secret: string | undefined; run: () => Promise<BillingCronResult> },
): Promise<Response> {
  const secret = deps.secret?.trim();
  if (!secret) {
    return Response.json({ error: "Cron nie jest skonfigurowany." }, { status: 503 });
  }
  if (!isAuthorized(req.headers.get("authorization"), secret)) {
    return Response.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  try {
    const result = await deps.run();
    console.info("[BILLING_CRON]", result);
    return Response.json(result);
  } catch (error) {
    console.error("[BILLING_CRON_ERROR]", error);
    return Response.json({ error: "Nie udało się wykonać zadania." }, { status: 500 });
  }
}
