import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseAdminOrderFilters } from "../admin-orders.ts";

const parse = (query: string) => parseAdminOrderFilters(new URLSearchParams(query));

describe("parseAdminOrderFilters", () => {
  test("no filters by default", () => {
    assert.deepEqual(parse(""), {});
  });

  test("accepts known enum values and an organization id", () => {
    assert.deepEqual(parse("status=PAID&invoiceStatus=NEEDS_ATTENTION&organizationId=org-1"), {
      status: "PAID",
      invoiceStatus: "NEEDS_ATTENTION",
      organizationId: "org-1",
    });
  });

  test("paymentMethod accepts known methods and ignores unknown ones", () => {
    assert.deepEqual(parse("paymentMethod=PROFORMA"), { paymentMethod: "PROFORMA" });
    assert.deepEqual(parse("paymentMethod=PAYU&status=PAID"), { paymentMethod: "PAYU", status: "PAID" });
    assert.deepEqual(parse("paymentMethod=BLIK"), {});
    assert.deepEqual(parse("paymentMethod=proforma"), {});
    assert.deepEqual(parse("paymentMethod=toString"), {});
    assert.deepEqual(parse("paymentMethod="), {});
  });

  test("ksefProblem is on only for the exact value true", () => {
    assert.deepEqual(parse("ksefProblem=true"), { ksefProblem: true });
    assert.deepEqual(parse("ksefProblem=false&status=PAID"), { status: "PAID" });
    assert.deepEqual(parse("ksefProblem=1"), {});
  });

  test("ignores unknown values, blank ids and inherited property names", () => {
    assert.deepEqual(parse("status=REFUNDED&invoiceStatus=paid&organizationId=%20%20"), {});
    assert.deepEqual(parse("status=toString&invoiceStatus=__proto__&organizationId="), {});
  });
});
