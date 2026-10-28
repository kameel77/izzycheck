import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isProformaEnabled, parseOrderPaymentAction } from "../proforma.ts";

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

describe("isProformaEnabled", () => {
  const fakturownia = { FAKTUROWNIA_DOMAIN: "mojafirma", FAKTUROWNIA_API_TOKEN: "token" };

  test("off when the switch is unset, empty or anything but true", () => {
    assert.equal(isProformaEnabled({ ...fakturownia }), false);
    assert.equal(isProformaEnabled({ ...fakturownia, PROFORMA_ENABLED: "" }), false);
    assert.equal(isProformaEnabled({ ...fakturownia, PROFORMA_ENABLED: "false" }), false);
    assert.equal(isProformaEnabled({ ...fakturownia, PROFORMA_ENABLED: "1" }), false);
    assert.equal(isProformaEnabled({ ...fakturownia, PROFORMA_ENABLED: "TRUE" }), false);
  });

  test("on for true (trimmed) when Fakturownia is configured", () => {
    assert.equal(isProformaEnabled({ ...fakturownia, PROFORMA_ENABLED: "true" }), true);
    assert.equal(isProformaEnabled({ ...fakturownia, PROFORMA_ENABLED: " true " }), true);
  });

  test("off when the switch is true but Fakturownia is not configured", () => {
    assert.equal(isProformaEnabled({ PROFORMA_ENABLED: "true" }), false);
    assert.equal(isProformaEnabled({ PROFORMA_ENABLED: "true", FAKTUROWNIA_DOMAIN: "mojafirma" }), false);
    assert.equal(isProformaEnabled({ PROFORMA_ENABLED: "true", FAKTUROWNIA_DOMAIN: "a.b.c", FAKTUROWNIA_API_TOKEN: "token" }), false);
  });

  test("reads process.env at call time by default", () => {
    const saved = { ...process.env };
    try {
      process.env.FAKTUROWNIA_DOMAIN = "mojafirma";
      process.env.FAKTUROWNIA_API_TOKEN = "token";
      delete process.env.PROFORMA_ENABLED;
      assert.equal(isProformaEnabled(), false);
      process.env.PROFORMA_ENABLED = "true";
      assert.equal(isProformaEnabled(), true);
    } finally {
      for (const key of ["FAKTUROWNIA_DOMAIN", "FAKTUROWNIA_API_TOKEN", "PROFORMA_ENABLED"]) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
  });
});
