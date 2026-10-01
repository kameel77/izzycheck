import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { test, describe } from "node:test";
import {
  SAME_MIN_SIM,
  PROBABLE_MIN_SIM,
  PROBABLE_MAX_CREATION_GAP_DAYS,
  PROBABLE_MAX_ACCIDENT_GAP_DAYS,
  DedupClaim,
  claimSimilarity,
  classifyPair,
  dedupeClaims,
  dedupeRawClaims,
  withDedupFields,
} from "../claim-dedup.ts";

let seq = 0;
function claim(over: Partial<DedupClaim> = {}): DedupClaim {
  seq++;
  return {
    claimId: `c${String(seq).padStart(3, "0")}`,
    accidentDate: "2025-02-20",
    claimDate: "2025-10-01",
    damageValue: 10000,
    currency: "PLN",
    isTotalLoss: false,
    zones: ["01", "02"],
    flags: [],
    ...over,
  };
}

/** ISO date `days` after the given date. */
function plusDays(date: string, days: number): string {
  return new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);
}

const zonesOfSim = {
  half: [["01", "02"], ["01"]], // 1/2
  sixTenths: [["01", "02", "03"], ["01", "02", "03", "04", "05"]], // 3/5
  justBelowSixTenths: [["01", "02", "03", "04"], ["01", "02", "03", "05", "06"]], // 3/6 = 0.5
  fourSevenths: [["01", "02", "03", "04", "05"], ["01", "02", "03", "04", "06", "07"]], // 4/7
  oneThird: [["01", "02"], ["01", "03"]],
} as const;

describe("claim-dedup: thresholds", () => {
  test("named constants match the approved spec", () => {
    assert.strictEqual(SAME_MIN_SIM, 0.5);
    assert.strictEqual(PROBABLE_MIN_SIM, 0.6);
    assert.strictEqual(PROBABLE_MAX_CREATION_GAP_DAYS, 60);
    assert.strictEqual(PROBABLE_MAX_ACCIDENT_GAP_DAYS, 3);
  });
});

describe("claim-dedup: similarity", () => {
  test("zones: Jaccard index of the zone sets", () => {
    assert.strictEqual(claimSimilarity(claim({ zones: ["01", "02"] }), claim({ zones: ["01"] })), 0.5);
    assert.strictEqual(claimSimilarity(claim({ zones: ["01"] }), claim({ zones: ["01"] })), 1);
    assert.strictEqual(claimSimilarity(claim({ zones: ["01"] }), claim({ zones: ["02"] })), 0);
  });

  test("flags are used only when at least one claim has no zones", () => {
    const a = claim({ zones: [], flags: ["front", "rear"] });
    const b = claim({ zones: [], flags: ["front"] });
    assert.strictEqual(claimSimilarity(a, b), 0.5);
    const withZones = claim({ zones: ["01"], flags: ["front", "rear"] });
    assert.strictEqual(claimSimilarity(withZones, b), 0.5, "zones on one side only: falls back to flags");
    // both have zones: zones win even though the flags are identical
    assert.strictEqual(claimSimilarity(claim({ zones: ["01"], flags: ["front"] }), claim({ zones: ["02"], flags: ["front"] })), 0);
  });

  test("no zones and no flags on a side: null (insufficient data) and the pair is DIFFERENT", () => {
    const a = claim({ zones: [], flags: [] });
    const b = claim({ zones: ["01", "02"], flags: ["front"] });
    assert.strictEqual(claimSimilarity(a, b), null);
    assert.strictEqual(claimSimilarity(a, claim({ zones: [], flags: [] })), null);
    assert.strictEqual(classifyPair(a, claim({ ...a, claimId: "x" })), "DIFFERENT", "even with an equal accident date");
  });

  test("zone 00 and unknown codes are excluded from the zone sets", () => {
    const raw = (codes: string[]) =>
      withDedupFields({
        claimId: "x",
        damageAssessmentJson: JSON.stringify({ damagePositionCodes: codes, generalFlags: { front: true, rear: false } }),
      });
    assert.deepStrictEqual(raw(["23", "00", "14", "99", " 05 ", "23"]).zones.sort(), ["05", "14", "23"]);
    assert.deepStrictEqual(raw(["00"]).zones, []);
    assert.deepStrictEqual(raw(["00"]).flags, ["front"]);
    assert.deepStrictEqual(withDedupFields({ claimId: "legacy", damageAssessmentJson: null }).zones, []);
    assert.deepStrictEqual(withDedupFields({ claimId: "bad", damageAssessmentJson: "{not json" }).flags, []);
  });
});

