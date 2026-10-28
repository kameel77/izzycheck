import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { KSEF_STALE_AFTER_MS, isInvoiceVisibleToCustomer, ksefProblem, type KsefProblemInput } from "../ksef.ts";

const HOUR = 60 * 60_000;
const issuedAt = new Date("2026-10-29T08:00:00.000Z");

function order(ksefStatus: string | null, extra: Partial<KsefProblemInput> = {}): KsefProblemInput {
  return { invoiceStatus: "ISSUED", fakturowniaInvoiceId: "INV-1", ksefStatus, invoiceIssuedAt: issuedAt, ...extra };
}

const at = (hoursAfterIssue: number) => new Date(issuedAt.getTime() + hoursAfterIssue * HOUR);

describe("ksefProblem", () => {
  test("healthy statuses and their demo variants are no problem, however old", () => {
    for (const base of ["ok", "offline", "not_applicable"]) {
      for (const status of [base, `demo_${base}`]) assert.equal(ksefProblem(order(status), at(24 * 20)), null, status);
    }
  });

  test("every other status is an ERROR at once", () => {
    for (const status of [
      "send_error",
      "server_error",
      "status_check_error",
      "duplicate_error",
      "blocked_403_error",
      "not_connected",
      "offline_error",
      "demo_send_error",
      "demo_duplicate_error",
      "something_new",
    ]) {
      assert.equal(ksefProblem(order(status), at(0)), "ERROR", status);
    }
  });

  test("no status or processing is fine for 6 h and STALE after that", () => {
    for (const status of [null, "processing", "demo_processing"]) {
      assert.equal(ksefProblem(order(status), at(0)), null, String(status));
      assert.equal(ksefProblem(order(status), at(6)), null, `${status} at exactly 6 h`);
      assert.equal(ksefProblem(order(status), new Date(issuedAt.getTime() + KSEF_STALE_AFTER_MS + 1)), "STALE", String(status));
    }
  });

  test("only invoices issued through Fakturownia are tracked", () => {
    assert.equal(ksefProblem(order("send_error", { invoiceStatus: "FAILED" }), at(10)), null);
    assert.equal(ksefProblem(order(null, { fakturowniaInvoiceId: null }), at(10)), null);
    assert.equal(ksefProblem(order("send_error", { fakturowniaInvoiceId: null }), at(10)), null);
  });

  test("without an issue date the age is unknown, so a missing status is no problem", () => {
    assert.equal(ksefProblem(order(null, { invoiceIssuedAt: null }), at(100)), null);
  });
});

describe("isInvoiceVisibleToCustomer", () => {
  test("KSeF ok-and-final statuses or an e-mailed invoice", () => {
    assert.equal(isInvoiceVisibleToCustomer({ ksefStatus: "ok", invoiceEmailedAt: null }), true);
    assert.equal(isInvoiceVisibleToCustomer({ ksefStatus: "demo_offline", invoiceEmailedAt: null }), true);
    assert.equal(isInvoiceVisibleToCustomer({ ksefStatus: "processing", invoiceEmailedAt: null }), false);
    assert.equal(isInvoiceVisibleToCustomer({ ksefStatus: null, invoiceEmailedAt: null }), false);
    assert.equal(isInvoiceVisibleToCustomer({ ksefStatus: "send_error", invoiceEmailedAt: new Date() }), true);
  });
});
