import assert from "node:assert/strict";
import { test } from "node:test";
import { assertTestDatabaseUrl } from "../guard.ts";

test("accepts a database whose name ends with _test", () => {
  assert.doesNotThrow(() =>
    assertTestDatabaseUrl("postgresql://u:p@localhost:54329/izzycheck_test"),
  );
  assert.doesNotThrow(() =>
    assertTestDatabaseUrl("postgresql://u:p@localhost:54329/izzycheck_test?schema=public"),
  );
});

test("rejects a database whose name does not end with _test", () => {
  assert.throws(
    () => assertTestDatabaseUrl("postgresql://u:p@localhost:54329/izzycheck"),
    /must end with "_test"/,
  );
  assert.throws(() => assertTestDatabaseUrl("postgresql://u:p@localhost:5432/test_izzycheck"));
});

test("rejects a missing, empty or invalid URL", () => {
  assert.throws(() => assertTestDatabaseUrl(undefined), /not set/);
  assert.throws(() => assertTestDatabaseUrl(""), /not set/);
  assert.throws(() => assertTestDatabaseUrl("not a url"), /not a valid URL/);
});
