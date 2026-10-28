import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { canViewOrder } from "../order-access.ts";

const order = { userId: "creator", organizationId: "org-1" };

describe("canViewOrder", () => {
  test("creator can view", () => {
    assert.equal(canViewOrder({ userId: "creator", role: "USER", organizationId: "org-1" }, order), true);
  });

  test("another USER of the same organization cannot", () => {
    assert.equal(canViewOrder({ userId: "other", role: "USER", organizationId: "org-1" }, order), false);
  });

  test("MANAGER of the same organization can", () => {
    assert.equal(canViewOrder({ userId: "m1", role: "MANAGER", organizationId: "org-1" }, order), true);
  });

  test("MANAGER of another organization cannot", () => {
    assert.equal(canViewOrder({ userId: "m1", role: "MANAGER", organizationId: "org-2" }, order), false);
  });

  test("ADMIN of the same organization can, ADMIN without organization cannot", () => {
    assert.equal(canViewOrder({ userId: "a1", role: "ADMIN", organizationId: "org-1" }, order), true);
    assert.equal(canViewOrder({ userId: "a1", role: "ADMIN", organizationId: null }, order), false);
  });

  test("creator who moved to another organization cannot", () => {
    assert.equal(canViewOrder({ userId: "creator", role: "USER", organizationId: "org-2" }, order), false);
    assert.equal(canViewOrder({ userId: "creator", role: "USER", organizationId: null }, order), false);
  });
});
