/**
 * Automatic claim de-duplication (computed at render time, nothing is stored).
 *
 * Audatex CHE returns no shared event identifier: every assessment (cost estimate) of one accident is a
 * separate record, so several assessments of one accident show up as several claims. Claims are compared
 * by accident date and by the overlap of their damage zones (or general flags when there are no zones).
 */
import { normalizeDamageAssessment } from "../damage/normalize-damage-assessment.ts";
import { normalizeZoneCode } from "../damage/audatex-classification.ts";
import { parseDateMs } from "../pdf/pdf-format.ts";

// Thresholds are to be calibrated on historical data.
export const SAME_MIN_SIM = 0.5;
export const PROBABLE_MIN_SIM = 0.6;
export const PROBABLE_MAX_CREATION_GAP_DAYS = 60;
export const PROBABLE_MAX_ACCIDENT_GAP_DAYS = 3;

export interface DedupClaim {
  id?: string;
  claimId: string;
  accidentDate?: string | null;
  /** Creation / registration date of the assessment. */
  claimDate?: string | null;
  damageValue?: number | null;
  currency?: string | null;
  isTotalLoss?: boolean | null;
  /** Zone codes 01-27 (zone 00 excluded). */
  zones: string[];
  /** General flag keys that are true. */
  flags: string[];
}

export type PairKind = "SAME" | "PROBABLE" | "DIFFERENT";
export type DedupKind = "SINGLE" | "MERGED";

export interface DedupItem<T extends DedupClaim> {
  primary: T;
  /** Other assessments of the same accident, newest first. Empty unless MERGED. */
  earlierAssessments: T[];
  dedupKind: DedupKind;
  /** True when ANY merged assessment (primary or earlier) is a total loss: a newer partial estimate must not hide it. */
  isTotalLoss: boolean;
  /** Accident date shown for the item: the primary's, or the shared one from the members. */
  accidentDate?: string;
  /** 1-based display indices of the other items in the same probable cluster. */
  probableWith: number[];
}

export interface DedupResult<T extends DedupClaim> {
  items: DedupItem<T>[];
  entriesCount: number;
  /** Probable clusters count as one event (a cluster of k items = 1). */
  likelyEventsCount: number;
  /** Sum of the newest assessment of every probable cluster. */
  likelyTotalValue: number;
  /** Undefined when nothing is valued or the currencies differ. */
  likelyTotalCurrency?: string;
}

const DAY_MS = 86_400_000;

function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Zone-set Jaccard, else flag-set Jaccard, else null (insufficient data, counts as different). */
export function claimSimilarity(a: DedupClaim, b: DedupClaim): number | null {
  if (a.zones.length > 0 && b.zones.length > 0) return jaccard(a.zones, b.zones);
  if (a.flags.length > 0 && b.flags.length > 0) return jaccard(a.flags, b.flags);
  return null;
}

function gapDays(a?: string | null, b?: string | null): number | undefined {
  const ma = parseDateMs(a);
  const mb = parseDateMs(b);
  if (ma === undefined || mb === undefined) return undefined;
  return Math.abs(ma - mb) / DAY_MS;
}

export function classifyPair(a: DedupClaim, b: DedupClaim): PairKind {
  const sim = claimSimilarity(a, b);
  if (sim === null) return "DIFFERENT";

  const accA = parseDateMs(a.accidentDate);
  const accB = parseDateMs(b.accidentDate);
  if (accA !== undefined && accB !== undefined && accA === accB && sim >= SAME_MIN_SIM) return "SAME";

  if (sim < PROBABLE_MIN_SIM) return "DIFFERENT";
  if (accA === undefined || accB === undefined) {
    const gap = gapDays(a.claimDate, b.claimDate);
    return gap !== undefined && gap <= PROBABLE_MAX_CREATION_GAP_DAYS ? "PROBABLE" : "DIFFERENT";
  }
  return Math.abs(accA - accB) / DAY_MS <= PROBABLE_MAX_ACCIDENT_GAP_DAYS ? "PROBABLE" : "DIFFERENT";
}

function valueOf(c: DedupClaim): number {
  return typeof c.damageValue === "number" ? c.damageValue : 0;
}

/** Newest assessment first: latest claimDate, then higher damageValue, then claimId ascending. */
function compareNewestFirst(a: DedupClaim, b: DedupClaim): number {
  const da = parseDateMs(a.claimDate) ?? -Infinity;
  const db = parseDateMs(b.claimDate) ?? -Infinity;
  if (da !== db) return da > db ? -1 : 1;
  if (valueOf(a) !== valueOf(b)) return valueOf(a) > valueOf(b) ? -1 : 1;
  return a.claimId < b.claimId ? -1 : a.claimId > b.claimId ? 1 : 0;
}

function compareEarlier(a: DedupClaim, b: DedupClaim): number {
  const byNewest = compareNewestFirst(a, b);
  if (byNewest !== 0) return byNewest;
  return (a.currency ?? "").localeCompare(b.currency ?? "");
}

class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }
  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

