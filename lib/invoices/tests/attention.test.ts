import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { getInvoiceConfigWarnings } from "../attention.ts";

test("getInvoiceConfigWarnings: only production with both sandbox flags warns, and the error is logged once", () => {
  const error = mock.method(console, "error", () => {});
  try {
    assert.deepEqual(getInvoiceConfigWarnings({ NODE_ENV: "production", PAYU_ALLOW_SANDBOX: "true" }), []);
    assert.deepEqual(getInvoiceConfigWarnings({ NODE_ENV: "production", INVOICE_SANDBOX_ORDERS: "true" }), []);
    assert.deepEqual(getInvoiceConfigWarnings({ NODE_ENV: "development", PAYU_ALLOW_SANDBOX: "true", INVOICE_SANDBOX_ORDERS: "true" }), []);
    assert.equal(error.mock.calls.length, 0);

    const prod = { NODE_ENV: "production", PAYU_ALLOW_SANDBOX: "true", INVOICE_SANDBOX_ORDERS: "true" };
    const first = getInvoiceConfigWarnings(prod);
    assert.equal(first.length, 1);
    assert.match(first[0], /PAYU_ALLOW_SANDBOX/);
    assert.match(first[0], /INVOICE_SANDBOX_ORDERS/);
    assert.equal(getInvoiceConfigWarnings(prod).length, 1);
    assert.equal(error.mock.calls.length, 1);
    assert.equal(error.mock.calls[0].arguments[0], "[INVOICE_SANDBOX_IN_PRODUCTION]");
  } finally {
    error.mock.restore();
  }
});
