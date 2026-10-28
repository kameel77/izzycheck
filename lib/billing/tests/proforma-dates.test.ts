import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PROFORMA_VALIDITY_DAYS,
  addDaysToDate,
  dbDateToYmd,
  isProformaExpired,
  isValidYmd,
  warsawDate,
  ymdToDbDate,
} from "../proforma-dates.ts";

test("PROFORMA_VALIDITY_DAYS is 14", () => {
  assert.equal(PROFORMA_VALIDITY_DAYS, 14);
});

test("warsawDate: uses the Europe/Warsaw calendar day", () => {
  assert.equal(warsawDate(new Date("2026-10-30T23:30:00Z")), "2026-10-31");
  assert.equal(warsawDate(new Date("2026-10-30T10:00:00Z")), "2026-10-30");
  // Summer time (UTC+2): 22:30 UTC is already the next day.
  assert.equal(warsawDate(new Date("2026-07-14T22:30:00Z")), "2026-07-15");
});

test("addDaysToDate: calendar arithmetic across month and year ends", () => {
  assert.equal(addDaysToDate("2026-12-25", 14), "2027-01-08");
  assert.equal(addDaysToDate("2026-10-29", 14), "2026-11-12");
  assert.equal(addDaysToDate("2028-02-20", 14), "2028-03-05");
  assert.equal(addDaysToDate("2026-03-20", 14), "2026-04-03");
  assert.equal(addDaysToDate("2026-01-01", 0), "2026-01-01");
  assert.equal(addDaysToDate("2026-01-01", -1), "2025-12-31");
});

test("addDaysToDate: rejects an invalid date", () => {
  assert.throws(() => addDaysToDate("2026-02-30", 1), /Nieprawidłowa data/);
});

test("isValidYmd: accepts only real calendar dates in YYYY-MM-DD", () => {
  assert.equal(isValidYmd("2026-10-31"), true);
  assert.equal(isValidYmd("2028-02-29"), true);
  for (const bad of ["2026-02-29", "2026-13-01", "2026-00-10", "2026-10-32", "2026-1-5", "26-10-31", "2026/10/31", "2026-10-31T00:00:00Z", ""]) {
    assert.equal(isValidYmd(bad), false, bad);
  }
});

test("ymdToDbDate and dbDateToYmd round-trip as midnight UTC", () => {
  const date = ymdToDbDate("2026-11-12");
  assert.equal(date.toISOString(), "2026-11-12T00:00:00.000Z");
  assert.equal(dbDateToYmd(date), "2026-11-12");
  assert.throws(() => ymdToDbDate("2026-02-30"), /Nieprawidłowa data/);
});

test("isProformaExpired: the due day is still payable, the day after is expired", () => {
  const order = { paymentMethod: "PROFORMA", status: "PENDING_PAYMENT", proformaDueDate: ymdToDbDate("2026-11-12") };
  assert.equal(isProformaExpired(order, new Date("2026-11-12T22:30:00Z")), false); // 23:30 in Warsaw, still the 12th
  assert.equal(isProformaExpired(order, new Date("2026-11-12T23:30:00Z")), true); // 00:30 on the 13th in Warsaw
  assert.equal(isProformaExpired(order, new Date("2026-11-13T10:00:00Z")), true);
  assert.equal(isProformaExpired(order, new Date("2026-11-01T10:00:00Z")), false);
});

test("isProformaExpired: accepts the due date as a string", () => {
  const order = { paymentMethod: "PROFORMA", status: "PENDING_PAYMENT", proformaDueDate: "2026-11-12" };
  assert.equal(isProformaExpired(order, new Date("2026-11-12T10:00:00Z")), false);
  assert.equal(isProformaExpired(order, new Date("2026-11-13T10:00:00Z")), true);
});

test("isProformaExpired: never for paid, canceled, failed, PayU or undated orders", () => {
  const late = new Date("2027-06-01T10:00:00Z");
  const due = ymdToDbDate("2026-11-12");
  for (const status of ["PAID", "CANCELED", "FAILED"]) {
    assert.equal(isProformaExpired({ paymentMethod: "PROFORMA", status, proformaDueDate: due }, late), false, status);
  }
  assert.equal(isProformaExpired({ paymentMethod: "PAYU", status: "PENDING_PAYMENT", proformaDueDate: due }, late), false);
  assert.equal(isProformaExpired({ paymentMethod: "PROFORMA", status: "PENDING_PAYMENT", proformaDueDate: null }, late), false);
});