describe("claim-dedup: pair classification", () => {
  test("SAME: equal accident dates and sim >= 0.5 (boundary 0.5 included, 1/3 excluded)", () => {
    const [za, zb] = zonesOfSim.half;
    assert.strictEqual(classifyPair(claim({ zones: [...za] }), claim({ zones: [...zb] })), "SAME");
    const [oa, ob] = zonesOfSim.oneThird;
    assert.strictEqual(classifyPair(claim({ zones: [...oa] }), claim({ zones: [...ob] })), "DIFFERENT");
  });

  test("SAME needs both accident dates: a missing one is never SAME", () => {
    const [za, zb] = zonesOfSim.half;
    assert.notStrictEqual(
      classifyPair(claim({ accidentDate: null, zones: [...za] }), claim({ accidentDate: null, zones: [...zb] })),
      "SAME"
    );
  });

  test("PROBABLE (a): one date missing, sim >= 0.6 (boundary 0.6 included) and creation gap <= 60 days", () => {
    const [za, zb] = zonesOfSim.sixTenths;
    const base = "2025-06-01";
    const a = claim({ accidentDate: "2025-02-20", claimDate: base, zones: [...za] });
    const at = (gap: number) => claim({ accidentDate: null, claimDate: plusDays(base, gap), zones: [...zb] });
    assert.strictEqual(classifyPair(a, at(60)), "PROBABLE");
    assert.strictEqual(classifyPair(a, at(-60)), "PROBABLE");
    assert.strictEqual(classifyPair(a, at(61)), "DIFFERENT");
    assert.strictEqual(classifyPair(a, at(0)), "PROBABLE");
    // both dates missing also counts as "at least one missing"
    assert.strictEqual(classifyPair(claim({ ...a, accidentDate: null }), at(10)), "PROBABLE");
  });

  test("PROBABLE (a): sim just below 0.6 is DIFFERENT", () => {
    const [za, zb] = zonesOfSim.fourSevenths; // 0.571
    assert.strictEqual(
      classifyPair(claim({ zones: [...za] }), claim({ accidentDate: null, zones: [...zb] })),
      "DIFFERENT"
    );
    const [ha, hb] = zonesOfSim.justBelowSixTenths; // 0.5
    assert.strictEqual(
      classifyPair(claim({ zones: [...ha] }), claim({ accidentDate: null, zones: [...hb] })),
      "DIFFERENT"
    );
  });

  test("PROBABLE (a): an unknown creation date cannot satisfy the gap rule", () => {
    const [za, zb] = zonesOfSim.sixTenths;
    assert.strictEqual(
      classifyPair(claim({ zones: [...za], claimDate: null }), claim({ accidentDate: null, zones: [...zb] })),
      "DIFFERENT"
    );
  });

  test("PROBABLE (b): both accident dates present and differing by <= 3 days (boundaries 3 / 4)", () => {
    const [za, zb] = zonesOfSim.sixTenths;
    const a = claim({ accidentDate: "2025-02-20", zones: [...za] });
    const b = (gap: number) => claim({ accidentDate: plusDays("2025-02-20", gap), zones: [...zb] });
    assert.strictEqual(classifyPair(a, b(3)), "PROBABLE");
    assert.strictEqual(classifyPair(a, b(-3)), "PROBABLE");
    assert.strictEqual(classifyPair(a, b(4)), "DIFFERENT");
    assert.strictEqual(classifyPair(a, b(-4)), "DIFFERENT");
  });

  test("PROBABLE (b): the creation gap is irrelevant when both accident dates are present", () => {
    const [za, zb] = zonesOfSim.sixTenths;
    assert.strictEqual(
      classifyPair(
        claim({ accidentDate: "2025-02-20", claimDate: "2025-03-01", zones: [...za] }),
        claim({ accidentDate: "2025-02-22", claimDate: "2026-03-01", zones: [...zb] })
      ),
      "PROBABLE"
    );
  });

  test("PROBABLE (b): sim below 0.6 is DIFFERENT even for close dates", () => {
    const [za, zb] = zonesOfSim.half;
    assert.strictEqual(
      classifyPair(claim({ accidentDate: "2025-02-20", zones: [...za] }), claim({ accidentDate: "2025-02-21", zones: [...zb] })),
      "DIFFERENT"
    );
  });

  test("DIFFERENT: far dates, disjoint zones", () => {
    assert.strictEqual(
      classifyPair(claim({ accidentDate: "2023-01-01", zones: ["01"] }), claim({ accidentDate: "2025-01-01", zones: ["01"] })),
      "DIFFERENT"
    );
    assert.strictEqual(classifyPair(claim({ zones: ["01"] }), claim({ zones: ["02"] })), "DIFFERENT");
  });
});

