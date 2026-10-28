import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { generateApiToken, hashApiToken, parseBearerToken, tokenPrefixOf } from "../token.ts";

describe("token klienta API", () => {
  test("izc_ + 32 losowe bajty base64url, każdy token inny", () => {
    const token = generateApiToken();
    assert.match(token, /^izc_[A-Za-z0-9_-]{43}$/);
    assert.notEqual(token, generateApiToken());
  });

  test("hash to sha256 hex, deterministyczny i różny od tokenu", () => {
    const hash = hashApiToken("izc_test");
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(hash, hashApiToken("izc_test"));
    assert.notEqual(hash, hashApiToken("izc_test2"));
    // sha256("abc")
    assert.equal(hashApiToken("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  test("prefiks to pierwsze 8 znaków tokenu", () => {
    assert.equal(tokenPrefixOf("izc_abcdefghij"), "izc_abcd");
  });

  test("parseBearerToken: poprawny nagłówek, inne schematy i braki", () => {
    assert.equal(parseBearerToken("Bearer izc_abc"), "izc_abc");
    assert.equal(parseBearerToken("bearer   izc_abc "), "izc_abc");
    assert.equal(parseBearerToken("Basic izc_abc"), null);
    assert.equal(parseBearerToken("Bearer"), null);
    assert.equal(parseBearerToken("Bearer a b"), null);
    assert.equal(parseBearerToken(""), null);
    assert.equal(parseBearerToken(null), null);
    assert.equal(parseBearerToken(undefined), null);
  });
});
