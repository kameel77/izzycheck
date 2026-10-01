/**
 * Pure helpers for the IzzyCheck PDF report (formatting, labels, layout maths).
 * No React / renderer imports here so everything is unit-testable.
 */

export type Tone = "ok" | "caution" | "risk" | "neutral";

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Integer amount with Polish grouping (DESIGN.md section 3). */
export function formatAmount(value: number): string {
  return value.toLocaleString("pl-PL", { maximumFractionDigits: 0 });
}

/** Date + time in the Warsaw timezone, e.g. "06.08.2026, 14:00". */
export function formatDateTimeWarsaw(input: string | number | Date): string {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("pl-PL", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** ISO-3 and ISO-2 country codes returned by Audatex mapped to Polish names. Unknown values are shown raw. */
export const COUNTRY_NAMES: Record<string, string> = {
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

export function formatCountry(code?: string | null): string {
  const raw = (code ?? "").trim();
  if (!raw) return "Brak danych";
  return COUNTRY_NAMES[raw.toUpperCase()] ?? raw;
}

/** Mandate descriptions that carry no information ("Brak kodu mandatu" is Audatex's placeholder). */
export function formatMandateDescription(description?: string | null): string {
  const text = (description ?? "").trim();
  if (!text || text.toLowerCase() === "brak kodu mandatu") return "—";
  return text;
}

const BODY_TYPE_NAMES: Record<string, string> = {
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
};

/** Body type for display: known values via a small Polish map, anything else with a capitalised first letter. */
export function formatBodyType(bodyType?: string | null): string | undefined {
  const raw = (bodyType ?? "").trim();
  if (!raw) return undefined;
  return BODY_TYPE_NAMES[raw.toLowerCase()] ?? raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** Polish plural form selector: 1 -> one, 2-4 (excluding 12-14) -> few, otherwise many. */
export function polishPlural(count: number, one: string, few: string, many: string): string {
  if (count === 1) return one;
  const mod10 = count % 10;
  const mod100 = count % 100;
  return mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20) ? few : many;
}

/** Polish plural of "szkoda": 1 szkoda/szkodę, 2-4 szkody, 5+ szkód. */
export function claimNoun(count: number, form: "nom" | "acc" = "nom"): string {
  return polishPlural(count, form === "acc" ? "szkodę" : "szkoda", "szkody", "szkód");
}

/** "1 pozycja" / "3 pozycje" / "5 pozycji". */
export function itemCountLabel(count: number): string {
  return `${count} ${polishPlural(count, "pozycja", "pozycje", "pozycji")}`;
}

/** "1 wpis" / "2 wpisy" / "5 wpisów": display entries (merged assessments count once; probable duplicates still count separately). */
export function entryCountLabel(count: number): string {
  return `${count} ${polishPlural(count, "wpis", "wpisy", "wpisów")}`;
}

/** Genitive after "dotyczące": "1 szkody" / "2 szkód" / "5 szkód". */
export function claimCountGenitive(count: number): string {
  return `${count} ${polishPlural(count, "szkody", "szkód", "szkód")}`;
}

/** "szkodę całkowitą" / "2 szkody całkowite" / "5 szkód całkowitych" (accusative, used after "w tym"). */
export function totalLossPhrase(count: number): string {
  if (count === 1) return "szkodę całkowitą";
  const noun = claimNoun(count);
  return `${count} ${noun} ${noun === "szkody" ? "całkowite" : "całkowitych"}`;
}

/**
 * Audatex returns ~100 raw attributes, most of them system keys (ax_Options, HS_M, KP_UNI, ...).
 * Only keys with a Polish label here are printed; unknown keys are intentionally hidden.
 * Values keep Audatex formatting (including decimal commas). "CO2" is written without the subscript
 * because the embedded Arial font has no glyph for it.
 */
export const RAW_ATTRIBUTE_LABELS: Record<string, string> = {
  rowName: "Seria / model",
  engineMark: "Oznaczenie silnika",
  emissionLevel1: "Emisja CO2 (g/km)",
  acceleration: "Przyspieszenie 0–100 km/h (s)",
  couple: "Moment obrotowy (Nm)",
  storageSpace: "Pojemność bagażnika (l)",
  petrolConsumptionEHKmix: "Zużycie paliwa – cykl mieszany (l/100 km)",
  petrolCapacityMain: "Pojemność zbiornika paliwa (l)",
  towedLoadBraking: "Masa przyczepy z hamulcem (kg)",
};

/** Labelled, non-empty raw attributes as [label, value] pairs, in the order of RAW_ATTRIBUTE_LABELS. */
export function filterRawAttributes(raw?: Record<string, unknown> | null): [string, string][] {
  if (!raw) return [];
  const out: [string, string][] = [];
  for (const [key, label] of Object.entries(RAW_ATTRIBUTE_LABELS)) {
    const value = raw[key];
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text !== "") out.push([label, text]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/**
 * Parses ISO "YYYY-MM-DD" (optionally followed by a "T..." time) to epoch ms in UTC.
 * Strict: impossible dates ("2025-13-45", "2025-02-30") and non-ISO strings ("11.10.2025") give undefined.
 */
export function parseDateMs(value?: string | null): number | undefined {
  if (!value) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(value.trim());
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return undefined;
  return date.getTime();
}

// ---------------------------------------------------------------------------
// Claims summary, KPI tiles
// ---------------------------------------------------------------------------

export type ClaimsPresentationKey =
  | "HISTORY_DETECTED_DETAILS_NOT_REQUESTED"
  | "HISTORY_DETECTED_DETAILS_UNAVAILABLE"
  | "NO_HISTORY"
  | "CLAIM_DETAILS_AVAILABLE"
  | "UNAVAILABLE";

export interface SummaryClaim {
  accidentDate?: string;
  claimDate?: string;
  damageValue?: number;
  currency: string;
  isTotalLoss: boolean;
}

/** Sum of claim values; undefined when there is nothing to sum or currencies differ. */
export function sumClaimValues(claims: SummaryClaim[]): { total: number; currency: string } | undefined {
  const valued = claims.filter((c) => typeof c.damageValue === "number" && c.damageValue > 0);
  if (valued.length === 0) return undefined;
  const currency = valued[0].currency;
  if (valued.some((c) => c.currency !== currency)) return undefined;
  return { total: valued.reduce((s, c) => s + (c.damageValue as number), 0), currency };
}

/** Result of claim de-duplication, as far as the summary texts need it. */
export interface DedupSummary {
  /** Display items (merged assessments count once). */
  entriesCount: number;
  /** Probable clusters count once. */
  likelyEventsCount: number;
  /** Sum of the newest assessment of every probable cluster; undefined when not summable. */
  likelyTotal?: { total: number; currency: string };
  /** At least one item merges several assessments. */
  hasMerged: boolean;
}

/** Newest registration date among the (primary) claims; used when assessments were merged. */
function newestAssessmentDate(claims: SummaryClaim[]): string | undefined {
  let best: { ms: number; label: string } | undefined;
  for (const c of claims) {
    const label = c.claimDate || c.accidentDate;
    const ms = parseDateMs(label);
    if (label && ms !== undefined && (!best || ms > best.ms)) best = { ms, label };
  }
  return best?.label;
}

function lastClaimDate(claims: SummaryClaim[]): string | undefined {
  let best: { ms: number; label: string } | undefined;
  for (const c of claims) {
    const label = c.accidentDate || c.claimDate;
    const ms = parseDateMs(label);
    if (label && ms !== undefined && (!best || ms > best.ms)) best = { ms, label };
  }
  return best?.label;
}

/** Factual one-liner (no judgements). Returns null when nothing factual can be said. */
export function buildFactualSummary(input: {
  claimsHistoryPresentation: ClaimsPresentationKey;
  claims: SummaryClaim[];
  dedup?: DedupSummary;
}): string | null {
  const { claimsHistoryPresentation: p, claims, dedup } = input;
  if (p === "CLAIM_DETAILS_AVAILABLE" && claims.length > 0) {
    if (dedup && dedup.likelyEventsCount < dedup.entriesCount) {
      let text = `Zarejestrowano ${entryCountLabel(dedup.entriesCount)}, prawdopodobnie dotyczące ${claimCountGenitive(dedup.likelyEventsCount)}.`;
      if (dedup.likelyTotal) {
        text += ` Łączna wartość szkód według najnowszych wycen: ${formatAmount(dedup.likelyTotal.total)} ${dedup.likelyTotal.currency} netto (bez VAT).`;
      }
      return text;
    }
    const n = claims.length;
    const merged = dedup?.hasMerged ?? false;
    const last = merged ? newestAssessmentDate(claims) : lastClaimDate(claims);
    const totalLosses = claims.filter((c) => c.isTotalLoss).length;
    const sum = sumClaimValues(claims);
    let text = `Zarejestrowano ${n} ${claimNoun(n, "acc")}`;
    if (last) text += merged ? ` (najnowsza wycena: ${last})` : ` (ostatnia: ${last})`;
    if (totalLosses > 0) text += `, w tym ${totalLossPhrase(totalLosses)}`;
    text += ".";
    if (sum) text += ` Łączna wartość szkód: ${formatAmount(sum.total)} ${sum.currency} netto (bez VAT).`;
    return text;
  }
  if (p === "NO_HISTORY") return "W bazie Audatex nie odnotowano szkód dla tego pojazdu.";
  if (p === "HISTORY_DETECTED_DETAILS_NOT_REQUESTED" || p === "HISTORY_DETECTED_DETAILS_UNAVAILABLE") {
    return "W bazie Audatex wykryto wpisy historii szkód.";
  }
  return null;
}

export interface KpiSpec {
  tone: Tone;
  value: string;
  sub?: string;
}

export function isModuleRequested(status?: string): boolean {
  return !!status && status !== "NOT_REQUESTED" && status !== "NIEWYKONANO";
}

export function buildClaimsKpi(input: {
  claimsHistoryPresentation: ClaimsPresentationKey;
  claimCheckStatus?: string;
  claims: SummaryClaim[];
  dedup?: DedupSummary;
}): KpiSpec {
  const { claimsHistoryPresentation: p, claimCheckStatus, claims, dedup } = input;
  if (p !== "CLAIM_DETAILS_AVAILABLE" && !isModuleRequested(claimCheckStatus)) {
    return { tone: "neutral", value: "Nie zamówiono" };
  }
  switch (p) {
    case "CLAIM_DETAILS_AVAILABLE": {
      const n = claims.length;
      const totalLosses = claims.filter((c) => c.isTotalLoss).length;
      if (dedup && dedup.likelyEventsCount < dedup.entriesCount) {
        return {
          tone: totalLosses > 0 ? "risk" : "caution",
          value: entryCountLabel(dedup.entriesCount),
          sub: `prawdopodobnie ${dedup.likelyEventsCount} ${claimNoun(dedup.likelyEventsCount)}`,
        };
      }
      let sub: string | undefined;
      if (totalLosses === 1) sub = "w tym szkoda całkowita";
      else if (totalLosses > 1) sub = `w tym ${totalLosses} ${claimNoun(totalLosses)} ${claimNoun(totalLosses) === "szkody" ? "całkowite" : "całkowitych"}`;
      else {
        const sum = sumClaimValues(claims);
        if (sum) sub = `łącznie ${formatAmount(sum.total)} ${sum.currency} netto (bez VAT)`;
      }
      return { tone: totalLosses > 0 ? "risk" : "caution", value: `${n} ${claimNoun(n)}`, sub };
    }
    case "HISTORY_DETECTED_DETAILS_NOT_REQUESTED":
      return { tone: "caution", value: "Wykryto wpisy", sub: "szczegóły nie były zamówione" };
    case "HISTORY_DETECTED_DETAILS_UNAVAILABLE":
      return { tone: "caution", value: "Wykryto wpisy", sub: "szczegóły niedostępne" };
    case "NO_HISTORY":
      return { tone: "ok", value: "Brak szkód", sub: "w bazie Audatex" };
    default:
      return { tone: "risk", value: "Niedostępne", sub: "kontrola nie została wykonana" };
  }
}

export function buildCompletenessKpi(status: string): KpiSpec {
  if (status === "COMPLETED") return { tone: "ok", value: "Kompletny" };
  if (status === "PARTIALLY_FAILED") return { tone: "caution", value: "Niepełny (as-is)" };
  if (status === "FAILED") return { tone: "risk", value: "Niepowodzenie" };
  return { tone: "neutral", value: "W trakcie" };
}

export interface ModuleDot {
  label: string;
  tone: Tone;
}

/** Requested modules only, each with a status tone. */
export function buildModuleDots(input: {
  valuationStatus?: string;
  claimCheckStatus?: string;
  claimDetailsStatus?: string;
}): ModuleDot[] {
  const toneOf = (s: string): Tone => (s === "SUCCEEDED" || s === "NO_DATA" ? "ok" : s === "FAILED" ? "risk" : "caution");
  const defs: [string, string | undefined][] = [
    ["Wycena pojazdu", input.valuationStatus],
    ["Kontrola historii szkód", input.claimCheckStatus],
    ["Szczegóły szkód", input.claimDetailsStatus],
  ];
  return defs
    .filter(([, status]) => isModuleRequested(status))
    .map(([label, status]) => ({ label, tone: toneOf(status as string) }));
}

/** Market value as a rounded percentage of the new price; undefined unless both values are > 0. */
export function marketToNewPct(market?: number, newPrice?: number): number | undefined {
  if (!market || !newPrice || market <= 0 || newPrice <= 0) return undefined;
  return Math.round((market / newPrice) * 100);
}

// ---------------------------------------------------------------------------
// Section numbering
// ---------------------------------------------------------------------------

/** Numbers the present sections 1..n in the given (render) order. */
export function numberSections(order: string[], present: Record<string, boolean>): Record<string, number> {
  const out: Record<string, number> = {};
  let n = 0;
  for (const key of order) {
    if (present[key]) out[key] = ++n;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Damage markers
// ---------------------------------------------------------------------------

export interface Point {
  x: number;
  y: number;
}

export interface NudgeOptions {
  radius: number;
  width: number;
  height: number;
  /** Extra clear space between two markers on top of 2r. Default 2. */
  gap?: number;
  iterations?: number;
}

/**
 * Deterministically pushes overlapping markers apart (pairwise relaxation) so that no two centres are
 * closer than 2r + gap, keeping every marker fully inside the viewBox.
 */
export function nudgeMarkers(points: Point[], opts: NudgeOptions): Point[] {
  const { radius: r, width, height } = opts;
  const minDist = 2 * r + (opts.gap ?? 2);
  const iterations = opts.iterations ?? 600;
  const clampX = (x: number) => Math.min(width - r, Math.max(r, x));
  const clampY = (y: number) => Math.min(height - r, Math.max(r, y));
  const pts = points.map((p) => ({ x: clampX(p.x), y: clampY(p.y) }));

  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        let dx = pts[j].x - pts[i].x;
        let dy = pts[j].y - pts[i].y;
        let d = Math.hypot(dx, dy);
        if (d >= minDist) continue;
        if (d < 1e-6) {
          const angle = (j + 1) * 2.399963; // golden angle: deterministic direction for coincident points
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          d = 1;
        }
        const push = (minDist - Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y)) / 2 + 0.05;
        const ux = dx / d;
        const uy = dy / d;
        pts[i] = { x: clampX(pts[i].x - ux * push), y: clampY(pts[i].y - uy * push) };
        pts[j] = { x: clampX(pts[j].x + ux * push), y: clampY(pts[j].y + uy * push) };
        moved = true;
      }
    }
    if (!moved) break;
  }
  return pts;
}

/** `count` points evenly distributed on a horizontal row between x0 and x1. */
export function distributeRow(count: number, y: number, x0: number, x1: number): Point[] {
  if (count <= 0) return [];
  if (count === 1) return [{ x: (x0 + x1) / 2, y }];
  const step = (x1 - x0) / (count - 1);
  return Array.from({ length: count }, (_, i) => ({ x: x0 + i * step, y }));
}

// ---------------------------------------------------------------------------
// Claims timeline
// ---------------------------------------------------------------------------

export interface TimelineEventInput {
  id: string;
  date?: string;
}

export interface TimelineEvent {
  id: string;
  /** 0..1 position along the track. */
  pos: number;
  /** Label row: 0 above, 1 below, 2 higher above, 3 lower below. -1 when no row is free. */
  level: number;
  /** False when every label row is busy at this position (the dot is drawn without a label). */
  labeled: boolean;
}

export interface TimelineTick {
  year: number;
  pos: number;
  showLabel: boolean;
}

export interface TimelineModel {
  startYear: number;
  endYear: number;
  ticks: TimelineTick[];
  events: TimelineEvent[];
  levelsUsed: number;
}

export function buildTimeline(input: {
  startDate?: string;
  endDate?: string;
  events: TimelineEventInput[];
  widthPt: number;
  labelWidthPt: number;
  tickLabelWidthPt?: number;
}): TimelineModel | null {
  const parsed = input.events
    .map((e) => ({ id: e.id, ms: parseDateMs(e.date) }))
    .filter((e): e is { id: string; ms: number } => e.ms !== undefined);
  if (parsed.length === 0) return null;

  const yearOf = (ms: number) => new Date(ms).getUTCFullYear();
  const startMs = parseDateMs(input.startDate);
  const endMs = parseDateMs(input.endDate);
  const evMin = Math.min(...parsed.map((e) => e.ms));
  const evMax = Math.max(...parsed.map((e) => e.ms));
  const startYear = yearOf(Math.min(startMs ?? evMin, evMin));
  const endYear = yearOf(Math.max(endMs ?? evMax, evMax));

  const t0 = Date.UTC(startYear, 0, 1);
  const span = Date.UTC(endYear + 1, 0, 1) - t0;
  const posOf = (ms: number) => Math.min(1, Math.max(0, (ms - t0) / span));

  const years = endYear - startYear + 1;
  const tickStep = Math.max(1, Math.ceil((input.tickLabelWidthPt ?? 30) / (input.widthPt / years)));
  const ticks: TimelineTick[] = [];
  for (let y = startYear; y <= endYear; y++) {
    ticks.push({ year: y, pos: (Date.UTC(y, 0, 1) - t0) / span, showLabel: (y - startYear) % tickStep === 0 });
  }

  const minGap = (input.labelWidthPt + 4) / input.widthPt;
  const last: number[] = [-Infinity, -Infinity, -Infinity, -Infinity];
  const events: TimelineEvent[] = [...parsed]
    .map((e, i) => ({ ...e, i }))
    .sort((a, b) => a.ms - b.ms || a.i - b.i)
    .map((e) => {
      const pos = posOf(e.ms);
      const level = last.findIndex((l) => pos - l >= minGap);
      if (level === -1) return { id: e.id, pos, level: -1, labeled: false };
      last[level] = pos;
      return { id: e.id, pos, level, labeled: true };
    });

  return {
    startYear,
    endYear,
    ticks,
    events,
    levelsUsed: Math.max(0, ...events.map((e) => e.level)) + 1,
  };
}
