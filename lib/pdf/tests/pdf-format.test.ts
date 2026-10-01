import assert from "node:assert";
import { test, describe } from "node:test";
import {
  COUNTRY_NAMES,
  formatCountry,
  formatAmount,
  formatDateTimeWarsaw,
  claimNoun,
  polishPlural,
  itemCountLabel,
  entryCountLabel,
  totalLossPhrase,
  filterRawAttributes,
  RAW_ATTRIBUTE_LABELS,
  formatMandateDescription,
  formatBodyType,
  parseDateMs,
  buildFactualSummary,
  buildClaimsKpi,
  buildCompletenessKpi,
  buildModuleDots,
  marketToNewPct,
  numberSections,
  nudgeMarkers,
  distributeRow,
  buildTimeline,
  Point,
} from "../pdf-format.ts";

const nbsp = (s: string) => s.replace(/ /g, " ");

describe("pdf-format: country map", () => {
  test("maps ISO-3 codes to Polish names", () => {
    const expected: Record<string, string> = {
      POL: "Polska",
      DEU: "Niemcy",
      CZE: "Czechy",
      SVK: "Słowacja",
      LTU: "Litwa",
      FRA: "Francja",
      ITA: "Włochy",
      NLD: "Holandia",
      BEL: "Belgia",
      AUT: "Austria",
    };
    for (const [code, name] of Object.entries(expected)) {
      assert.strictEqual(COUNTRY_NAMES[code], name);
      assert.strictEqual(formatCountry(code), name);
    }
    assert.strictEqual(formatCountry("pol"), "Polska");
  });

  test("maps ISO-2 codes to Polish names too", () => {
    const expected: Record<string, string> = {
      PL: "Polska",
      DE: "Niemcy",
      CZ: "Czechy",
      SK: "Słowacja",
      LT: "Litwa",
      FR: "Francja",
      IT: "Włochy",
      NL: "Holandia",
      BE: "Belgia",
      AT: "Austria",
    };
    for (const [code, name] of Object.entries(expected)) assert.strictEqual(formatCountry(code), name);
    assert.strictEqual(formatCountry("pl"), "Polska");
    assert.strictEqual(formatCountry("XX"), "XX");
  });

  test("unknown values are shown raw, missing values as Brak danych (no PL default)", () => {
    assert.strictEqual(formatCountry("AON"), "AON");
    assert.strictEqual(formatCountry(undefined), "Brak danych");
    assert.strictEqual(formatCountry(""), "Brak danych");
    assert.strictEqual(formatCountry("  "), "Brak danych");
  });
});

describe("pdf-format: amounts and dates", () => {
  test("formatAmount rounds to integers with Polish grouping", () => {
    assert.strictEqual(nbsp(formatAmount(103650)), "103 650");
    assert.strictEqual(nbsp(formatAmount(1234567.89)), "1 234 568");
    assert.strictEqual(formatAmount(0), "0");
    assert.ok(!formatAmount(18450.4).includes(","), "no decimal separator");
  });

  test("formatDateTimeWarsaw uses Europe/Warsaw (summer and winter offsets)", () => {
    assert.strictEqual(formatDateTimeWarsaw("2026-08-06T12:00:00.000Z"), "06.08.2026, 14:00"); // CEST, UTC+2
    assert.strictEqual(formatDateTimeWarsaw("2026-01-15T23:30:00.000Z"), "16.01.2026, 00:30"); // CET, crosses midnight
    assert.strictEqual(formatDateTimeWarsaw("not-a-date"), "");
  });

  test("parseDateMs is strict: impossible dates and non-ISO formats are rejected (no rollover, no Date.parse fallback)", () => {
    for (const bad of ["2025-13-45", "2025-02-30", "2023-02-29", "2025-00-10", "2025-10-00", "11.10.2025", "10/11/2025", "2025-1-5", "Oct 11 2025", "2025-10-11x"]) {
      assert.strictEqual(parseDateMs(bad), undefined, bad);
    }
  });

  test("parseDateMs accepts ISO dates and rejects garbage", () => {
    assert.strictEqual(parseDateMs("2024-05-05"), Date.UTC(2024, 4, 5));
    assert.strictEqual(parseDateMs("2024-05-05T10:00:00Z") !== undefined, true);
    assert.strictEqual(parseDateMs("2024-05-05T10:00:00Z"), Date.UTC(2024, 4, 5));
    assert.strictEqual(parseDateMs(" 2024-02-29 "), Date.UTC(2024, 1, 29), "leap day");
    assert.strictEqual(parseDateMs("xyz"), undefined);
    assert.strictEqual(parseDateMs(undefined), undefined);
  });
});

