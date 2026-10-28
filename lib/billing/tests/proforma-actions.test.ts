import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseOrderPaymentAction } from "../proforma.ts";

describe("parseOrderPaymentAction", () => {
  test("markPaid: date and trimmed note", () => {
    assert.deepEqual(parseOrderPaymentAction({ action: "markPaid", paidDate: "2026-10-28", note: "  przelew z 28.10  " }), {
      ok: true,
      value: { action: "markPaid", paidDate: "2026-10-28", note: "przelew z 28.10" },
    });
  });

  test("markPaid: missing, empty or whitespace note becomes null", () => {
    for (const note of [undefined, null, "", "   "]) {
      assert.deepEqual(parseOrderPaymentAction({ action: "markPaid", paidDate: "2026-10-28", note }), {
        ok: true,
        value: { action: "markPaid", paidDate: "2026-10-28", note: null },
      });
    }
  });

  test("markPaid: note of exactly 500 characters is accepted, 501 is refused", () => {
    const ok = parseOrderPaymentAction({ action: "markPaid", paidDate: "2026-10-28", note: "a".repeat(500) });
    assert.equal(ok.ok, true);
    const tooLong = parseOrderPaymentAction({ action: "markPaid", paidDate: "2026-10-28", note: "a".repeat(501) });
    assert.deepEqual(tooLong, { ok: false, error: "Notatka może mieć najwyżej 500 znaków." });
  });

  test("markPaid: the 500 character limit applies after trimming", () => {
    const result = parseOrderPaymentAction({ action: "markPaid", paidDate: "2026-10-28", note: ` ${"a".repeat(500)} ` });
    assert.equal(result.ok, true);
  });

  test("markPaid: non-string note is refused", () => {
    assert.deepEqual(parseOrderPaymentAction({ action: "markPaid", paidDate: "2026-10-28", note: 5 }), {
      ok: false,
      error: "Nieprawidłowa notatka.",
    });
  });

  test("markPaid: bad dates are refused", () => {
    for (const paidDate of [undefined, null, 20261028, "", "28.10.2026", "2026-10-28T12:00:00Z", "2026-02-30", "2026-13-01", "2026-1-5"]) {
      assert.deepEqual(parseOrderPaymentAction({ action: "markPaid", paidDate }), { ok: false, error: "Nieprawidłowa data wpłaty." }, String(paidDate));
    }
  });

  test("cancel", () => {
    assert.deepEqual(parseOrderPaymentAction({ action: "cancel" }), { ok: true, value: { action: "cancel" } });
  });

  test("unknown action and non-object bodies are refused", () => {
    for (const body of [{ action: "refund" }, {}, null, undefined, "markPaid", 5, []]) {
      assert.deepEqual(parseOrderPaymentAction(body), { ok: false, error: "Nieprawidłowa akcja." });
    }
  });
});
