import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  CREDIT_TYPE_LABELS,
  INVOICE_STATUS_LABELS,
  LEDGER_TYPE_LABELS,
  ORDER_STATUS_LABELS,
  formatCreditAmount,
  formatCreditCount,
  formatGrosze,
  formatOrderItem,
  invoiceStatusLabel,
} from "../labels.ts";

describe("formatCreditAmount", () => {
  test("zero is shown as free usage", () => {
    assert.equal(formatCreditAmount(0), "0 (bez opłaty)");
  });

  test("positive amounts get a plus sign", () => {
    assert.equal(formatCreditAmount(10), "+10");
  });

  test("negative amounts keep their minus sign", () => {
    assert.equal(formatCreditAmount(-1), "-1");
  });
});

describe("labels", () => {
  test("every ledger and credit type has a Polish label", () => {
    assert.deepEqual(LEDGER_TYPE_LABELS, { USAGE: "Zużycie", MANUAL_ADJUSTMENT: "Korekta", PURCHASE: "Zakup" });
    assert.deepEqual(CREDIT_TYPE_LABELS, { VALUATION: "Wycena", CLAIM_DETAILS: "Szczegóły szkód" });
  });
});

describe("order labels", () => {
  test("every order status has a Polish label", () => {
    assert.deepEqual(ORDER_STATUS_LABELS, {
      PENDING_PAYMENT: "Oczekuje na płatność",
      PAID: "Opłacone",
      CANCELED: "Anulowane",
      FAILED: "Nieudane",
    });
  });

  test("every invoice status has its admin label", () => {
    assert.deepEqual(INVOICE_STATUS_LABELS, {
      NOT_REQUIRED: "Nie dotyczy",
      PENDING: "Do wystawienia",
      ISSUING: "W trakcie",
      ISSUED: "Wystawiona",
      FAILED: "Błąd (ponowienie)",
      NEEDS_ATTENTION: "Wymaga sprawdzenia",
    });
  });

  test("order lines read as '<credits> <noun> ×<quantity>' with Polish plurals", () => {
    assert.equal(
      formatOrderItem({ creditType: "CLAIM_DETAILS", creditsPerPackage: 10, quantity: 1 }),
      "10 raportów historii szkód ×1",
    );
    assert.equal(formatOrderItem({ creditType: "VALUATION", creditsPerPackage: 1, quantity: 25 }), "1 wycena pojazdu ×25");
    assert.equal(formatOrderItem({ creditType: "VALUATION", creditsPerPackage: 2, quantity: 1 }), "2 wyceny pojazdu ×1");
    assert.equal(formatOrderItem({ creditType: "VALUATION", creditsPerPackage: 12, quantity: 1 }), "12 wycen pojazdu ×1");
    assert.equal(formatOrderItem({ creditType: "VALUATION", creditsPerPackage: 22, quantity: 1 }), "22 wyceny pojazdu ×1");
    assert.equal(
      formatOrderItem({ creditType: "CLAIM_DETAILS", creditsPerPackage: 5, quantity: 2 }),
      "5 raportów historii szkód ×2",
    );
  });

  test("credit counts use the right Polish plural", () => {
    assert.equal(formatCreditCount(1), "1 kredyt");
    assert.equal(formatCreditCount(3), "3 kredyty");
    assert.equal(formatCreditCount(10), "10 kredytów");
    assert.equal(formatCreditCount(13), "13 kredytów");
    assert.equal(formatCreditCount(24), "24 kredyty");
  });

  test("grosze are formatted as PLN", () => {
    assert.equal(formatGrosze(12345).replace(/\s/g, " "), "123,45 zł");
    assert.equal(formatGrosze(0).replace(/\s/g, " "), "0,00 zł");
  });
});

describe("invoiceStatusLabel", () => {
  test("a FAILED invoice without a next attempt can only be fixed by hand", () => {
    assert.equal(invoiceStatusLabel("FAILED", null), "Błąd (tylko ręcznie)");
    assert.equal(invoiceStatusLabel("FAILED", new Date()), "Błąd (ponowienie)");
    assert.equal(invoiceStatusLabel("FAILED", "2026-10-29T12:00:00.000Z"), "Błąd (ponowienie)");
  });

  test("other statuses keep their label whatever the next attempt", () => {
    for (const status of ["NOT_REQUIRED", "PENDING", "ISSUING", "ISSUED", "NEEDS_ATTENTION"] as const) {
      assert.equal(invoiceStatusLabel(status, null), INVOICE_STATUS_LABELS[status], status);
      assert.equal(invoiceStatusLabel(status, new Date()), INVOICE_STATUS_LABELS[status], status);
    }
  });
});