describe("pdf-format: Polish plurals", () => {
  test("claimNoun", () => {
    assert.strictEqual(claimNoun(1), "szkoda");
    assert.strictEqual(claimNoun(1, "acc"), "szkodę");
    for (const n of [2, 3, 4, 22, 23, 24, 102]) assert.strictEqual(claimNoun(n), "szkody", String(n));
    for (const n of [0, 5, 11, 12, 13, 14, 21, 25, 100]) assert.strictEqual(claimNoun(n), "szkód", String(n));
  });

  test("itemCountLabel (equipment count chips)", () => {
    assert.strictEqual(itemCountLabel(1), "1 pozycja");
    for (const n of [2, 3, 4, 22, 23, 24, 102]) assert.strictEqual(itemCountLabel(n), `${n} pozycje`);
    for (const n of [0, 5, 11, 12, 13, 14, 21, 25, 80, 250]) assert.strictEqual(itemCountLabel(n), `${n} pozycji`);
    assert.strictEqual(polishPlural(3, "a", "b", "c"), "b");
  });

  test("totalLossPhrase", () => {
    assert.strictEqual(totalLossPhrase(1), "szkodę całkowitą");
    assert.strictEqual(totalLossPhrase(2), "2 szkody całkowite");
    assert.strictEqual(totalLossPhrase(5), "5 szkód całkowitych");
  });
});

describe("pdf-format: labels and raw attributes", () => {
  test("filterRawAttributes is an allowlist: unknown system keys are hidden, empty values skipped", () => {
    const out = filterRawAttributes({
      marketCode: "PL",
      Fake100900: "20220427",
      ax_Options: "P8,P9,O2",
      HS_M: "1788",
      engineMark: "420d",
      emissionLevel1: "118",
      couple: "",
      acceleration: "  ",
      towedLoadBraking: "1800",
    });
    assert.deepStrictEqual(out, [
      ["Oznaczenie silnika", "420d"],
      ["Emisja CO2 (g/km)", "118"],
      ["Masa przyczepy z hamulcem (kg)", "1800"],
    ]);
    assert.deepStrictEqual(filterRawAttributes(undefined), []);
    assert.deepStrictEqual(filterRawAttributes({ marketCode: "PL", KP_UNI: "0.015", active: "1" }), []);
  });

  test("filterRawAttributes keeps decimal commas as-is and labels the full confident key set", () => {
    const raw = {
      rowName: "SERIA 4",
      engineMark: "420d",
      emissionLevel1: "118",
      acceleration: "7,6",
      couple: "400",
      storageSpace: "480",
      petrolConsumptionEHKmix: "4,5",
      petrolCapacityMain: "57",
      towedLoadBraking: "1800",
    };
    const out = filterRawAttributes(raw);
    assert.strictEqual(out.length, Object.keys(RAW_ATTRIBUTE_LABELS).length);
    assert.deepStrictEqual(out[0], ["Seria / model", "SERIA 4"]);
    assert.ok(out.some(([l, v]) => l === "Przyspieszenie 0–100 km/h (s)" && v === "7,6"));
    assert.ok(out.some(([l, v]) => l === "Zużycie paliwa – cykl mieszany (l/100 km)" && v === "4,5"));
  });

  test("formatMandateDescription hides the Audatex placeholder", () => {
    assert.strictEqual(formatMandateDescription("Brak kodu mandatu"), "—");
    assert.strictEqual(formatMandateDescription("  brak KODU mandatu "), "—");
    assert.strictEqual(formatMandateDescription(""), "—");
    assert.strictEqual(formatMandateDescription(undefined), "—");
    assert.strictEqual(formatMandateDescription(null), "—");
    assert.strictEqual(formatMandateDescription("Kolizja drogowa"), "Kolizja drogowa");
  });

  test("formatBodyType maps known values and capitalises the rest", () => {
    const expected: Record<string, string> = {
      liftback: "Liftback",
      sedan: "Sedan",
      kombi: "Kombi",
      combi: "Kombi",
      wagon: "Kombi",
      hatchback: "Hatchback",
      suv: "SUV",
      coupe: "Coupé",
      "coupé": "Coupé",
      cabrio: "Kabriolet",
      kabriolet: "Kabriolet",
      " Liftback ": "Liftback",
      VAN: "VAN",
      minivan: "Minivan",
    };
    for (const [raw, shown] of Object.entries(expected)) assert.strictEqual(formatBodyType(raw), shown, raw);
    assert.strictEqual(formatBodyType(""), undefined);
    assert.strictEqual(formatBodyType(undefined), undefined);
  });
});

