import assert from "node:assert/strict";
import { describe, mock, test } from "node:test";
import { handleBillingCronRequest } from "../cron-handler.ts";

const counters = { invoicesProcessed: 2, ksefRefreshed: 3, emailsSent: 1, ordersSynced: 4, budgetExhausted: false };

function request(authorization?: string): Request {
  return new Request("http://localhost/api/internal/billing-cron", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });
}

function runner() {
  let calls = 0;
  return {
    calls: () => calls,
    run: async () => {
      calls += 1;
      return counters;
    },
  };
}

describe("handleBillingCronRequest", () => {
  test("503 when BILLING_CRON_SECRET is not configured (even with a header)", async () => {
    const r = runner();
    for (const secret of [undefined, "", "   "]) {
      const res = await handleBillingCronRequest(request("Bearer anything"), { secret, run: r.run });
      assert.equal(res.status, 503);
    }
    assert.equal(r.calls(), 0);
  });

  test("401 without or with a wrong secret, and nothing runs", async () => {
    const r = runner();
    const secret = "correct-secret-value";
    for (const header of [undefined, "Bearer wrong-secret-value!", "Bearer short", "correct-secret-value", "Bearer correct-secret-valuE"]) {
      const res = await handleBillingCronRequest(request(header), { secret, run: r.run });
      assert.equal(res.status, 401, String(header));
    }
    assert.equal(r.calls(), 0);
  });

  test("200 with only the counters when the secret matches", async () => {
    const r = runner();
    const info = mock.method(console, "info", () => {});
    try {
      const res = await handleBillingCronRequest(request("Bearer correct-secret-value"), {
        secret: "correct-secret-value",
        run: r.run,
      });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), counters);
      assert.equal(r.calls(), 1);
    } finally {
      info.mock.restore();
    }
  });

  test("500 with a generic message when the run throws", async () => {
    const error = mock.method(console, "error", () => {});
    try {
      const res = await handleBillingCronRequest(request("Bearer s3cret"), {
        secret: "s3cret",
        run: async () => {
          throw new Error("db password leaked here");
        },
      });
      assert.equal(res.status, 500);
      assert.doesNotMatch(JSON.stringify(await res.json()), /leaked/);
    } finally {
      error.mock.restore();
    }
  });
});
