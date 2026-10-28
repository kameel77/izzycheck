import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { buildLedgerWhere } from "../ledger.ts";

const ORG = "org-1";

describe("buildLedgerWhere", () => {
  test("USER asking for org scope is treated as mine", () => {
    assert.deepEqual(buildLedgerWhere({ userId: "u1", role: "USER", organizationId: ORG }, "org"), {
      organizationId: ORG,
      type: "USAGE",
      userId: "u1",
    });
  });

  test("MANAGER with org scope sees the whole organization", () => {
    assert.deepEqual(buildLedgerWhere({ userId: "m1", role: "MANAGER", organizationId: ORG }, "org"), {
      organizationId: ORG,
    });
  });

  test("MANAGER with mine scope sees only own usage", () => {
    assert.deepEqual(buildLedgerWhere({ userId: "m1", role: "MANAGER", organizationId: ORG }, "mine"), {
      organizationId: ORG,
      type: "USAGE",
      userId: "m1",
    });
  });

  test("ADMIN with an organization behaves like MANAGER for org scope", () => {
    assert.deepEqual(buildLedgerWhere({ userId: "a1", role: "ADMIN", organizationId: ORG }, "org"), {
      organizationId: ORG,
    });
  });
});
