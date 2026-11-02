import assert from "node:assert";
import { test, describe } from "node:test";
import { shouldRedirectToLogin } from "../auth-redirect.ts";

const PAGE = "https://new.izzycheck.pl/admin/organizations";

describe("shouldRedirectToLogin", () => {
  test("401 from an API call on a guarded page redirects", () => {
    assert.strictEqual(shouldRedirectToLogin(401, "/api/admin/organizations", PAGE), true);
    assert.strictEqual(
      shouldRedirectToLogin(401, "https://new.izzycheck.pl/api/admin/organizations", PAGE),
      true,
    );
    assert.strictEqual(shouldRedirectToLogin(401, "/api/auth/me", PAGE), true);
  });

  test("other statuses do not redirect", () => {
    for (const status of [200, 403, 500]) {
      assert.strictEqual(shouldRedirectToLogin(status, "/api/admin/organizations", PAGE), false, String(status));
    }
  });

  test("login endpoint 401 (wrong credentials) does not redirect", () => {
    assert.strictEqual(shouldRedirectToLogin(401, "/api/auth/login", PAGE), false);
  });

  test("public pages do not redirect", () => {
    assert.strictEqual(shouldRedirectToLogin(401, "/api/auth/me", "https://new.izzycheck.pl/login"), false);
    assert.strictEqual(
      shouldRedirectToLogin(401, "/api/credits", "https://new.izzycheck.pl/credits/payment-return?x=1"),
      false,
    );
  });

  test("cross-origin and non-API requests do not redirect", () => {
    assert.strictEqual(shouldRedirectToLogin(401, "https://other.example.com/api/admin/organizations", PAGE), false);
    assert.strictEqual(shouldRedirectToLogin(401, "/admin/organizations", PAGE), false);
    assert.strictEqual(shouldRedirectToLogin(401, "/apix/foo", PAGE), false);
  });

  test("invalid input does not redirect", () => {
    assert.strictEqual(shouldRedirectToLogin(401, "http://", PAGE), false);
    assert.strictEqual(shouldRedirectToLogin(401, "/api/foo", "not a url"), false);
  });
});
