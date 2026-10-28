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

  test("ignores unknown values, blank ids and inherited property names", () => {
    assert.deepEqual(parse("status=REFUNDED&invoiceStatus=paid&organizationId=%20%20"), {});
    assert.deepEqual(parse("status=toString&invoiceStatus=__proto__&organizationId="), {});
  });
});
