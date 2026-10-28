import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildApiUsageCsv } from "../usage.ts";

describe("buildApiUsageCsv", () => {
  test("BOM, separator ';', nagłówek i wiersze w czasie polskim (tak/nie)", () => {
    const csv = buildApiUsageCsv([
      { createdAt: new Date("2026-07-15T10:20:30Z"), vin: "ZZZZZZZZZK0000000", outcome: "IDENTIFIED", httpStatus: 200, billable: true, cacheHit: false },
      { createdAt: new Date("2026-01-15T10:20:30Z"), vin: null, outcome: "REJECTED", httpStatus: 400, billable: false, cacheHit: true },
    ]);
    assert.equal(csv.charCodeAt(0), 0xfeff);
    assert.equal(
      csv.slice(1),
      [
        "data;vin;wynik;status_http;platny;z_cache",
        "2026-07-15 12:20:30;ZZZZZZZZZK0000000;IDENTIFIED;200;tak;nie",
        "2026-01-15 11:20:30;;REJECTED;400;nie;tak",
        "",
      ].join("\r\n"),
    );
  });

  test("pusty zestaw to sam nagłówek", () => {
    assert.equal(buildApiUsageCsv([]), "﻿data;vin;wynik;status_http;platny;z_cache\r\n");
  });

  test("VIN z separatorem, cudzysłowem albo znakiem formuły jest zabezpieczony", () => {
    const row = { createdAt: new Date("2026-07-15T10:20:30Z"), outcome: "REJECTED", httpStatus: 400, billable: false, cacheHit: false };
    const csv = buildApiUsageCsv([
      { ...row, vin: 'A;B"C' },
      { ...row, vin: "=CMD()" },
    ]);
    const lines = csv.split("\r\n");
    assert.equal(lines[1], '2026-07-15 12:20:30;"A;B""C";REJECTED;400;nie;nie');
    assert.equal(lines[2], "2026-07-15 12:20:30;'=CMD();REJECTED;400;nie;nie");
  });
});
