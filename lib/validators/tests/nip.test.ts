import assert from "node:assert";
import { test, describe } from "node:test";
import { validateNip } from "../nip.ts";

describe("Polish NIP Validator", () => {
  test("Validates authentic Polish NIP numbers correctly", () => {
    // Izzy Lease Sp. z o.o.
    const res1 = validateNip("6871964402");
    assert.strictEqual(res1.isValid, true);
    assert.strictEqual(res1.normalizedNip, "6871964402");

    // Formatted with dashes
    const res2 = validateNip("687-196-44-02");
    assert.strictEqual(res2.isValid, true);
    assert.strictEqual(res2.normalizedNip, "6871964402");

    // Formatted with spaces and country prefix
    const res3 = validateNip("PL 687 196 44 02");
    assert.strictEqual(res3.isValid, true);
    assert.strictEqual(res3.normalizedNip, "6871964402");

    // Another known valid Polish company NIP (e.g. Asseco Poland: 5220003782)
    const res4 = validateNip("5220003782");
    assert.strictEqual(res4.isValid, true);
    assert.strictEqual(res4.normalizedNip, "5220003782");
  });

  test("Rejects invalid checksums and non-numeric inputs", () => {
    // Last digit wrong (changed from 2 to 3)
    const res1 = validateNip("6871964403");
    assert.strictEqual(res1.isValid, false);
    assert.ok(res1.error?.includes("cyfra kontrolna"));

    // Letters inside
    const res2 = validateNip("687196440A");
    assert.strictEqual(res2.isValid, false);
    assert.ok(res2.error?.includes("10 cyfr"));

    // Non-string input
    const res3 = validateNip(1234567890 as any);
    assert.strictEqual(res3.isValid, false);
    assert.ok(res3.error?.includes("ciągiem znaków"));
  });

  test("Rejects degenerate sequences (all zeroes)", () => {
    const res = validateNip("0000000000");
    assert.strictEqual(res.isValid, false);
    assert.ok(res.error?.includes("samych zer"));
  });

  test("Rejects numbers with invalid length", () => {
    const short = validateNip("123456789");
    assert.strictEqual(short.isValid, false);

    const long = validateNip("12345678901");
    assert.strictEqual(long.isValid, false);
  });
});