describe("pdf-format: de-duplicated claims summary and KPI", () => {
  const claim = (over: Record<string, unknown> = {}) => ({
    accidentDate: "2025-02-20",
    claimDate: "2025-10-11",
    damageValue: 19768.92,
    currency: "PLN",
    isTotalLoss: false,
    ...over,
  });
  const probable = {
    entriesCount: 2,
    likelyEventsCount: 1,
    likelyTotal: { total: 19768.92, currency: "PLN" },
    hasMerged: false,
  };

  test("entryCountLabel plural forms", () => {
    assert.strictEqual(entryCountLabel(1), "1 wpis");
    assert.strictEqual(entryCountLabel(2), "2 wpisy");
    assert.strictEqual(entryCountLabel(5), "5 wpisów");
    assert.strictEqual(entryCountLabel(12), "12 wpisów");
  });

  test("KPI with probable clusters: entries as the value, likely events as the sub-line", () => {
    const kpi = buildClaimsKpi({
      claimsHistoryPresentation: "CLAIM_DETAILS_AVAILABLE",
      claims: [claim(), claim({ accidentDate: undefined })],
      dedup: probable,
    });
    assert.deepStrictEqual(kpi, { tone: "caution", value: "2 wpisy", sub: "prawdopodobnie 1 szkoda" });
    const risk = buildClaimsKpi({
      claimsHistoryPresentation: "CLAIM_DETAILS_AVAILABLE",
      claims: [claim({ isTotalLoss: true }), claim()],
      dedup: { ...probable, entriesCount: 5, likelyEventsCount: 3 },
    });
    assert.deepStrictEqual(risk, { tone: "risk", value: "5 wpisów", sub: "prawdopodobnie 3 szkody" });
  });

  test("KPI is unchanged when entries equal likely events (also for merged assessments)", () => {
    const merged = buildClaimsKpi({
      claimsHistoryPresentation: "CLAIM_DETAILS_AVAILABLE",
      claims: [claim()],
      dedup: { entriesCount: 1, likelyEventsCount: 1, hasMerged: true },
    });
    assert.strictEqual(merged.value, "1 szkoda");
    assert.strictEqual(merged.tone, "caution");
    const plain = buildClaimsKpi({ claimsHistoryPresentation: "CLAIM_DETAILS_AVAILABLE", claims: [claim()] });
    assert.deepStrictEqual(plain, merged);
  });

  test("summary for probable clusters", () => {
    const text = buildFactualSummary({
      claimsHistoryPresentation: "CLAIM_DETAILS_AVAILABLE",
      claims: [claim(), claim({ accidentDate: undefined })],
      dedup: probable,
    });
    assert.strictEqual(
      nbsp(text as string),
      "Zarejestrowano 2 wpisy, prawdopodobnie dotyczące 1 szkody. Łączna wartość szkód według najnowszych wycen: 19 769 PLN netto (bez VAT)."
    );
    const many = buildFactualSummary({
      claimsHistoryPresentation: "CLAIM_DETAILS_AVAILABLE",
      claims: [claim(), claim(), claim()],
      dedup: { entriesCount: 5, likelyEventsCount: 2, hasMerged: false },
    });
    assert.strictEqual(many, "Zarejestrowano 5 wpisów, prawdopodobnie dotyczące 2 szkód.");
  });

  test("summary for merged assessments counts events and names the newest assessment date", () => {
    const text = buildFactualSummary({
      claimsHistoryPresentation: "CLAIM_DETAILS_AVAILABLE",
      claims: [claim()],
      dedup: { entriesCount: 1, likelyEventsCount: 1, hasMerged: true },
    });
    assert.strictEqual(
      nbsp(text as string),
      "Zarejestrowano 1 szkodę (najnowsza wycena: 2025-10-11). Łączna wartość szkód: 19 769 PLN netto (bez VAT)."
    );
  });
});