describe("claim-dedup: grouping", () => {
  test("transitivity: A~B and B~C SAME form one group of 3; the primary is the latest assessment", () => {
    const a = claim({ claimId: "A", claimDate: "2025-03-01", zones: ["01", "02"] });
    const b = claim({ claimId: "B", claimDate: "2025-05-01", zones: ["01"] });
    const c = claim({ claimId: "C", claimDate: "2025-04-01", zones: ["01", "03"] });
    assert.strictEqual(classifyPair(a, c), "DIFFERENT", "A and C alone are not SAME");
    const res = dedupeClaims([a, b, c]);
    assert.strictEqual(res.items.length, 1);
    assert.strictEqual(res.items[0].dedupKind, "MERGED");
    assert.strictEqual(res.items[0].primary.claimId, "B");
    assert.deepStrictEqual(res.items[0].earlierAssessments.map((x) => x.claimId), ["C", "A"], "newest first");
    assert.strictEqual(res.entriesCount, 1);
    assert.strictEqual(res.likelyEventsCount, 1);
  });

  test("primary tie-breaks: same claimDate -> higher value; then claimId ascending", () => {
    const base = { claimDate: "2025-05-01", zones: ["01", "02"] };
    const byValue = dedupeClaims([
      claim({ ...base, claimId: "A", damageValue: 100 }),
      claim({ ...base, claimId: "B", damageValue: 900 }),
    ]);
    assert.strictEqual(byValue.items[0].primary.claimId, "B");
    const byId = dedupeClaims([
      claim({ ...base, claimId: "Z", damageValue: 100 }),
      claim({ ...base, claimId: "M", damageValue: 100 }),
    ]);
    assert.strictEqual(byId.items[0].primary.claimId, "M");
  });

  test("merged item shows the accident date of the primary, or the shared one", () => {
    const res = dedupeClaims([
      claim({ claimId: "A", claimDate: "2025-03-01", accidentDate: "2025-02-20" }),
      claim({ claimId: "B", claimDate: "2025-05-01", accidentDate: "2025-02-20" }),
    ]);
    assert.strictEqual(res.items[0].accidentDate, "2025-02-20");
  });

  test("items are chronological by (accidentDate ?? claimDate) ascending", () => {
    const res = dedupeClaims([
      claim({ claimId: "late", accidentDate: "2025-08-01", zones: ["20"] }),
      claim({ claimId: "noacc", accidentDate: null, claimDate: "2025-05-01", zones: ["10"] }),
      claim({ claimId: "early", accidentDate: "2024-01-01", zones: ["05"] }),
    ]);
    assert.deepStrictEqual(res.items.map((i) => i.primary.claimId), ["early", "noacc", "late"]);
  });

  test("probable cluster: probableWith holds 1-based display indices; clusters count as one event", () => {
    const [za, zb] = zonesOfSim.sixTenths;
    const res = dedupeClaims([
      claim({ claimId: "A", accidentDate: "2025-02-20", claimDate: "2025-10-11", damageValue: 300, zones: [...za] }),
      claim({ claimId: "B", accidentDate: null, claimDate: "2025-10-07", damageValue: 200, zones: [...zb] }),
      claim({ claimId: "OTHER", accidentDate: "2020-01-01", claimDate: "2020-02-01", damageValue: 50, zones: ["27"] }),
    ]);
    assert.deepStrictEqual(res.items.map((i) => i.primary.claimId), ["OTHER", "A", "B"]);
    assert.deepStrictEqual(res.items.map((i) => i.probableWith), [[], [3], [2]]);
    assert.strictEqual(res.entriesCount, 3);
    assert.strictEqual(res.likelyEventsCount, 2);
    assert.strictEqual(res.likelyTotalValue, 350, "newest of the cluster (A: 300) + OTHER (50)");
    assert.strictEqual(res.likelyTotalCurrency, "PLN");
  });

  test("probable links are transitive across a cluster of three", () => {
    const res = dedupeClaims([
      claim({ claimId: "A", accidentDate: "2025-01-01", claimDate: "2025-01-05", zones: ["01", "02", "03"] }),
      claim({ claimId: "B", accidentDate: "2025-01-03", claimDate: "2025-01-06", zones: ["01", "02", "03"] }),
      claim({ claimId: "C", accidentDate: "2025-01-06", claimDate: "2025-01-09", zones: ["01", "02", "03"] }),
    ]);
    assert.strictEqual(classifyPair(res.items[0].primary, res.items[2].primary), "DIFFERENT", "A and C are 5 days apart");
    assert.deepStrictEqual(res.items.map((i) => i.probableWith), [[2, 3], [1, 3], [1, 2]]);
    assert.strictEqual(res.likelyEventsCount, 1);
    assert.strictEqual(res.likelyTotalValue, 10000);
  });

  test("a merged group is probable-linked when any member pair is PROBABLE", () => {
    const res = dedupeClaims([
      claim({ claimId: "A1", accidentDate: "2025-02-20", claimDate: "2025-02-25", zones: ["01", "02", "03"] }),
      claim({ claimId: "A2", accidentDate: "2025-02-20", claimDate: "2025-03-25", zones: ["01", "02", "03"] }),
      claim({ claimId: "B", accidentDate: null, claimDate: "2025-05-01", zones: ["01", "02", "03"] }),
    ]);
    assert.strictEqual(res.items.length, 2);
    assert.strictEqual(res.items[0].dedupKind, "MERGED");
    assert.strictEqual(res.items[1].dedupKind, "SINGLE");
    assert.strictEqual(res.likelyEventsCount, 1);
  });

  test("isTotalLoss of a merged item is the OR over all members: a newer partial estimate does not hide it", () => {
    const older = claim({ claimId: "OLD", claimDate: "2025-03-01", isTotalLoss: true, zones: ["01", "02"] });
    const newer = claim({ claimId: "NEW", claimDate: "2025-05-01", isTotalLoss: false, zones: ["01", "02"] });
    const res = dedupeClaims([newer, older]);
    assert.strictEqual(res.items.length, 1);
    assert.strictEqual(res.items[0].primary.claimId, "NEW");
    assert.strictEqual(res.items[0].primary.isTotalLoss, false);
    assert.strictEqual(res.items[0].isTotalLoss, true);

    const none = dedupeClaims([claim({ zones: ["01"] }), claim({ zones: ["01"] })]);
    assert.strictEqual(none.items[0].isTotalLoss, false);
    // single items keep their own flag; probable (not merged) items are not OR-ed together
    const [za, zb] = zonesOfSim.sixTenths;
    const prob = dedupeClaims([
      claim({ claimId: "P1", isTotalLoss: true, zones: [...za] }),
      claim({ claimId: "P2", accidentDate: null, isTotalLoss: false, zones: [...zb] }),
    ]);
    assert.deepStrictEqual(prob.items.map((i) => [i.primary.claimId, i.isTotalLoss]), [["P1", true], ["P2", false]]);
  });

  test("a lone zone code parsed as a number ('5') counts as zone 05 for the comparison", () => {
    const zonesOf = (codes: unknown[]) =>
      withDedupFields({ claimId: "x", damageAssessmentJson: JSON.stringify({ damagePositionCodes: codes }) }).zones;
    assert.deepStrictEqual(zonesOf(["5"]), ["05"]);
    assert.deepStrictEqual(zonesOf([5]), ["05"]);
    assert.deepStrictEqual(zonesOf(["5", "05", "17"]).sort(), ["05", "17"]);
    assert.deepStrictEqual(zonesOf(["0"]), [], "0 is the undefined zone 00");
  });

  test("mixed currencies: the likely total has no currency", () => {
    const [za, zb] = zonesOfSim.sixTenths;
    const res = dedupeClaims([
      claim({ claimId: "A", currency: "PLN", zones: [...za] }),
      claim({ claimId: "B", currency: "EUR", accidentDate: null, zones: [...zb] }),
      claim({ claimId: "C", currency: "EUR", accidentDate: "2010-01-01", zones: ["27"] }),
    ]);
    assert.strictEqual(res.likelyTotalCurrency, undefined);
  });

  test("no claims", () => {
    const res = dedupeClaims([]);
    assert.deepStrictEqual([res.items.length, res.entriesCount, res.likelyEventsCount, res.likelyTotalValue], [0, 0, 0, 0]);
  });
});

