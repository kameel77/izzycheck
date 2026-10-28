import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { currentMonthWarsaw, formatWarsawDateTime, isValidMonth, monthBoundsWarsaw } from "../month.ts";

const iso = (d: Date) => d.toISOString();

describe("monthBoundsWarsaw", () => {
  test("kwiecień 2026 (po zmianie czasu na letni, UTC+2): start 2026-03-31 22:00 UTC", () => {
    const { start, end } = monthBoundsWarsaw("2026-04");
    assert.equal(iso(start), "2026-03-31T22:00:00.000Z");
    assert.equal(iso(end), "2026-04-30T22:00:00.000Z");
  });

  test("2026-03-31 23:30 UTC należy do kwietnia w PL, a 21:59 UTC jeszcze do marca", () => {
    const april = monthBoundsWarsaw("2026-04");
    const march = monthBoundsWarsaw("2026-03");
    const lateMarch31 = new Date("2026-03-31T23:30:00Z");
    assert.ok(lateMarch31 >= april.start && lateMarch31 < april.end);
    assert.ok(!(lateMarch31 >= march.start && lateMarch31 < march.end));
    const beforeBoundary = new Date("2026-03-31T21:59:59Z");
    assert.ok(beforeBoundary >= march.start && beforeBoundary < march.end);
  });

  test("marzec 2026 zawiera zmianę czasu (29.03): start w UTC+1, koniec w UTC+2", () => {
    const { start, end } = monthBoundsWarsaw("2026-03");
    assert.equal(iso(start), "2026-02-28T23:00:00.000Z");
    assert.equal(iso(end), "2026-03-31T22:00:00.000Z");
  });

  test("październik 2026 zawiera powrót do czasu zimowego (25.10): koniec w UTC+1", () => {
    const { start, end } = monthBoundsWarsaw("2026-10");
    assert.equal(iso(start), "2026-09-30T22:00:00.000Z");
    assert.equal(iso(end), "2026-10-31T23:00:00.000Z");
  });

  test("grudzień przechodzi na styczeń następnego roku, zima to UTC+1", () => {
    const { start, end } = monthBoundsWarsaw("2026-12");
    assert.equal(iso(start), "2026-11-30T23:00:00.000Z");
    assert.equal(iso(end), "2026-12-31T23:00:00.000Z");
  });

  test("nieprawidłowy miesiąc rzuca błąd", () => {
    assert.throws(() => monthBoundsWarsaw("2026-13"));
    assert.throws(() => monthBoundsWarsaw("2026-4"));
  });
});

describe("isValidMonth / currentMonthWarsaw / formatWarsawDateTime", () => {
  test("walidacja formatu RRRR-MM", () => {
    assert.equal(isValidMonth("2026-04"), true);
    assert.equal(isValidMonth("2026-00"), false);
    assert.equal(isValidMonth("2026-13"), false);
    assert.equal(isValidMonth("26-04"), false);
    assert.equal(isValidMonth("2026-04-01"), false);
  });

  test("bieżący miesiąc liczony w czasie polskim", () => {
    assert.equal(currentMonthWarsaw(new Date("2026-03-31T23:30:00Z")), "2026-04");
    assert.equal(currentMonthWarsaw(new Date("2026-03-31T21:59:00Z")), "2026-03");
    assert.equal(currentMonthWarsaw(new Date("2026-12-31T23:30:00Z")), "2027-01");
  });

  test("data CSV w czasie polskim: lato +2, zima +1, północ jako 00", () => {
    assert.equal(formatWarsawDateTime(new Date("2026-07-15T10:20:30Z")), "2026-07-15 12:20:30");
    assert.equal(formatWarsawDateTime(new Date("2026-01-15T10:20:30Z")), "2026-01-15 11:20:30");
    assert.equal(formatWarsawDateTime(new Date("2026-03-31T22:00:00Z")), "2026-04-01 00:00:00");
  });
});