describe("pdf-format: factual summary and KPI", () => {
  const claim = (over: Record<string, unknown> = {}) => ({
    accidentDate: "2023-11-10",
    damageValue: 18450,
    currency: "PLN",
    isTotalLoss: false,
    ...over,
  });

  test("summary for claims lists count, last date, total losses and net sum", () => {
    const text = buildFactualSummary({
      claimsHistoryPresentation: "CLAIM_DETAILS_AVAILABLE",
      claims: [claim(), claim({ accidentDate: "2024-05-05", damageValue: 85200, isTotalLoss: true })],
    });
    assert.strictEqual(
      nbsp(text as string),
      "Zarejestrowano 2 szkody (ostatnia: 2024-05-05), w tym szkodę całkowitą. Łączna wartość szkód: 103 650 PLN netto (bez VAT)."
    );
  });

  test("summary omits the sum when currencies differ and the date when unparseable", () => {
    const text = buildFactualSummary({
      claimsHistoryPresentation: "CLAIM_DETAILS_AVAILABLE",
      claims: [claim({ accidentDate: "??" }), claim({ accidentDate: undefined, currency: "EUR" })],
    });
    assert.strictEqual(text, "Zarejestrowano 2 szkody.");
  });

  test("summary for other states", () => {
    assert.strictEqual(
      buildFactualSummary({ claimsHistoryPresentation: "NO_HISTORY", claims: [] }),
      "W bazie Audatex nie odnotowano szkód dla tego pojazdu."
    );
    assert.strictEqual(
      buildFactualSummary({ claimsHistoryPresentation: "HISTORY_DETECTED_DETAILS_UNAVAILABLE", claims: [] }),
      "W bazie Audatex wykryto wpisy historii szkód."
    );
    assert.strictEqual(buildFactualSummary({ claimsHistoryPresentation: "UNAVAILABLE", claims: [] }), null);
  });

  test("claims KPI tone and value per presentation", () => {
    const caution = buildClaimsKpi({
      claimsHistoryPresentation: "CLAIM_DETAILS_AVAILABLE",
      claimCheckStatus: "SUCCEEDED",
      claims: [claim(), claim()],
    });
    assert.strictEqual(caution.tone, "caution");
    assert.strictEqual(caution.value, "2 szkody");
    assert.strictEqual(nbsp(caution.sub as string), "łącznie 36 900 PLN netto (bez VAT)");

    const risk = buildClaimsKpi({
      claimsHistoryPresentation: "CLAIM_DETAILS_AVAILABLE",
      claimCheckStatus: "SUCCEEDED",
      claims: [claim({ isTotalLoss: true })],
    });
    assert.deepStrictEqual([risk.tone, risk.value, risk.sub], ["risk", "1 szkoda", "w tym szkoda całkowita"]);

    assert.deepStrictEqual(
      buildClaimsKpi({ claimsHistoryPresentation: "HISTORY_DETECTED_DETAILS_NOT_REQUESTED", claimCheckStatus: "SUCCEEDED", claims: [] }).value,
      "Wykryto wpisy"
    );
    const none = buildClaimsKpi({ claimsHistoryPresentation: "NO_HISTORY", claimCheckStatus: "NO_DATA", claims: [] });
    assert.deepStrictEqual([none.tone, none.value], ["ok", "Brak szkód"]);
    const unavailable = buildClaimsKpi({ claimsHistoryPresentation: "UNAVAILABLE", claimCheckStatus: "FAILED", claims: [] });
    assert.deepStrictEqual([unavailable.tone, unavailable.value], ["risk", "Niedostępne"]);
    for (const status of ["NOT_REQUESTED", "NIEWYKONANO", undefined]) {
      const k = buildClaimsKpi({ claimsHistoryPresentation: "UNAVAILABLE", claimCheckStatus: status, claims: [] });
      assert.deepStrictEqual([k.tone, k.value], ["neutral", "Nie zamówiono"]);
    }
  });

  test("completeness KPI and module dots", () => {
    assert.deepStrictEqual(buildCompletenessKpi("COMPLETED"), { tone: "ok", value: "Kompletny" });
    assert.deepStrictEqual(buildCompletenessKpi("PARTIALLY_FAILED"), { tone: "caution", value: "Niepełny (as-is)" });

    const dots = buildModuleDots({
      valuationStatus: "FAILED",
      claimCheckStatus: "SUCCEEDED",
      claimDetailsStatus: "NOT_REQUESTED",
    });
    assert.deepStrictEqual(
      dots.map((d) => d.tone),
      ["risk", "ok"],
      "only requested modules are listed"
    );
  });

  test("marketToNewPct needs both values > 0", () => {
    assert.strictEqual(marketToNewPct(124500, 208909), 60);
    assert.strictEqual(marketToNewPct(undefined, 208909), undefined);
    assert.strictEqual(marketToNewPct(124500, 0), undefined);
    assert.strictEqual(marketToNewPct(0, 1000), undefined);
  });
});