describe("claim-dedup: real fixture (BMW 420d)", () => {
  const report = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "lib/pdf/tests/fixtures/real-bmw-420d-report.json"), "utf8")
  );

  test("A and B are PROBABLE: 2 entries, 1 likely event, total = claim A (latest, created 2025-10-11)", () => {
    const res = dedupeRawClaims<any>(report.damageClaims);
    assert.strictEqual(res.entriesCount, 2);
    assert.strictEqual(res.likelyEventsCount, 1);
    assert.strictEqual(res.likelyTotalValue, 19768.92);
    assert.strictEqual(res.likelyTotalCurrency, "PLN");
    assert.deepStrictEqual(res.items.map((i) => i.dedupKind), ["SINGLE", "SINGLE"]);
    assert.deepStrictEqual(res.items.map((i) => i.probableWith), [[2], [1]]);
    assert.strictEqual(res.items[0].primary.accidentDate, "2025-02-20");
    assert.ok(!res.items[1].primary.accidentDate);
    assert.deepStrictEqual(res.items[0].primary.zones.sort(), ["05", "14", "15", "19", "22", "23"]);
  });

  test("with claim B's accident date set to A's they merge into one item", () => {
    const claims = report.damageClaims.map((c: any, i: number) => (i === 1 ? { ...c, accidentDate: "2025-02-20" } : c));
    const res = dedupeRawClaims<any>(claims);
    assert.strictEqual(res.items.length, 1);
    assert.strictEqual(res.items[0].dedupKind, "MERGED");
    assert.strictEqual(res.items[0].primary.damageValue, 19768.92);
    assert.strictEqual(res.items[0].earlierAssessments.length, 1);
    assert.strictEqual(res.items[0].earlierAssessments[0].damageValue, 15483.51);
    assert.deepStrictEqual(res.items[0].probableWith, []);
    assert.strictEqual(res.entriesCount, 1);
    assert.strictEqual(res.likelyEventsCount, 1);
  });
});
