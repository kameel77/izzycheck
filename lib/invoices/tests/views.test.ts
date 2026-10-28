import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { InvoiceStatus } from "@prisma/client";
import { withAdminInvoice, withCustomerInvoice } from "../views.ts";

const buildUrl = (token: string) => `https://shop.fakturownia.pl/invoice/${token}.pdf`;

function row(invoiceStatus: InvoiceStatus, extra: { invoiceNumber?: string | null; invoiceToken?: string | null } = {}) {
  return {
    id: "order-1",
    totalGrossGrosze: 2460,
    invoiceStatus,
    invoiceNumber: extra.invoiceNumber === undefined ? "FV/1/10/2026" : extra.invoiceNumber,
    invoiceToken: extra.invoiceToken === undefined ? "secret-token" : extra.invoiceToken,
  };
}

describe("withCustomerInvoice", () => {
  test("ISSUED with a token exposes the number and the PDF link, never the token", () => {
    const view = withCustomerInvoice(row("ISSUED"), buildUrl);
    assert.deepEqual(view, {
      id: "order-1",
      totalGrossGrosze: 2460,
      invoiceStatus: "ISSUED",
      invoiceNumber: "FV/1/10/2026",
      invoicePdfUrl: "https://shop.fakturownia.pl/invoice/secret-token.pdf",
    });
    assert.ok(!("invoiceToken" in view));
  });

  test("ISSUED without a token (issued by hand) shows the number without a link", () => {
    const view = withCustomerInvoice(row("ISSUED", { invoiceToken: null }), buildUrl);
    assert.equal(view.invoiceStatus, "ISSUED");
    assert.equal(view.invoiceNumber, "FV/1/10/2026");
    assert.equal(view.invoicePdfUrl, null);
  });

  test("ISSUED while Fakturownia is not configured has no link", () => {
    assert.equal(withCustomerInvoice(row("ISSUED"), () => null).invoicePdfUrl, null);
  });

  test("PENDING, ISSUING, FAILED and NEEDS_ATTENTION are all just 'being prepared' without number or link", () => {
    for (const status of ["PENDING", "ISSUING", "FAILED", "NEEDS_ATTENTION"] as const) {
      const view = withCustomerInvoice(row(status), buildUrl);
      assert.equal(view.invoiceStatus, "PENDING", status);
      assert.equal(view.invoiceNumber, null, status);
      assert.equal(view.invoicePdfUrl, null, status);
      assert.ok(!("invoiceToken" in view), status);
    }
  });

  test("NOT_REQUIRED stays NOT_REQUIRED", () => {
    const view = withCustomerInvoice(row("NOT_REQUIRED", { invoiceNumber: null, invoiceToken: null }), buildUrl);
    assert.equal(view.invoiceStatus, "NOT_REQUIRED");
    assert.equal(view.invoicePdfUrl, null);
  });
});

describe("withAdminInvoice", () => {
  test("replaces the token by the PDF link and keeps the other fields", () => {
    const view = withAdminInvoice({ ...row("FAILED"), invoiceLastError: "boom" }, buildUrl);
    assert.ok(!("invoiceToken" in view));
    assert.equal(view.invoicePdfUrl, "https://shop.fakturownia.pl/invoice/secret-token.pdf");
    assert.equal(view.invoiceLastError, "boom");
    assert.equal(view.invoiceStatus, "FAILED");
  });

  test("no token, no link", () => {
    assert.equal(withAdminInvoice(row("ISSUED", { invoiceToken: null }), buildUrl).invoicePdfUrl, null);
  });
});
