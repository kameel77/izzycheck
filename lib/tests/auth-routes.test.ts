import assert from "node:assert";
import { test, describe } from "node:test";
import { isPublicPath } from "../auth-routes.ts";

describe("isPublicPath", () => {
  test("login and PayU return pages are public", () => {
    assert.strictEqual(isPublicPath("/login"), true);
    assert.strictEqual(isPublicPath("/login/"), true);
    assert.strictEqual(isPublicPath("/credits/payment-return"), true);
  });

  test("app pages are guarded", () => {
    for (const p of ["/", "/dashboard", "/history", "/reports/abc", "/team", "/credits", "/audit", "/admin/users"]) {
      assert.strictEqual(isPublicPath(p), false, p);
    }
  });

  test("only exact public paths match, not prefixes", () => {
    assert.strictEqual(isPublicPath("/login-evil"), false);
    assert.strictEqual(isPublicPath("/credits/payment-return/extra"), false);
  });
});
