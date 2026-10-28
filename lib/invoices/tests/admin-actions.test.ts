import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseInvoiceAction } from "../admin-actions.ts";

describe("parseInvoiceAction", () => {
  test("accepts retry and refreshKsef", () => {
    assert.deepEqual(parseInvoiceAction({ action: "retry" }), { ok: true, value: { action: "retry" } });
    assert.deepEqual(parseInvoiceAction({ action: "refreshKsef" }), { ok: true, value: { action: "refreshKsef" } });
  });

  test("accepts markEmailed and passes no extra fields on", () => {
    assert.deepEqual(parseInvoiceAction({ action: "markEmailed" }), { ok: true, value: { action: "markEmailed" } });
    assert.deepEqual(parseInvoiceAction({ action: "markEmailed", invoiceNumber: "FV/1" }), {
      ok: true,
      value: { action: "markEmailed" },
    });
    assert.equal(parseInvoiceAction({ action: "MARKEMAILED" }).ok, false);
  });

  test("markManual trims the invoice number", () => {
    assert.deepEqual(parseInvoiceAction({ action: "markManual", invoiceNumber: "  FV/12/10/2026 " }), {
      ok: true,
      value: { action: "markManual", invoiceNumber: "FV/12/10/2026" },
    });
  });

  test("markManual accepts 1 and 64 characters, rejects 0 and 65", () => {
    assert.equal(parseInvoiceAction({ action: "markManual", invoiceNumber: "1" }).ok, true);
    assert.equal(parseInvoiceAction({ action: "markManual", invoiceNumber: "x".repeat(64) }).ok, true);
    assert.equal(parseInvoiceAction({ action: "markManual", invoiceNumber: "x".repeat(65) }).ok, false);
    assert.equal(parseInvoiceAction({ action: "markManual", invoiceNumber: "" }).ok, false);
    assert.equal(parseInvoiceAction({ action: "markManual", invoiceNumber: "   " }).ok, false);
  });

  test("markManual rejects a missing or non-string number", () => {
    assert.equal(parseInvoiceAction({ action: "markManual" }).ok, false);
    assert.equal(parseInvoiceAction({ action: "markManual", invoiceNumber: 123 }).ok, false);
    assert.equal(parseInvoiceAction({ action: "markManual", invoiceNumber: null }).ok, false);
  });

  test("rejects unknown actions and malformed bodies with a Polish message", () => {
    for (const body of [null, undefined, "retry", 5, [], {}, { action: "delete" }, { action: 1 }, { action: "RETRY" }]) {
      const parsed = parseInvoiceAction(body);
      assert.equal(parsed.ok, false, JSON.stringify(body));
      if (!parsed.ok) assert.ok(parsed.error.length > 0);
    }
  });

  test("extra fields are not passed on", () => {
    assert.deepEqual(parseInvoiceAction({ action: "retry", invoiceNumber: "FV/1", status: "ISSUED" }), {
      ok: true,
      value: { action: "retry" },
    });
  });
});