describe("pdf-format: dynamic section numbering", () => {
  const order = ["valuation", "claims", "spec", "optional", "standard"];

  test("numbers present sections 1..n in render order", () => {
    assert.deepStrictEqual(
      numberSections(order, { valuation: true, claims: true, spec: true, optional: true, standard: true }),
      { valuation: 1, claims: 2, spec: 3, optional: 4, standard: 5 }
    );
  });

  test("no gaps when sections are missing", () => {
    assert.deepStrictEqual(
      numberSections(order, { valuation: false, claims: true, spec: false, optional: true, standard: true }),
      { claims: 1, optional: 2, standard: 3 }
    );
  });
});

describe("pdf-format: marker nudging", () => {
  const R = 14;
  const W = 400;
  const H = 200;
  const minDist = 2 * R + 2;

  function assertValid(points: Point[]) {
    for (const p of points) {
      assert.ok(p.x >= R - 1e-9 && p.x <= W - R + 1e-9, `x in viewBox: ${p.x}`);
      assert.ok(p.y >= R - 1e-9 && p.y <= H - R + 1e-9, `y in viewBox: ${p.y}`);
    }
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
        assert.ok(d >= minDist - 1e-6, `markers ${i},${j} too close: ${d.toFixed(2)} < ${minDist}`);
      }
    }
  }

  test("separates the real right-front cluster (sedan anchors 01, 02, 03, 05, 08 and front)", () => {
    const cluster: Point[] = [
      { x: 310, y: 90 },
      { x: 335, y: 110 },
      { x: 345, y: 140 },
      { x: 295, y: 120 },
      { x: 318, y: 122 },
      { x: 318, y: 122 },
    ];
    assertValid(nudgeMarkers(cluster, { radius: R, width: W, height: H }));
  });

  test("separates coincident markers and keeps them inside the viewBox at the corner", () => {
    const coincident = Array.from({ length: 5 }, () => ({ x: 200, y: 100 }));
    assertValid(nudgeMarkers(coincident, { radius: R, width: W, height: H }));
    const corner = Array.from({ length: 4 }, () => ({ x: 399, y: 199 }));
    assertValid(nudgeMarkers(corner, { radius: R, width: W, height: H }));
  });

  test("is deterministic and leaves non-overlapping markers untouched", () => {
    const pts: Point[] = [
      { x: 60, y: 60 },
      { x: 200, y: 100 },
      { x: 340, y: 150 },
    ];
    assert.deepStrictEqual(nudgeMarkers(pts, { radius: R, width: W, height: H }), pts);
    const overlapping: Point[] = [
      { x: 100, y: 100 },
      { x: 105, y: 102 },
      { x: 100, y: 100 },
    ];
    assert.deepStrictEqual(
      nudgeMarkers(overlapping, { radius: R, width: W, height: H }),
      nudgeMarkers(overlapping, { radius: R, width: W, height: H })
    );
  });

  test("distributeRow spreads points evenly", () => {
    assert.deepStrictEqual(distributeRow(0, 160, 100, 300), []);
    assert.deepStrictEqual(distributeRow(1, 160, 100, 300), [{ x: 200, y: 160 }]);
    assert.deepStrictEqual(distributeRow(3, 160, 100, 300), [
      { x: 100, y: 160 },
      { x: 200, y: 160 },
      { x: 300, y: 160 },
    ]);
  });
});

