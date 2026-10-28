import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { InvoiceStatus } from "@prisma/client";
import { withAdminInvoice, withCustomerInvoice, withCustomerProforma } from "../views.ts";

const buildUrl = (token: string) => `https://shop.fakturownia.pl/invoice/${token}.pdf`;

function row(
  invoiceStatus: InvoiceStatus,
  extra: {
    invoiceNumber?: string | null;
    invoiceToken?: string | null;
    fakturowniaInvoiceId?: string | null;
    ksefStatus?: string | null; invoiceEmailedAt?: Date | null } = {},
) {
  return {
    id: "order-1",
    totalGrossGrosze: 2460,
    invoiceStatus,
    invoiceNumber: extra.invoiceNumber === undefined ? "FV/1/10/2026" : extra.invoiceNumber,
    invoiceToken: extra.invoiceToken === undefined ? "secret-token" : extra.invoiceToken,
    fakturowniaInvoiceId: extra.fakturowniaInvoiceId === undefined ? "INV-1" : extra.fakturowniaInvoiceId,
    ksefStatus: extra.ksefStatus === undefined ? "ok" : extra.ksefStatus,
    invoiceEmailedAt: extra.invoiceEmailedAt === undefined ? null : extra.invoiceEmailedAt,
  };
}

function proformaRow(extra: Partial<{
  proformaNumber: string | null;
  proformaToken: string | null;
  proformaFakturowniaId: string | null;
  proformaDueDate: Date | string | null;
  proformaEmailedAt: Date | null;
  proformaLastError: string | null;
}> = {}) {
  return {
    id: "order-2",
    paymentMethod: "PROFORMA" as const,
    proformaNumber: "PRO/7/10/2026",
    proformaToken: "proforma-secret",
    proformaFakturowniaId: "PF-1",
    proformaDueDate: new Date("2026-11-13T00:00:00.000Z") as Date | string | null,
    proformaEmailedAt: null as Date | null,
    proformaLastError: null as string | null,
    ...extra,
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
    assert.ok(!("invoiceToken" in view) && !("ksefStatus" in view) && !("invoiceEmailedAt" in view));
  });

  test("ISSUED by hand (no Fakturownia id, no token) shows the number without a link, whatever KSeF says", () => {
    for (const ksefStatus of [null, "send_error"]) {
      const view = withCustomerInvoice(
        row("ISSUED", { fakturowniaInvoiceId: null, invoiceToken: null, ksefStatus, invoiceNumber: "FV/ręczna/7" }),
        buildUrl,
      );
      assert.equal(view.invoiceStatus, "ISSUED", String(ksefStatus));
      assert.equal(view.invoiceNumber, "FV/ręczna/7", String(ksefStatus));
      assert.equal(view.invoicePdfUrl, null, String(ksefStatus));
    }
  });

  test("an automatic invoice without a token never shows anything", () => {
    const view = withCustomerInvoice(row("ISSUED", { invoiceToken: null }), buildUrl);
    assert.equal(view.invoiceStatus, "PENDING");
    assert.equal(view.invoiceNumber, null);
    assert.equal(view.invoicePdfUrl, null);
  });

  test("ISSUED is shown for OK and final KSeF statuses (and their demo variants)", () => {
    for (const ksefStatus of ["ok", "offline", "not_applicable", "demo_ok", "demo_offline", "demo_not_applicable"]) {
      const view = withCustomerInvoice(row("ISSUED", { ksefStatus }), buildUrl);
      assert.equal(view.invoiceStatus, "ISSUED", ksefStatus);
      assert.equal(view.invoiceNumber, "FV/1/10/2026", ksefStatus);
      assert.ok(view.invoicePdfUrl, ksefStatus);
    }
  });

  test("ISSUED with a missing, pending or failing KSeF status stays 'being prepared' until it was e-mailed", () => {
    const emailedAt = new Date("2026-10-29T10:00:00Z");
    for (const ksefStatus of [null, "processing", "demo_processing", "send_error", "server_error", "duplicate_error", "offline_error"]) {
      const hidden = withCustomerInvoice(row("ISSUED", { ksefStatus }), buildUrl);
      assert.equal(hidden.invoiceStatus, "PENDING", String(ksefStatus));
      assert.equal(hidden.invoiceNumber, null, String(ksefStatus));
      assert.equal(hidden.invoicePdfUrl, null, String(ksefStatus));
      assert.ok(!JSON.stringify(hidden).includes("secret-token"), String(ksefStatus));

      const emailed = withCustomerInvoice(row("ISSUED", { ksefStatus, invoiceEmailedAt: emailedAt }), buildUrl);
      assert.equal(emailed.invoiceStatus, "ISSUED", String(ksefStatus));
      assert.ok(emailed.invoicePdfUrl, String(ksefStatus));
    }
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

describe("withCustomerProforma", () => {
  test("exposes the number, the PDF link and the due date, never the token or internals", () => {
    const view = withCustomerProforma(
      proformaRow({ proformaEmailedAt: new Date("2026-10-30T10:00:00Z"), proformaLastError: "smtp down" }),
      buildUrl,
    );
    assert.deepEqual(view, {
      id: "order-2",
      paymentMethod: "PROFORMA",
      proformaNumber: "PRO/7/10/2026",
      proformaPdfUrl: "https://shop.fakturownia.pl/invoice/proforma-secret.pdf",
      proformaDueDate: "2026-11-13",
    });
    // The token only ever appears inside the ready PDF link.
    assert.ok(!JSON.stringify({ ...view, proformaPdfUrl: null }).includes("proforma-secret"));
    assert.ok(!("proformaToken" in view) && !("proformaFakturowniaId" in view));
    assert.ok(!("proformaLastError" in view) && !("proformaEmailedAt" in view));
  });

  test("a due date that is already a YYYY-MM-DD string is kept", () => {
    assert.equal(withCustomerProforma(proformaRow({ proformaDueDate: "2026-11-13" }), buildUrl).proformaDueDate, "2026-11-13");
  });

  test("a PayU order has no proforma: all three fields are null", () => {
    const view = withCustomerProforma(
      proformaRow({
        proformaNumber: null,
        proformaToken: null,
        proformaFakturowniaId: null,
        proformaDueDate: null,
      }),
      buildUrl,
    );
    assert.equal(view.proformaNumber, null);
    assert.equal(view.proformaPdfUrl, null);
    assert.equal(view.proformaDueDate, null);
  });

  test("no PDF link when the PDF builder has none (Fakturownia not configured)", () => {
    assert.equal(withCustomerProforma(proformaRow(), () => null).proformaPdfUrl, null);
  });
});

describe("withAdminInvoice", () => {
  test("replaces the proforma token by the PDF link too", () => {
    const view = withAdminInvoice({ ...row("ISSUED"), proformaToken: "proforma-secret" }, buildUrl);
    assert.ok(!("proformaToken" in view));
    assert.equal(view.proformaPdfUrl, "https://shop.fakturownia.pl/invoice/proforma-secret.pdf");
    assert.ok(!JSON.stringify({ ...view, proformaPdfUrl: null }).includes("proforma-secret"));
    assert.equal(withAdminInvoice({ ...row("ISSUED"), proformaToken: null }, buildUrl).proformaPdfUrl, null);
  });

  test("replaces the token by the PDF link and keeps the other fields", () => {
    const view = withAdminInvoice({ ...row("FAILED"), proformaToken: null, invoiceLastError: "boom" }, buildUrl);
    assert.ok(!("invoiceToken" in view));
    assert.equal(view.invoicePdfUrl, "https://shop.fakturownia.pl/invoice/secret-token.pdf");
    assert.equal(view.invoiceLastError, "boom");
    assert.equal(view.invoiceStatus, "FAILED");
  });

  test("no token, no link", () => {
    assert.equal(withAdminInvoice({ ...row("ISSUED", { invoiceToken: null }), proformaToken: null }, buildUrl).invoicePdfUrl, null);
  });
});
