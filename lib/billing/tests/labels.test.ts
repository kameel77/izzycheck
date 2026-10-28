import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  CREDIT_TYPE_LABELS,
  INVOICE_STATUS_LABELS,
  LEDGER_TYPE_LABELS,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  formatYmdPl,
  orderStatusLabel,
  formatCreditAmount,
  describeCronAge,
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

describe("describeCronAge", () => {
  const now = new Date("2026-10-29T12:00:00.000Z").getTime();
  const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

  test("a cron that never ran is stale", () => {
    assert.deepEqual(describeCronAge(null, now), { text: "brak (cron nie uruchomił się)", stale: true });
  });

  test("minutes ago, stale only beyond 15 minutes", () => {
    assert.deepEqual(describeCronAge(ago(0), now), { text: "0 min temu", stale: false });
    assert.deepEqual(describeCronAge(ago(5), now), { text: "5 min temu", stale: false });
    assert.deepEqual(describeCronAge(ago(15), now), { text: "15 min temu", stale: false });
    assert.deepEqual(describeCronAge(ago(16), now), { text: "16 min temu", stale: true });
  });

  test("long gaps are shown in hours and a clock slightly ahead does not go negative", () => {
    assert.deepEqual(describeCronAge(ago(180), now), { text: "3 h temu", stale: true });
    assert.deepEqual(describeCronAge(ago(-2), now), { text: "0 min temu", stale: false });
  });
});

describe("PAYMENT_METHOD_LABELS", () => {
  test("every payment method has a Polish label", () => {
    assert.deepEqual(PAYMENT_METHOD_LABELS, { PAYU: "PayU", PROFORMA: "Proforma" });
  });
});

describe("orderStatusLabel", () => {
  const now = new Date("2026-10-30T10:00:00.000Z");
  const proforma = (status: "PENDING_PAYMENT" | "PAID" | "CANCELED" | "FAILED", proformaDueDate: string | Date | null) => ({
    status,
    paymentMethod: "PROFORMA" as const,
    proformaDueDate,
  });

  test("a pending proforma within its term awaits the transfer, also on the due day", () => {
    assert.equal(orderStatusLabel(proforma("PENDING_PAYMENT", "2026-11-03"), now), "Oczekuje na przelew");
    assert.equal(orderStatusLabel(proforma("PENDING_PAYMENT", "2026-10-30"), now), "Oczekuje na przelew");
    assert.equal(orderStatusLabel(proforma("PENDING_PAYMENT", new Date("2026-11-03T00:00:00.000Z")), now), "Oczekuje na przelew");
  });

  test("a pending proforma past its due date is expired", () => {
    assert.equal(orderStatusLabel(proforma("PENDING_PAYMENT", "2026-10-29"), now), "Wygasło");
    assert.equal(orderStatusLabel(proforma("PENDING_PAYMENT", new Date("2026-10-29T00:00:00.000Z")), now), "Wygasło");
  });

  test("other proforma statuses use the common labels", () => {
    assert.equal(orderStatusLabel(proforma("PAID", "2026-10-01"), now), "Opłacone");
    assert.equal(orderStatusLabel(proforma("CANCELED", "2026-10-01"), now), "Anulowane");
    assert.equal(orderStatusLabel(proforma("FAILED", null), now), "Nieudane");
  });

  test("a PayU order keeps the common labels", () => {
    const payu = (status: "PENDING_PAYMENT" | "PAID") => ({ status, paymentMethod: "PAYU" as const, proformaDueDate: null });
    assert.equal(orderStatusLabel(payu("PENDING_PAYMENT"), now), "Oczekuje na płatność");
    assert.equal(orderStatusLabel(payu("PAID"), now), "Opłacone");
  });
});

describe("formatYmdPl", () => {
  test("writes a date as DD.MM.RRRR, from a plain date or a serialized @db.Date", () => {
    assert.equal(formatYmdPl("2026-11-03"), "03.11.2026");
    assert.equal(formatYmdPl("2026-11-03T00:00:00.000Z"), "03.11.2026");
  });
});