describe("pdf-format: claims timeline", () => {
  const base = { startDate: "2020-06-12", endDate: "2026-10-01", widthPt: 507, labelWidthPt: 92 };

  test("returns null when no claim has a parseable date", () => {
    assert.strictEqual(buildTimeline({ ...base, events: [{ id: "a", date: "??" }, { id: "b" }] }), null);
  });

  test("range spans first registration year to valuation year and skips unparseable events", () => {
    const tl = buildTimeline({ ...base, events: [{ id: "a", date: "2023-11-10" }, { id: "bad", date: "nope" }] });
    assert.ok(tl);
    assert.strictEqual(tl.startYear, 2020);
    assert.strictEqual(tl.endYear, 2026);
    assert.deepStrictEqual(tl.ticks.map((t) => t.year), [2020, 2021, 2022, 2023, 2024, 2025, 2026]);
    assert.strictEqual(tl.events.length, 1);
    assert.strictEqual(tl.events[0].id, "a");
  });

  test("positions are proportional to the date and inside 0..1", () => {
    const tl = buildTimeline({
      ...base,
      events: [
        { id: "early", date: "2020-01-01" },
        { id: "mid", date: "2023-07-02" },
        { id: "late", date: "2026-10-01" },
      ],
    });
    assert.ok(tl);
    const pos = Object.fromEntries(tl.events.map((e) => [e.id, e.pos]));
    assert.strictEqual(pos.early, 0);
    assert.ok(Math.abs(pos.mid - 3.5 / 7) < 0.01, `mid=${pos.mid}`);
    assert.ok(pos.late > 0.9 && pos.late <= 1);
  });

  test("range extends when a claim lies outside registration..valuation", () => {
    const tl = buildTimeline({ ...base, events: [{ id: "a", date: "2019-03-01" }] });
    assert.ok(tl);
    assert.strictEqual(tl.startYear, 2019);
    assert.strictEqual(tl.events[0].pos >= 0 && tl.events[0].pos <= 1, true);
  });

  test("close dots use different label rows; far dots share row 0", () => {
    const close = buildTimeline({
      ...base,
      events: [
        { id: "a", date: "2024-01-10" },
        { id: "b", date: "2024-02-10" },
      ],
    });
    assert.ok(close);
    assert.deepStrictEqual(close.events.map((e) => e.level), [0, 1]);

    const far = buildTimeline({
      ...base,
      events: [
        { id: "a", date: "2021-01-10" },
        { id: "b", date: "2024-02-10" },
      ],
    });
    assert.ok(far);
    assert.deepStrictEqual(far.events.map((e) => e.level), [0, 0]);
  });

  test("labels on the same row never overlap; events without a free row are unlabeled", () => {
    const events = Array.from({ length: 8 }, (_, i) => ({ id: `e${i}`, date: `2024-0${(i % 8) + 1}-10` }));
    const tl = buildTimeline({ ...base, events });
    assert.ok(tl);
    const minGap = (base.labelWidthPt + 4) / base.widthPt;
    const byLevel = new Map<number, number[]>();
    for (const e of tl.events.filter((x) => x.labeled)) {
      byLevel.set(e.level, [...(byLevel.get(e.level) ?? []), e.pos]);
    }
    for (const [level, positions] of byLevel) {
      for (let i = 1; i < positions.length; i++) {
        assert.ok(positions[i] - positions[i - 1] >= minGap - 1e-9, `row ${level} overlaps`);
      }
    }
    assert.ok(tl.events.some((e) => !e.labeled), "dense cluster leaves some events unlabeled");
    assert.ok(tl.events.filter((e) => e.labeled).length <= 4);
  });

  test("year labels are thinned out for very long ranges", () => {
    const tl = buildTimeline({
      ...base,
      startDate: "1995-01-01",
      events: [{ id: "a", date: "2024-01-01" }],
    });
    assert.ok(tl);
    const labelled = tl.ticks.filter((t) => t.showLabel);
    assert.ok(labelled.length < tl.ticks.length);
    assert.strictEqual(labelled[0].year, 1995);
  });
});