function groupsOf(uf: UnionFind, n: number): number[][] {
  const map = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = uf.find(i);
    map.set(r, [...(map.get(r) ?? []), i]);
  }
  return [...map.values()];
}

export function dedupeClaims<T extends DedupClaim>(claims: T[]): DedupResult<T> {
  // 1. merged groups: union-find over SAME edges (transitive)
  const sameUf = new UnionFind(claims.length);
  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      if (classifyPair(claims[i], claims[j]) === "SAME") sameUf.union(i, j);
    }
  }
  const groups = groupsOf(sameUf, claims.length).map((idx) => idx.map((i) => claims[i]));

  // 2. primary + earlier assessments per group
  const built = groups.map((members) => {
    const sorted = [...members].sort(compareNewestFirst);
    const primary = sorted[0];
    const earlier = sorted.slice(1).sort(compareEarlier);
    const accidentDate = primary.accidentDate || members.find((m) => m.accidentDate)?.accidentDate || undefined;
    return { members, primary, earlier, accidentDate };
  });

  // 3. chronological display order: (accidentDate ?? claimDate) ascending
  const dateKey = (g: { primary: T; accidentDate?: string }) =>
    parseDateMs(g.accidentDate ?? g.primary.claimDate) ?? Infinity;
  built.sort(
    (a, b) =>
      dateKey(a) - dateKey(b) ||
      (a.primary.claimId < b.primary.claimId ? -1 : a.primary.claimId > b.primary.claimId ? 1 : 0)
  );

  // 4. probable clusters: union-find over groups linked by any PROBABLE member pair
  const probUf = new UnionFind(built.length);
  for (let i = 0; i < built.length; i++) {
    for (let j = i + 1; j < built.length; j++) {
      const linked = built[i].members.some((a) =>
        built[j].members.some((b) => classifyPair(a, b) === "PROBABLE")
      );
      if (linked) probUf.union(i, j);
    }
  }
  const clusters = groupsOf(probUf, built.length);
  const clusterOf = new Map<number, number[]>();
  for (const c of clusters) for (const i of c) clusterOf.set(i, c);

  const items: DedupItem<T>[] = built.map((g, i) => ({
    primary: g.primary,
    earlierAssessments: g.earlier,
    dedupKind: g.members.length > 1 ? "MERGED" : "SINGLE",
    isTotalLoss: g.members.some((m) => Boolean(m.isTotalLoss)),
    accidentDate: g.accidentDate,
    probableWith: (clusterOf.get(i) ?? []).filter((x) => x !== i).map((x) => x + 1),
  }));

  // 5. summary: newest assessment of each cluster
  const picked = clusters.map((c) => c.map((i) => built[i].primary).sort(compareNewestFirst)[0]);
  const valued = picked.filter((c) => typeof c.damageValue === "number" && c.damageValue > 0);
  const currencies = new Set(valued.map((c) => c.currency ?? ""));

  return {
    items,
    entriesCount: items.length,
    likelyEventsCount: clusters.length,
    likelyTotalValue: valued.reduce((s, c) => s + valueOf(c), 0),
    likelyTotalCurrency: valued.length > 0 && currencies.size === 1 ? valued[0].currency ?? undefined : undefined,
  };
}

const ZONE_CODE_RE = /^(0[1-9]|1\d|2[0-7])$/;

/**
 * Raw damage claim (as stored / returned by the API) with the zone and flag sets used for comparison.
 * Reads the raw assessment fields through the same normalisation as the presentation; claims without an
 * assessment (legacy) get no zones and no flags and are therefore never merged.
 */
export function withDedupFields<C extends { damageAssessmentJson?: string | null }>(
  claim: C
): C & Pick<DedupClaim, "zones" | "flags"> {
  let zones: string[] = [];
  let flags: string[] = [];
  if (claim.damageAssessmentJson) {
    try {
      const raw = JSON.parse(claim.damageAssessmentJson);
      const normalized = normalizeDamageAssessment({
        generalFlags: raw?.generalFlags,
        glassFlags: raw?.glassFlags,
        damagePositionCodes: raw?.damagePositionCodes,
        significantPartGroupCodes: raw?.significantPartGroupCodes,
      });
      zones = [...new Set(normalized.damagePositionCodes.map((c) => normalizeZoneCode(c ?? "")).filter((c) => ZONE_CODE_RE.test(c)))];
      flags = Object.entries(normalized.generalFlags)
        .filter(([, v]) => v)
        .map(([k]) => k);
    } catch {
      // unparsable assessment: treated as no data
    }
  }
  return { ...claim, zones, flags };
}

/** De-duplicates raw damage claims (API shape). */
export function dedupeRawClaims<C extends DedupClaimSource>(rawClaims: C[]): DedupResult<C & Pick<DedupClaim, "zones" | "flags">> {
  return dedupeClaims(rawClaims.map(withDedupFields));
}

/** Fields of a raw claim needed for de-duplication (null-tolerant: the API returns nulls). */
export type DedupClaimSource = Omit<DedupClaim, "zones" | "flags"> & { damageAssessmentJson?: string | null };
