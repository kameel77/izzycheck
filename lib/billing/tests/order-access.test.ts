import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { canResumePayment, canViewOrder } from "../order-access.ts";

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

describe("canResumePayment", () => {
  const pending = { userId: "creator", status: "PENDING_PAYMENT", payuRedirectUri: "https://pay.example/x" };

  test("creator of a pending order with a link can resume", () => {
    assert.equal(canResumePayment("creator", pending), true);
  });

  test("another user (even a manager) cannot", () => {
    assert.equal(canResumePayment("manager", pending), false);
  });

  test("non-pending orders and orders without a link cannot", () => {
    assert.equal(canResumePayment("creator", { ...pending, status: "PAID" }), false);
    assert.equal(canResumePayment("creator", { ...pending, status: "CANCELED" }), false);
    assert.equal(canResumePayment("creator", { ...pending, payuRedirectUri: null }), false);
  });
});
