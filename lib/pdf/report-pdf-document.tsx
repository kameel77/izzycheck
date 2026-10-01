import React from "react";
import path from "node:path";
import fs from "node:fs";
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  Svg,
  Path,
  Circle,
  Font,
} from "@react-pdf/renderer";
import { ReportPdfViewModel, ReportPdfClaimItem } from "./report-pdf-view-model.ts";
import { ISSUER_CONFIG } from "../config/issuer.ts";
import { sortEquipmentAlphabetically, chunkEquipmentForRows } from "../reports/equipment.ts";
import { CATEGORY_DEFINITIONS } from "../damage/audatex-classification.ts";
import type { ProcessedMarkerItem } from "../damage/build-damage-presentation.ts";
import { PHOTO_1_CAPTION, PHOTO_2_CAPTION } from "../damage/build-damage-presentation.ts";
import {
  UNDERBODY_IMAGE_PDF_JPG,
  UNDERBODY_VIEWBOX_H,
  UNDERBODY_VIEWBOX_W,
} from "../damage/vehicle-templates.ts";
import {
  Tone,
  KpiSpec,
  formatAmount,
  formatDamageGrossRange,
  DAMAGE_GROSS_CAPTION,
  formatCountry,
  formatDateTimeWarsaw,
  formatMandateDescription,
  formatBodyType,
  filterRawAttributes,
  buildFactualSummary,
  buildClaimsKpi,
  buildCompletenessKpi,
  buildModuleDots,
  marketToNewPct,
  numberSections,
  nudgeMarkers,
  distributeRow,
  buildTimeline,
  itemCountLabel,
  Point,
} from "./pdf-format.ts";
import pkg from "../../package.json" with { type: "json" };

// Register local Unicode TTF font for Polish characters (ą ć ę ł ń ó ś ź ż Ą Ć Ę Ł Ń Ó Ś Ź Ż)
const fontsDir = path.join(process.cwd(), "public", "fonts");

Font.register({
  family: "ArialCustom",
  fonts: [
    { src: path.join(fontsDir, "Arial.ttf"), fontWeight: "normal" },
    { src: path.join(fontsDir, "Arial-Bold.ttf"), fontWeight: "bold" },
  ],
});

// ---------------------------------------------------------------------------
// Design tokens (DESIGN.md sections 2, 3, 5)
// ---------------------------------------------------------------------------

const COLORS = {
  ink: "#0f172a",
  ink2: "#334155",
  muted: "#64748b",
  faint: "#94a3b8",
  rule: "#e2e8f0",
  surface: "#f8fafc",
  surface2: "#f1f5f9",
  brandNavy: "#1e3a8a",
  brand: "#2563eb",
  white: "#ffffff",
  riskText: "#b91c1c",
  riskBg: "#fef2f2",
  riskBorder: "#fecaca",
  cautionText: "#b45309",
  cautionBg: "#fffbeb",
  cautionBorder: "#fde68a",
  okText: "#15803d",
  okBg: "#f0fdf4",
  okBorder: "#bbf7d0",
} as const;

const TYPE = {
  display: 20,
  title: 15,
  h1: 11,
  h2: 9,
  body: 8.5,
  label: 6.5,
  caption: 6.5,
} as const;

const TONES: Record<Tone, { text: string; bg: string; border: string }> = {
  risk: { text: COLORS.riskText, bg: COLORS.riskBg, border: COLORS.riskBorder },
  caution: { text: COLORS.cautionText, bg: COLORS.cautionBg, border: COLORS.cautionBorder },
  ok: { text: COLORS.okText, bg: COLORS.okBg, border: COLORS.okBorder },
  neutral: { text: COLORS.ink2, bg: COLORS.surface, border: COLORS.rule },
};

const NET_LABEL = "PLN netto (bez VAT)";
const CONTENT_W = 523; // A4 595 - 2 x 36
const MAP_GUTTER = 12;
const MAP_BOX_W = (CONTENT_W - MAP_GUTTER) / 2; // 255.5
const MAP_INNER_W = MAP_BOX_W - 2 * 0.75 - 2 * 4; // border + padding
const MAP_INNER_H = MAP_INNER_W / 2; // 2:1 car image fills the box
const MARKER_R = 11; // plain filled dot (about 7 pt on paper in the 400x200 viewBox)
const VIEWBOX_W = 400;
const VIEWBOX_H = 200;
const UB_INNER_H = (MAP_INNER_W * UNDERBODY_VIEWBOX_H) / UNDERBODY_VIEWBOX_W; // underbody image aspect (2000:1116)

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingHorizontal: 36,
    paddingBottom: 60,
    fontSize: TYPE.body,
    fontFamily: "ArialCustom",
    color: COLORS.ink2,
    backgroundColor: COLORS.white,
  },
  // Header / footer
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    borderBottomWidth: 1.5,
    borderBottomColor: COLORS.brandNavy,
    paddingBottom: 8,
    marginBottom: 12,
  },
  logoText: { fontSize: 14, fontWeight: "bold", color: COLORS.brandNavy },
  logoSub: { fontSize: 7, color: COLORS.muted, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 1 },
  headerMeta: { alignItems: "flex-end" },
  headerMetaText: { fontSize: 7, color: COLORS.muted },
  headerVin: { fontSize: 8, fontWeight: "bold", color: COLORS.ink, letterSpacing: 0.8 },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 36,
    right: 36,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 0.75,
    borderTopColor: COLORS.rule,
    paddingTop: 6,
    fontSize: TYPE.caption,
    color: COLORS.faint,
  },
  // Text primitives
  label: {
    fontSize: TYPE.label,
    color: COLORS.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  caption: { fontSize: TYPE.caption, color: COLORS.faint },
  bodyText: { fontSize: TYPE.body, color: COLORS.ink2, lineHeight: 1.35 },
  value: { fontSize: TYPE.body, fontWeight: "bold", color: COLORS.ink },
  // Section title
  sectionTitleWrap: { flexDirection: "row", alignItems: "center", marginTop: 24, marginBottom: 8 },
  sectionBar: { width: 4, height: 14, backgroundColor: COLORS.brand, marginRight: 8 },
  sectionTitleText: { fontSize: TYPE.h1, fontWeight: "bold", color: COLORS.ink },
  // Chips, badges, notices
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 2,
    paddingHorizontal: 5,
    borderRadius: 3,
    borderWidth: 0.75,
    marginRight: 4,
  },
  chipText: { fontSize: 7.5, fontWeight: "bold" },
  badgeText: { fontSize: TYPE.label, fontWeight: "bold", textTransform: "uppercase", letterSpacing: 0.3 },
  notice: {
    borderWidth: 0.75,
    borderLeftWidth: 3,
    borderRadius: 4,
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginBottom: 8,
  },
  noticeTitle: { fontSize: 7.5, fontWeight: "bold", marginBottom: 2 },
  noticeText: { fontSize: 7.5, lineHeight: 1.35 },
  // Vehicle band
  band: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  vehicleTitle: { fontSize: TYPE.title, fontWeight: "bold", color: COLORS.ink },
  vinText: { fontSize: 9, fontWeight: "bold", color: COLORS.ink, letterSpacing: 0.8, marginTop: 3 },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 6 },
  // KPI tiles
  kpiRow: { flexDirection: "row", marginBottom: 12 },
  tile: {
    flex: 1,
    borderWidth: 0.75,
    borderRadius: 4,
    padding: 10,
  },
  tileValueBox: { minHeight: 26, justifyContent: "center", marginTop: 2 },
  tileValue: { fontSize: TYPE.title, fontWeight: "bold" },
  tileSub: { fontSize: TYPE.caption, color: COLORS.muted, marginTop: 2 },
  dotRow: { flexDirection: "row", alignItems: "center", marginTop: 3 },
  dot: { width: 5, height: 5, borderRadius: 2.5, marginRight: 4 },
  dotText: { fontSize: TYPE.caption, color: COLORS.ink2 },
  summaryLine: { fontSize: TYPE.body, color: COLORS.ink2, lineHeight: 1.35, marginBottom: 4 },
  // Valuation
  valuationRow: { flexDirection: "row" },
  valuationCell: { flex: 1, paddingRight: 8 },
  valuationValue: { fontSize: TYPE.h1, fontWeight: "bold", color: COLORS.ink },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: COLORS.surface2, marginTop: 12 },
  barFill: { height: 6, borderRadius: 3, backgroundColor: COLORS.brand },
  // Key-value grid
  kvRow: { flexDirection: "row", borderBottomWidth: 0.75, borderBottomColor: COLORS.rule, paddingVertical: 4 },
  kvCell: { width: "25%", paddingRight: 6 },
  // Tables
  table: { width: "100%", marginTop: 4 },
  tableHeader: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface2,
    paddingVertical: 4,
    paddingRight: 4,
  },
  tableHeaderText: {
    fontSize: TYPE.label,
    fontWeight: "bold",
    color: COLORS.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 0.75,
    borderBottomColor: COLORS.rule,
    paddingVertical: 4,
    paddingRight: 4,
    fontSize: TYPE.body,
  },
  // Equipment
  eqGridRow: { flexDirection: "row", marginBottom: 3 },
  eqGridCell: { width: "33.33%", paddingRight: 6, flexDirection: "row", alignItems: "flex-start" },
  eqBullet: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: COLORS.brand, marginTop: 3, marginRight: 4 },
  eqText: { fontSize: 7, color: COLORS.ink2, flex: 1, lineHeight: 1.25 },
  // Claim pages
  legendRow: { flexDirection: "row", flexWrap: "wrap", marginBottom: 10 },
  legendItem: { flexDirection: "row", alignItems: "center", marginRight: 12 },
  legendDot: { width: 6, height: 6, borderRadius: 3, marginRight: 4 },
  legendText: { fontSize: 7, color: COLORS.ink2 },
  listDot: { width: 7, height: 7, borderRadius: 3.5, marginRight: 6, marginTop: 2 },
  groupChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface,
    borderWidth: 0.75,
    borderColor: COLORS.rule,
    borderRadius: 10,
    paddingVertical: 3,
    paddingHorizontal: 7,
    marginRight: 5,
    marginBottom: 4,
  },
  zoneRow: { flexDirection: "row", borderBottomWidth: 0.75, borderBottomColor: COLORS.rule },
  zoneCell: { width: "50%", flexDirection: "row", alignItems: "flex-start", paddingVertical: 4, paddingRight: 8 },
  mapRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  mapBox: {
    width: MAP_BOX_W,
    borderWidth: 0.75,
    borderColor: COLORS.rule,
    borderRadius: 4,
    padding: 4,
  },
  mapTitle: { fontSize: TYPE.label, fontWeight: "bold", color: COLORS.muted, marginBottom: 3 },
  // Disclaimer
  disclaimerBox: {
    backgroundColor: COLORS.surface,
    borderWidth: 0.75,
    borderColor: COLORS.rule,
    borderRadius: 4,
    padding: 8,
    marginTop: 24,
  },
  disclaimerText: { fontSize: 7, color: COLORS.muted, lineHeight: 1.35 },
});

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function SectionTitle({
  number,
  chip,
  children,
}: {
  number: number;
  chip?: string;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.sectionTitleWrap} minPresenceAhead={60} wrap={false}>
      <View style={styles.sectionBar} />
      <Text style={styles.sectionTitleText}>{`${number}. `}{children}</Text>
      {chip ? <Chip tone="neutral" marginLeft={8}>{chip}</Chip> : null}
    </View>
  );
}

function Chip({
  tone = "neutral",
  marginLeft,
  children,
}: {
  tone?: Tone;
  marginLeft?: number;
  children?: React.ReactNode;
}) {
  const t = tone === "neutral" ? { text: COLORS.ink2, bg: COLORS.surface2, border: COLORS.surface2 } : TONES[tone];
  return (
    <View style={[styles.chip, { backgroundColor: t.bg, borderColor: t.border, marginLeft: marginLeft ?? 0 }]}>
      <Text style={[styles.chipText, { color: t.text }]}>{children}</Text>
    </View>
  );
}

function Badge({ tone, children }: { tone: Tone; children?: React.ReactNode }) {
  const t = TONES[tone];
  return (
    <View
      style={{
        paddingVertical: 2,
        paddingHorizontal: 5,
        borderRadius: 3,
        backgroundColor: t.bg,
        borderWidth: 0.75,
        borderColor: t.border,
        marginLeft: 4,
      }}
    >
      <Text style={[styles.badgeText, { color: t.text }]}>{children}</Text>
    </View>
  );
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: Tone;
  title?: string;
  children?: React.ReactNode;
}) {
  const t = TONES[tone];
  return (
    <View
      style={[styles.notice, { backgroundColor: t.bg, borderColor: t.border, borderLeftColor: t.text }]}
      wrap={false}
    >
      {title ? <Text style={[styles.noticeTitle, { color: t.text }]}>{title}</Text> : null}
      <Text style={[styles.noticeText, { color: t.text }]}>{children}</Text>
    </View>
  );
}

/**
 * Damage amount as an estimated GROSS range (net Audatex amount + 23% VAT, bucketed) with a muted caption.
 * Non-PLN amounts are not converted and keep the net display with the currency.
 */
function DamageAmount({
  value,
  currency = "PLN",
  size = TYPE.body,
  color = COLORS.ink,
  align = "flex-start",
  shortCaption = false,
}: {
  value?: number | null;
  currency?: string;
  size?: number;
  color?: string;
  align?: "flex-start" | "flex-end";
  shortCaption?: boolean;
}) {
  if (typeof value !== "number" || value <= 0) {
    return (
      <View style={{ alignItems: align }}>
        <Text style={{ fontSize: size, fontWeight: "bold", color: COLORS.muted }}>Brak kwoty</Text>
      </View>
    );
  }
  const isPln = currency === "PLN";
  return (
    <View style={{ alignItems: align }}>
      <Text style={{ fontSize: size, fontWeight: "bold", color }}>
        {isPln ? formatDamageGrossRange(value) : formatAmount(value)}
      </Text>
      <Text style={styles.caption}>
        {isPln ? (shortCaption ? "brutto, szacunek" : DAMAGE_GROSS_CAPTION) : `${currency} netto (bez VAT)`}
      </Text>
    </View>
  );
}

function KvGrid({ items, rawLabels = false }: { items: { label: string; value: string }[]; rawLabels?: boolean }) {
  const rows = chunkEquipmentForRows(items, 4);
  return (
    <View>
      {rows.map((row, rIdx) => (
        <View key={`kv-${rIdx}`} style={styles.kvRow} wrap={false}>
          {row.map((item, cIdx) => (
            <View key={`kv-${rIdx}-${cIdx}`} style={styles.kvCell}>
              <Text
                style={rawLabels ? { fontSize: TYPE.label, color: COLORS.muted, marginBottom: 2 } : styles.label}
              >
                {item.label}
              </Text>
              <Text style={styles.value}>{item.value}</Text>
            </View>
          ))}
          {Array.from({ length: 4 - row.length }).map((_, padIdx) => (
            <View key={`kv-pad-${padIdx}`} style={styles.kvCell} />
          ))}
        </View>
      ))}
    </View>
  );
}

function Tile({ label, tone, children }: { label: string; tone: Tone; children?: React.ReactNode }) {
  const t = TONES[tone];
  return (
    <View style={[styles.tile, { backgroundColor: t.bg, borderColor: t.border }]} wrap={false}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

function KpiTile({ label, kpi }: { label: string; kpi: KpiSpec }) {
  return (
    <Tile label={label} tone={kpi.tone}>
      <View style={styles.tileValueBox}>
        <Text style={[styles.tileValue, { color: kpi.tone === "neutral" ? COLORS.muted : TONES[kpi.tone].text }]}>
          {kpi.value}
        </Text>
      </View>
      {kpi.sub ? <Text style={styles.tileSub}>{kpi.sub}</Text> : null}
    </Tile>
  );
}

// ---------------------------------------------------------------------------
// Equipment grid (plain function so the element tree keeps item texts visible)
// ---------------------------------------------------------------------------

function renderEquipmentGrid(rows: { name: string; code: string }[][], keyPrefix: string) {
  return (
    <View style={{ marginBottom: 6 }}>
      {rows.map((row, rIdx) => (
        <View key={`${keyPrefix}-row-${rIdx}`} style={styles.eqGridRow} wrap={false}>
          {row.map((item, cIdx) => (
            <View key={`${keyPrefix}-item-${rIdx}-${cIdx}`} style={styles.eqGridCell}>
              <View style={styles.eqBullet} />
              <Text style={styles.eqText}>
                {item.name} {item.code ? `(${item.code})` : ""}
              </Text>
            </View>
          ))}
          {Array.from({ length: 3 - row.length }).map((_, padIdx) => (
            <View key={`${keyPrefix}-pad-${padIdx}`} style={{ width: "33.33%" }} />
          ))}
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Claims overview: timeline + table
// ---------------------------------------------------------------------------

const TL_LABEL_W = 92;
const TL_ROW_H = 30;
const TL_INSET = 8;
const TL_DOT = 10;

function renderClaimsTimeline(model: ReportPdfViewModel) {
  const tl = buildTimeline({
    startDate: model.firstRegistrationDate,
    endDate: model.valuationDate,
    events: model.claims.map((c) => ({ id: c.claimId, date: c.accidentDate || c.claimDate })),
    widthPt: CONTENT_W - 2 * TL_INSET,
    labelWidthPt: TL_LABEL_W,
  });
  if (!tl) return null;

  const trackW = CONTENT_W - 2 * TL_INSET;
  const maxLevel = Math.max(0, ...tl.events.map((e) => e.level));
  const hasUnlabeled = tl.events.some((e) => !e.labeled);
  const aboveRows = maxLevel >= 2 ? 2 : 1;
  const belowRows = maxLevel >= 3 ? 2 : maxLevel >= 1 ? 1 : 0;
  const axisY = aboveRows * TL_ROW_H + 8;
  const yearsTop = axisY + 8 + belowRows * TL_ROW_H + 2;
  const height = yearsTop + 10;
  const xOf = (pos: number) => TL_INSET + pos * trackW;
  const placed = tl.events.flatMap((e) => {
    const claim = model.claims.find((c) => c.claimId === e.id);
    if (!claim) return [];
    const x = xOf(e.pos);
    const above = e.level % 2 === 0;
    const rowK = Math.floor(e.level / 2);
    const labelTop = above ? axisY - 8 - (rowK + 1) * TL_ROW_H : axisY + 8 + rowK * TL_ROW_H;
    return [
      {
        claim,
        x,
        labeled: e.labeled,
        above,
        labelTop,
        labelLeft: Math.min(CONTENT_W - TL_LABEL_W, Math.max(0, x - TL_LABEL_W / 2)),
        stemTop: above ? labelTop + TL_ROW_H : axisY,
        stemHeight: above ? axisY - (labelTop + TL_ROW_H) : labelTop - axisY,
      },
    ];
  });

  return (
    <View wrap={false}>
    <View style={{ width: CONTENT_W, height, position: "relative", marginBottom: hasUnlabeled ? 2 : 10 }}>
      {/* axis */}
      <View style={{ position: "absolute", left: TL_INSET, top: axisY - 0.5, width: trackW, height: 1, backgroundColor: COLORS.rule }} />
      {tl.ticks.map((t) => (
        <View key={`tick-${t.year}`}>
          <View style={{ position: "absolute", left: xOf(t.pos) - 0.4, top: axisY - 3, width: 0.8, height: 6, backgroundColor: COLORS.faint }} />
          {t.showLabel && (
            <Text style={{ position: "absolute", left: xOf(t.pos) - 15, top: yearsTop, width: 30, textAlign: "center", fontSize: TYPE.caption, color: COLORS.faint }}>
              {String(t.year)}
            </Text>
          )}
        </View>
      ))}
      {placed.map((pl) => pl.labeled && (
        <View key={`stem-${pl.claim.claimId}`} style={{ position: "absolute", left: pl.x - 0.4, top: pl.stemTop, width: 0.8, height: pl.stemHeight, backgroundColor: COLORS.rule }} />
      ))}
      {placed.map((pl) => pl.claim.probableWith.length > 0 && (
        <View
          key={`ring-${pl.claim.claimId}`}
          style={{
            position: "absolute",
            left: pl.x - TL_DOT / 2 - 3,
            top: axisY - TL_DOT / 2 - 3,
            width: TL_DOT + 6,
            height: TL_DOT + 6,
            borderRadius: (TL_DOT + 6) / 2,
            borderWidth: 1,
            borderColor: COLORS.cautionText,
          }}
        />
      ))}
      {placed.map((pl) => (
        <View
          key={`dot-${pl.claim.claimId}`}
          style={{
            position: "absolute",
            left: pl.x - TL_DOT / 2,
            top: axisY - TL_DOT / 2,
            width: TL_DOT,
            height: TL_DOT,
            borderRadius: TL_DOT / 2,
            backgroundColor: pl.claim.isTotalLoss ? COLORS.riskText : COLORS.cautionText,
            borderWidth: 1.5,
            borderColor: COLORS.white,
          }}
        />
      ))}
      {placed.map((pl) => pl.labeled && (
        <View
          key={`label-${pl.claim.claimId}`}
          style={{
            position: "absolute",
            left: pl.labelLeft,
            top: pl.labelTop,
            width: TL_LABEL_W,
            height: TL_ROW_H,
            alignItems: "center",
            justifyContent: pl.above ? "flex-end" : "flex-start",
            backgroundColor: COLORS.white,
          }}
        >
          <Text style={{ fontSize: 7, fontWeight: "bold", color: COLORS.ink }}>
            {`#${pl.claim.index}  ${pl.claim.accidentDate || pl.claim.claimDate}`}
            {!pl.claim.accidentDate && pl.claim.claimDate ? (
              <Text style={{ fontSize: TYPE.caption, fontWeight: "normal", color: COLORS.muted }}>{" (zgłoszenie)"}</Text>
            ) : null}
            {pl.claim.probableWith.length > 0 ? " ≈" : ""}
          </Text>
          {typeof pl.claim.damageValue === "number" && pl.claim.damageValue > 0 ? (
            pl.claim.currency === "PLN" ? (
              <>
                <Text style={{ fontSize: 7, color: COLORS.ink2 }}>{formatDamageGrossRange(pl.claim.damageValue)}</Text>
                <Text style={{ fontSize: 6, color: COLORS.muted }}>brutto, szacunek</Text>
              </>
            ) : (
              <>
                <Text style={{ fontSize: 7, color: COLORS.ink2 }}>{`${formatAmount(pl.claim.damageValue)} ${pl.claim.currency}`}</Text>
                <Text style={{ fontSize: 6, color: COLORS.muted }}>netto (bez VAT)</Text>
              </>
            )
          ) : (
            <Text style={{ fontSize: 7, color: COLORS.muted }}>Brak kwoty</Text>
          )}
        </View>
      ))}
    </View>
    {hasUnlabeled && (
      <Text style={[styles.caption, { marginBottom: 8 }]}>
        Część zdarzeń leży zbyt blisko siebie, aby opisać je na osi czasu. Pełna lista znajduje się w tabeli poniżej.
      </Text>
    )}
    </View>
  );
}

const DEDUP_DISCLAIMER =
  "Wyceny tej samej szkody scalamy automatycznie, gdy zgadzają się data zdarzenia i zakres uszkodzeń; przy częściowej zgodności oznaczamy wpisy jako prawdopodobnie tę samą szkodę.";

const OV_COLS = { idx: "7%", date: "19%", mandate: "28%", value: "24%", type: "22%" } as const;

function renderClaimsOverviewTable(claims: ReportPdfClaimItem[]) {
  return (
    <View style={styles.table}>
      <View style={styles.tableHeader} wrap={false}>
        <Text style={[styles.tableHeaderText, { width: OV_COLS.idx, paddingLeft: 4 }]}>#</Text>
        <Text style={[styles.tableHeaderText, { width: OV_COLS.date }]}>Data zdarzenia</Text>
        <Text style={[styles.tableHeaderText, { width: OV_COLS.mandate }]}>Kwalifikacja</Text>
        <Text style={[styles.tableHeaderText, { width: OV_COLS.value }]}>Wartość</Text>
        <Text style={[styles.tableHeaderText, { width: OV_COLS.type }]}>Uwagi</Text>
      </View>
      {claims.map((c) => (
        <View key={`ov-${c.claimId}`} style={styles.tableRow} wrap={false}>
          <Text style={{ width: OV_COLS.idx, paddingLeft: 4, fontWeight: "bold", color: COLORS.ink }}>{String(c.index)}</Text>
          <View style={{ width: OV_COLS.date }}>
            <Text style={{ color: COLORS.ink }}>{c.accidentDate || c.claimDate || "Brak danych"}</Text>
            {!c.accidentDate && c.claimDate && (
              <Text style={{ fontSize: TYPE.caption, color: COLORS.muted }}>(zgłoszenie)</Text>
            )}
          </View>
          <View style={{ width: OV_COLS.mandate }}>
            <Text>{formatMandateDescription(c.mandateDescription)}</Text>
            {c.dedupKind === "MERGED" && (
              <Text style={{ fontSize: TYPE.caption, color: COLORS.muted }}>
                {`najnowsza z ${c.earlierAssessments.length + 1} wycen`}
              </Text>
            )}
          </View>
          <View style={{ width: OV_COLS.value }}>
            <DamageAmount value={c.damageValue} currency={c.currency} shortCaption />
          </View>
          <View style={{ width: OV_COLS.type }}>
            {c.isTotalLoss && (
              <View style={{ flexDirection: "row" }}>
                <Badge tone="risk">Szkoda całkowita</Badge>
              </View>
            )}
            {c.probableWith.length > 0 && (
              <View style={{ flexDirection: "row", marginTop: c.isTotalLoss ? 3 : 0 }}>
                <Badge tone="caution">Prawdopodobnie ta sama szkoda</Badge>
              </View>
            )}
            {!c.isTotalLoss && c.probableWith.length === 0 && <Text style={{ color: COLORS.muted }}>—</Text>}
          </View>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export function ReportPdfDocument({ model }: { model: ReportPdfViewModel }): React.ReactElement<any> {
  const isValuationFailed = model.valuationStatus === "FAILED" || model.valuationStatus === "NIEWYKONANO";
  const sortedStd = sortEquipmentAlphabetically(model.standardEquipment || []);
  const sortedOpt = sortEquipmentAlphabetically(model.optionalEquipment || []);
  const stdRows = chunkEquipmentForRows(sortedStd, 3);
  const optRows = chunkEquipmentForRows(sortedOpt, 3);

  const showClaimsHistorySection =
    model.claimCheckStatus !== "NOT_REQUESTED" && model.claimCheckStatus !== "NIEWYKONANO";
  const hasValuation = model.marketPriceCob !== undefined;

  const nums = numberSections(["valuation", "claims", "spec", "optional", "standard", "equipmentFailed"], {
    valuation: hasValuation,
    claims: showClaimsHistorySection,
    spec: !!model.technicalSpec,
    optional: !isValuationFailed,
    standard: !isValuationFailed,
    equipmentFailed: isValuationFailed,
  });

  // Without a make the title is generic; the VIN line below the title is then the only VIN occurrence.
  const vehicleTitle = [model.make, model.model, model.variant].filter(Boolean).join(" ") || "Pojazd o numerze VIN";

  const claimsKpi = buildClaimsKpi({
    claimsHistoryPresentation: model.claimsHistoryPresentation,
    claimCheckStatus: model.claimCheckStatus,
    claims: model.claims,
    dedup: model.dedup,
  });
  const completenessKpi = buildCompletenessKpi(model.status);
  const moduleDots = buildModuleDots({
    valuationStatus: model.valuationStatus,
    claimCheckStatus: model.claimCheckStatus,
    claimDetailsStatus: model.claimDetailsStatus,
  });
  const summary = buildFactualSummary({
    claimsHistoryPresentation: model.claimsHistoryPresentation,
    claims: model.claims,
    dedup: model.dedup,
  });
  const marketPct = marketToNewPct(model.marketPriceCob, model.newPriceCv);

  const spec = model.technicalSpec;
  const specItems = spec
    ? [
        {
          label: "Pojemność silnika",
          value: spec.engineCapacityCm3 ? `${spec.engineCapacityCm3.toLocaleString("pl-PL")} cm³` : "—",
        },
        {
          label: "Moc silnika",
          value:
            spec.enginePowerKw && spec.enginePowerHp
              ? `${spec.enginePowerKw} kW (${spec.enginePowerHp} KM${spec.isEnginePowerHpCalculated ? " — przeliczone" : ""})`
              : spec.enginePowerKw
                ? `${spec.enginePowerKw} kW`
                : spec.enginePowerHp
                  ? `${spec.enginePowerHp} KM`
                  : "—",
        },
        { label: "Paliwo / napęd", value: [spec.fuelType, spec.driveType].filter(Boolean).join(" / ") || "—" },
        {
          label: "Skrzynia biegów",
          value: spec.gearboxType ? `${spec.gearboxType}${spec.gearCount ? ` (${spec.gearCount}b)` : ""}` : "—",
        },
        {
          label: "Nadwozie / miejsca",
          value:
            [formatBodyType(spec.bodyType), spec.seatsCount ? `${spec.seatsCount} miejsc` : undefined].filter(Boolean).join(" / ") ||
            "—",
        },
        {
          label: "Masa własna / DMC",
          value: spec.curbWeightKg ? `${spec.curbWeightKg} kg / ${spec.grossWeightKg || "—"} kg` : "—",
        },
        {
          label: "Wymiary (dł. / szer. / wys.)",
          value: spec.lengthMm ? `${spec.lengthMm} x ${spec.widthMm} x ${spec.heightMm} mm` : "—",
        },
        { label: "Koła / emisja", value: [spec.wheelSize, spec.emissionStandard].filter(Boolean).join(" / ") || "—" },
      ]
    : [];
  const rawAttrs = filterRawAttributes(spec?.rawAttributes).map(([label, value]) => ({ label, value }));

  const disclaimer = (
    <View style={styles.disclaimerBox} wrap={false}>
      <Text style={[styles.disclaimerText, { marginBottom: 2 }]}>
        1. Niniejszy raport ma charakter analityczno-informacyjny i został sporządzony na podstawie danych dostarczonych przez system Audatex (AudaValuation oraz Claims History Engine). Dokument nie stanowi urzędowej opinii biegłego rzeczoznawcy majątkowego ani gwarancji bezwypadkowości pojazdu.
      </Text>
      <Text style={[styles.disclaimerText, { marginBottom: 2 }]}>
        2. Wartości wyceny pojazdu są wartościami netto (bez VAT) według Audatex. Wartości szkód prezentujemy jako szacunkowy przedział brutto wyliczony z kwoty netto Audatex powiększonej o 23% VAT.
      </Text>
      <Text style={styles.disclaimerText}>
        3. Zastrzeżenie prawne (wersja robocza): Zakres odpowiedzialności wystawcy wobec nabywcy raportu (w szczególności konsumenta) podlega ostatecznej regulacji w regulaminie usługi zgodnie z prawem właściwym.
      </Text>
    </View>
  );

  return (
    <Document title={`Raport IzzyCheck ${model.publicReference || model.vin}`} author="IzzyCheck System">
      {/* PAGE 1: Vehicle & Report Summary */}
      <Page size="A4" style={styles.page}>
        <PdfHeader model={model} />

        {/* Vehicle band */}
        <View style={styles.band}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={styles.vehicleTitle}>{vehicleTitle}</Text>
            <Text style={styles.vinText}>{model.vin}</Text>
            <View style={styles.chipsRow}>
              {model.firstRegistrationDate ? (
                <Chip>{`1. rejestracja ${model.firstRegistrationDate}`}</Chip>
              ) : null}
              <Chip>{model.mileage ? `${formatAmount(model.mileage)} km` : "Przebieg średni rynkowy"}</Chip>
              {model.ibsCode ? <Chip>{`IBS ${model.ibsCode}`}</Chip> : null}
            </View>
          </View>
        </View>

        {/* KPI row */}
        <View style={styles.kpiRow}>
          <View style={{ flex: 1, marginRight: 8, flexDirection: "row" }}>
            <Tile label="Wartość rynkowa" tone="neutral">
              <View style={styles.tileValueBox}>
                {hasValuation ? (
                  <Text style={{ fontSize: TYPE.display, fontWeight: "bold", color: COLORS.brandNavy }}>
                    {formatAmount(model.marketPriceCob as number)}
                  </Text>
                ) : (
                  <Text style={[styles.tileValue, { color: COLORS.muted }]}>Brak wyceny</Text>
                )}
              </View>
              {hasValuation ? <Text style={styles.tileSub}>{NET_LABEL}</Text> : null}
            </Tile>
          </View>
          <View style={{ flex: 1, marginRight: 8, flexDirection: "row" }}>
            <KpiTile label="Historia szkód" kpi={claimsKpi} />
          </View>
          <View style={{ flex: 1, flexDirection: "row" }}>
            <Tile label="Kompletność danych" tone={completenessKpi.tone}>
              <View style={styles.tileValueBox}>
                <Text style={[styles.tileValue, { color: TONES[completenessKpi.tone].text }]}>{completenessKpi.value}</Text>
              </View>
              {moduleDots.map((d) => (
                <View key={d.label} style={styles.dotRow}>
                  <View style={[styles.dot, { backgroundColor: TONES[d.tone].text }]} />
                  <Text style={styles.dotText}>{d.label}</Text>
                </View>
              ))}
            </Tile>
          </View>
        </View>

        {/* Factual summary */}
        {summary ? <Text style={styles.summaryLine}>{summary}</Text> : null}

        {model.status === "PARTIALLY_FAILED" && (
          <Notice tone="risk" title="UWAGA: DOKUMENT ZATWIERDZONY JAKO NIEPEŁNY (STAN AS-IS)">
            Raport zawiera niekompletne dane z powodu błędów w modułach źródłowych Audatex:
            {model.valuationStatus === "FAILED" && " • Brak wyceny i specyfikacji technicznej"}
            {model.claimCheckStatus === "FAILED" && " • Brak kontroli historii szkód"}
            {model.claimDetailsStatus === "FAILED" && " • Brak szczegółów historii szkód"}
          </Notice>
        )}

        {/* Valuation */}
        {hasValuation && (
          <>
            <SectionTitle number={nums.valuation}>Podsumowanie wyceny pojazdu</SectionTitle>
            <View style={styles.valuationRow} wrap={false}>
              <View style={styles.valuationCell}>
                <Text style={styles.label}>Cena nowego pojazdu (CV)</Text>
                <Text style={styles.valuationValue}>
                  {model.newPriceCv !== undefined ? formatAmount(model.newPriceCv) : "—"}
                </Text>
                <Text style={styles.caption}>{NET_LABEL}</Text>
              </View>
              <View style={styles.valuationCell}>
                <Text style={styles.label}>Wartość rynkowa (COB)</Text>
                <Text style={[styles.valuationValue, { color: COLORS.brandNavy }]}>
                  {formatAmount(model.marketPriceCob as number)}
                </Text>
                <Text style={styles.caption}>{NET_LABEL}</Text>
              </View>
              <View style={styles.valuationCell}>
                <Text style={styles.label}>Wartość techniczna (TH)</Text>
                <Text style={styles.valuationValue}>
                  {model.technicalValueTh !== undefined ? formatAmount(model.technicalValueTh) : "—"}
                </Text>
                <Text style={styles.caption}>{NET_LABEL}</Text>
              </View>
            </View>
            {marketPct !== undefined && (
              <View wrap={false}>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${Math.min(100, Math.max(0, marketPct))}%` }]} />
                </View>
                <Text style={[styles.caption, { marginTop: 3 }]}>{`Wartość rynkowa = ${marketPct}% ceny nowego`}</Text>
              </View>
            )}
          </>
        )}

        {/* Claims overview */}
        {showClaimsHistorySection && (
          <>
            <SectionTitle number={nums.claims}>Historia szkód</SectionTitle>
            {model.claimsHistoryPresentation === "CLAIM_DETAILS_AVAILABLE" && (
              <>
                {renderClaimsTimeline(model)}
                {renderClaimsOverviewTable(model.claims)}
                <Text style={[styles.caption, { marginTop: 4 }]}>
                  Szczegóły każdej szkody (mapa uszkodzeń, strefy i grupy części) na kolejnych stronach.
                </Text>
                {(model.dedup.hasMerged || model.dedup.likelyEventsCount < model.dedup.entriesCount) && (
                  <Text style={[styles.caption, { marginTop: 2 }]}>{DEDUP_DISCLAIMER}</Text>
                )}
              </>
            )}
            {model.claimsHistoryPresentation === "HISTORY_DETECTED_DETAILS_NOT_REQUESTED" && (
              <Notice tone="caution">
                Wykryto wpisy historii szkód w bazie Audatex. Szczegóły zdarzeń nie były objęte zamówieniem.
              </Notice>
            )}
            {model.claimsHistoryPresentation === "HISTORY_DETECTED_DETAILS_UNAVAILABLE" && (
              <Notice tone="caution">
                Wykryto wpisy historii szkód w bazie Audatex. Szczegóły zdarzeń nie są dostępne w tym raporcie.
              </Notice>
            )}
            {model.claimsHistoryPresentation === "NO_HISTORY" && (
              <Notice tone="ok">Brak zarejestrowanych szkód w bazie Audatex Claims History Engine.</Notice>
            )}
            {model.claimsHistoryPresentation === "UNAVAILABLE" && (
              <Notice tone="risk">Kontrola historii szkód nie została wykonana poprawnie.</Notice>
            )}
          </>
        )}

        {/* Technical specification */}
        {spec && (
          <>
            <SectionTitle number={nums.spec}>Specyfikacja techniczna pojazdu</SectionTitle>
            <KvGrid items={specItems} />
            {rawAttrs.length > 0 && (
              <View style={{ marginTop: 8 }} wrap={false}>
                <Text style={[styles.label, { marginBottom: 3 }]}>Pozostałe parametry</Text>
                <KvGrid items={rawAttrs} rawLabels />
              </View>
            )}
          </>
        )}

        {/* Equipment: one failed notice when valuation did not run, otherwise optional first, then standard */}
        {isValuationFailed ? (
          <>
            <SectionTitle number={nums.equipmentFailed}>Wyposażenie</SectionTitle>
            <Notice tone="risk">Moduł wyceny nie został wykonany</Notice>
          </>
        ) : (
          <>
            <SectionTitle number={nums.optional} chip={sortedOpt.length > 0 ? itemCountLabel(sortedOpt.length) : undefined}>
              Wyposażenie dodatkowe i pakiety
            </SectionTitle>
            {sortedOpt.length === 0 ? (
              <Notice tone="neutral">Brak zarejestrowanego wyposażenia opcjonalnego w Audatex</Notice>
            ) : (
              renderEquipmentGrid(optRows, "opt")
            )}

            <SectionTitle number={nums.standard} chip={sortedStd.length > 0 ? itemCountLabel(sortedStd.length) : undefined}>
              Wyposażenie standardowe
            </SectionTitle>
            {sortedStd.length === 0 ? (
              <Notice tone="neutral">Audatex nie zwrócił pozycji wyposażenia</Notice>
            ) : (
              renderEquipmentGrid(stdRows, "std")
            )}
          </>
        )}

        {!model.hasClaims && disclaimer}

        <PdfFooter />
      </Page>

      {/* PAGE 2+: Damage Claims & Visualizations (one page per claim) */}
      {model.hasClaims &&
        model.claims.map((claim, claimIdx) => (
          <ClaimPage
            key={claim.claimId}
            model={model}
            claim={claim}
            total={model.claims.length}
            disclaimer={claimIdx === model.claims.length - 1 ? disclaimer : null}
          />
        ))}
    </Document>
  );
}

// ---------------------------------------------------------------------------
// Header / footer (fixed on every page, including overflow pages)
// ---------------------------------------------------------------------------

function PdfHeader({ model }: { model: ReportPdfViewModel }) {
  const refText = model.publicReference || `ID: #${model.reportId.substring(0, 8)}`;
  return (
    <View style={styles.header} fixed>
      <View>
        <Text style={styles.logoText}>IzzyCheck</Text>
        <Text style={styles.logoSub}>Raport historii i wyceny pojazdu</Text>
      </View>
      <View style={styles.headerMeta}>
        <Text style={styles.headerMetaText}>{`Nr ref: ${refText}`}</Text>
        <Text style={styles.headerVin}>{`VIN: ${model.vin}`}</Text>
        <Text style={styles.headerMetaText}>{`Data zapytania: ${model.createdAtFormatted}`}</Text>
      </View>
    </View>
  );
}

function PdfFooter() {
  const generatedAt = formatDateTimeWarsaw(new Date());
  return (
    <View style={styles.footer} fixed>
      <Text>
        {`${ISSUER_CONFIG.companyName} | NIP: ${ISSUER_CONFIG.taxId} | Wygenerowano: ${generatedAt} | Wersja generatora: v${pkg.version || "0.1.0"}`}
      </Text>
      <Text render={({ pageNumber, totalPages }) => `Strona ${pageNumber} z ${totalPages}`} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Claim page
// ---------------------------------------------------------------------------

function ClaimPage({
  model,
  claim,
  total,
  disclaimer,
}: {
  model: ReportPdfViewModel;
  claim: ReportPdfClaimItem;
  total: number;
  disclaimer: React.ReactNode;
}) {
  const { zoneList, groupChips, legendCategories } = claim.presentation;
  const zoneRowCount = Math.ceil(zoneList.length / 2);
  // two columns, column-major: row i holds zone i (left) and zone i + zoneRowCount (right)
  const renderZoneRow = (i: number) => (
    <View key={`zrow-${i}`} style={styles.zoneRow} wrap={false}>
      {[zoneList[i], zoneList[i + zoneRowCount]].map((m, col) => (
        <View key={`zcell-${i}-${col}`} style={styles.zoneCell}>
          {m && (
            <>
              <View style={[styles.listDot, { backgroundColor: m.colorHex }]} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: TYPE.body, color: COLORS.ink }}>{m.titlePl}</Text>
                {m.hintPl && <Text style={{ fontSize: TYPE.caption, color: COLORS.muted }}>{m.hintPl}</Text>}
              </View>
            </>
          )}
        </View>
      ))}
    </View>
  );
  const date = claim.accidentDate || claim.claimDate;
  const dateLabel = !claim.accidentDate && claim.claimDate ? "Data zgłoszenia" : "Data zdarzenia";

  return (
    <Page size="A4" style={styles.page}>
      <PdfHeader model={model} />

      {/* Claim header */}
      <View style={styles.sectionTitleWrap} wrap={false}>
        <View style={styles.sectionBar} />
        <Text style={styles.sectionTitleText}>{`Szkoda ${claim.index} z ${total}`}</Text>
        {claim.isTotalLoss && <Badge tone="risk">Szkoda całkowita</Badge>}
        {claim.probableWith.length > 0 && <Badge tone="caution">Prawdopodobnie ta sama szkoda</Badge>}
      </View>
      {claim.dedupKind === "MERGED" && (
        <Text style={[styles.caption, { marginTop: -4, marginBottom: 6 }]}>
          {`Najnowsza z ${claim.earlierAssessments.length + 1} wycen tej szkody`}
        </Text>
      )}
      {claim.probableWith.length > 0 && (
        <Text style={[styles.caption, { marginTop: -4, marginBottom: 6 }]}>
          {`Zbliżony zakres uszkodzeń i termin jak ${claim.probableWith.length === 1 ? "szkoda" : "szkody"} ${claim.probableWith.join(", ")}. Audatex nie podaje wspólnego identyfikatora zdarzenia.`}
        </Text>
      )}
      <View
        style={{
          backgroundColor: COLORS.surface,
          borderWidth: 0.75,
          borderColor: COLORS.rule,
          borderRadius: 4,
          padding: 10,
          marginBottom: 12,
        }}
        wrap={false}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
          <View>
            <Text style={styles.label}>{dateLabel}</Text>
            <Text style={{ fontSize: TYPE.title, fontWeight: "bold", color: COLORS.ink }}>{date || "Brak danych"}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.label}>Wartość szkody</Text>
            <DamageAmount value={claim.damageValue} currency={claim.currency} size={TYPE.title} align="flex-end" />
          </View>
        </View>
        <View style={{ flexDirection: "row", marginTop: 8 }}>
          <View style={{ width: "16%", paddingRight: 6 }}>
            <Text style={styles.label}>Kraj zgłoszenia</Text>
            <Text style={styles.value}>{formatCountry(claim.country)}</Text>
          </View>
          <View style={{ width: "19%", paddingRight: 6 }}>
            <Text style={styles.label}>Stan drogomierza</Text>
            <Text style={styles.value}>{claim.mileage ? `${formatAmount(claim.mileage)} km` : "Brak danych"}</Text>
          </View>
          <View style={{ width: "24%", paddingRight: 6 }}>
            <Text style={styles.label}>Kod mandatu Audatex</Text>
            <Text style={styles.value}>{claim.mandateCode || "—"}</Text>
          </View>
          <View style={{ width: "41%" }}>
            <Text style={styles.label}>Kwalifikacja zdarzenia</Text>
            <Text style={styles.value}>{formatMandateDescription(claim.mandateDescription)}</Text>
          </View>
        </View>
        <Text style={[styles.caption, { marginTop: 6 }]}>{`Identyfikator szkody: ${claim.claimId}`}</Text>
      </View>

      {/* Legend: only categories present in this claim */}
      {legendCategories.length > 0 && (
        <View style={[styles.legendRow, claim.presentation.flagsText ? { marginBottom: 3 } : {}]} wrap={false}>
          {legendCategories.map((cat) => (
            <View key={cat} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: CATEGORY_DEFINITIONS[cat].colorHex }]} />
              <Text style={styles.legendText}>{CATEGORY_DEFINITIONS[cat].labelPl}</Text>
            </View>
          ))}
        </View>
      )}

      {claim.presentation.flagsText && (
        <Text style={[styles.caption, { marginBottom: 8 }]} wrap={false}>
          {claim.presentation.flagsText}
        </Text>
      )}

      {/* Part groups from the calculation, as chips (no codes) */}
      {groupChips.length > 0 && (
        <View style={{ marginBottom: 10 }} wrap={false}>
          <Text style={[styles.label, { marginBottom: 4 }]}>Zakres naprawy (grupy części w kalkulacji Audatex)</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {groupChips.map((m) => (
              <View key={`chip-${m.id}`} style={styles.groupChip}>
                <View style={[styles.listDot, { backgroundColor: m.colorHex, marginRight: 4 }]} />
                <Text style={{ fontSize: TYPE.body, color: COLORS.ink2 }}>{m.titlePl}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Damage maps */}
      <Text style={{ fontSize: TYPE.h2, fontWeight: "bold", color: COLORS.ink, marginBottom: 6 }}>
        Mapa szkody według Audatex
      </Text>
      <View style={styles.mapRow} wrap={false}>
        <View style={styles.mapBox}>
          <Text style={styles.mapTitle}>{PHOTO_1_CAPTION}</Text>
          <PdfVehicleView claim={claim} view="front" />
        </View>
        <View style={styles.mapBox}>
          <Text style={styles.mapTitle}>{PHOTO_2_CAPTION}</Text>
          <PdfVehicleView claim={claim} view="rear" />
        </View>
      </View>

      {(claim.presentation.hasUnderbodyView || claim.presentation.hasOffPhotoMarkers) && (
        <View style={{ marginBottom: 10 }} wrap={false}>
          <Text style={{ fontSize: TYPE.h2, fontWeight: "bold", color: COLORS.ink, marginBottom: 4 }}>
            {claim.presentation.hasUnderbodyView ? "Podwozie (widok od spodu)" : "Strefy poza zdjęciami"}
          </Text>
          <View style={[styles.mapRow, { marginBottom: 0 }]}>
            {claim.presentation.hasUnderbodyView && (
              <View style={styles.mapBox}>
                <PdfUnderbodyView claimItem={claim} />
                <Text style={[styles.caption, { marginTop: 2 }]}>Przód pojazdu z lewej strony</Text>
              </View>
            )}
            {claim.presentation.hasOffPhotoMarkers && (
            <View style={{ width: MAP_BOX_W, paddingLeft: claim.presentation.hasUnderbodyView ? 4 : 0 }}>
              {claim.presentation.hasUnderbodyView && (
                <Text style={{ fontSize: TYPE.h2, fontWeight: "bold", color: COLORS.ink, marginBottom: 6 }}>
                  Poza zdjęciami
                </Text>
              )}
              {offPhotoMarkers(claim).map((m) => (
                <View key={`ubl-${m.id}`} style={{ flexDirection: "row", alignItems: "flex-start", marginBottom: 4 }}>
                  <View style={[styles.listDot, { backgroundColor: m.colorHex, marginRight: 6, marginTop: 0 }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: TYPE.body, color: COLORS.ink2 }}>{m.titlePl}</Text>
                    {m.hintPl && <Text style={{ fontSize: TYPE.caption, color: COLORS.muted }}>{m.hintPl}</Text>}
                  </View>
                </View>
              ))}
            </View>
            )}
          </View>
        </View>
      )}

      {claim.earlierAssessments.length > 0 && (
        <View style={{ marginBottom: 10 }} wrap={false}>
          <Text style={{ fontSize: TYPE.h2, fontWeight: "bold", color: COLORS.ink, marginBottom: 4 }}>
            Wcześniejsze wyceny tej szkody
          </Text>
          {claim.earlierAssessments.map((e) => (
            <View key={`earlier-${e.claimId}`} style={[styles.tableRow, { paddingLeft: 4 }]} wrap={false}>
              <View style={{ width: "22%" }}>
                <Text style={{ color: COLORS.ink }}>{e.claimDate || e.accidentDate || "Brak danych"}</Text>
                <Text style={{ fontSize: TYPE.caption, color: COLORS.muted }}>zgłoszenie</Text>
              </View>
              <View style={{ width: "18%" }}>
                <DamageAmount value={e.damageValue} currency={e.currency} shortCaption />
              </View>
              <View style={{ width: "22%", flexDirection: "row" }}>
                {e.isTotalLoss && <Badge tone="risk">Szkoda całkowita</Badge>}
              </View>
              <Text style={{ width: "38%", fontSize: TYPE.caption, color: COLORS.muted }}>{e.claimId}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Zone list: dot in the category colour + plain-language description */}
      {zoneList.length > 0 && (
        <Text style={{ fontSize: TYPE.h2, fontWeight: "bold", color: COLORS.ink, marginBottom: 4 }} minPresenceAhead={60}>
          Strefy uszkodzeń
        </Text>
      )}
      {Array.from({ length: Math.max(0, zoneRowCount - 1) }, (_, i) => renderZoneRow(i))}

      {/* Tail kept together: the last zone row, the zone-00 caption and the disclaimer never end up alone on a page */}
      <View wrap={false}>
        {zoneRowCount > 0 && renderZoneRow(zoneRowCount - 1)}
        {claim.presentation.hasUndefinedZone && (
          <Text style={[styles.caption, { color: COLORS.muted, marginTop: 4 }]}>
            Audatex wskazał także elementy bez przypisanej strefy.
          </Text>
        )}
        {disclaimer}
      </View>

      <PdfFooter />
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Damage map views
// ---------------------------------------------------------------------------

function MarkerCircle({ x, y, marker }: { x: number; y: number; marker: ProcessedMarkerItem }) {
  return <Circle cx={x} cy={y} r={MARKER_R} fill={marker.colorHex} stroke={COLORS.white} strokeWidth={2.4} />;
}

function PdfVehicleView({ claim, view }: { claim: ReportPdfClaimItem; view: "front" | "rear" }) {
  const anchorOf = (m: ProcessedMarkerItem): Point | undefined => (view === "front" ? m.rf3qAnchor : m.lr3qAnchor);
  const markers = claim.presentation.markers.filter((m) => anchorOf(m));
  const template = claim.presentation.template;
  const jpgFileName =
    (view === "front" ? template.assetFrontPdfJpg : template.assetBackPdfJpg) ||
    (view === "front" ? "sedan-rf3q.jpg" : "sedan-lr3q.jpg");
  const imagePath = path.join(process.cwd(), "public", "vehicles", "pdf", jpgFileName);
  const hasImage = fs.existsSync(imagePath);

  if (!hasImage) {
    console.warn(`[PDF Engine] Warning: Vehicle image background not found at ${imagePath}. Falling back to vector schema.`);
  }

  const points = nudgeMarkers(
    markers.map((m) => anchorOf(m) as Point),
    { radius: MARKER_R, width: VIEWBOX_W, height: VIEWBOX_H }
  );

  return (
    <View style={{ width: MAP_INNER_W, height: MAP_INNER_H, position: "relative", backgroundColor: COLORS.white }}>
      {hasImage ? (
        <Image
          src={imagePath}
          style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "contain" }}
        />
      ) : (
        <Svg viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`} style={{ width: "100%", height: "100%" }}>
          <Path
            d={
              view === "front"
                ? "M 60 120 L 90 90 L 140 55 L 210 50 L 260 70 L 300 95 L 340 115 L 370 135 L 360 155 L 320 165 L 140 165 L 80 155 Z"
                : "M 50 135 L 70 115 L 115 85 L 160 55 L 220 50 L 270 70 L 330 95 L 350 120 L 330 155 L 260 165 L 90 165 Z"
            }
            fill="#cbd5e1"
            stroke="#475569"
            strokeWidth="2"
          />
          <Circle cx={view === "front" ? "330" : "110"} cy="155" r="14" fill="#334155" />
          <Circle cx={view === "front" ? "140" : "290"} cy="155" r="13" fill="#334155" />
        </Svg>
      )}

      {/* Svg layer with marker circles and numbers overlay */}
      <Svg
        viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
        style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
      >
        {markers.map((m, i) => (
          <MarkerCircle key={`pdf-${view}-${m.id}`} x={points[i].x} y={points[i].y} marker={m} />
        ))}
      </Svg>
    </View>
  );
}

function underbodyMarkers(claim: ReportPdfClaimItem): ProcessedMarkerItem[] {
  return claim.presentation.markers.filter((m) => m.underbodyAnchor || m.primaryCategory === "UNDERBODY");
}

/** Zones without a photo (interior); underbody zones are drawn on the underbody photo and not listed here. */
function offPhotoMarkers(claim: ReportPdfClaimItem): ProcessedMarkerItem[] {
  return claim.presentation.markers.filter((m) => m.view === "off-photo");
}

function PdfUnderbodyView({ claimItem }: { claimItem: ReportPdfClaimItem }) {
  const ubMarkers = underbodyMarkers(claimItem);
  const imagePath = path.join(process.cwd(), "public", "vehicles", "pdf", UNDERBODY_IMAGE_PDF_JPG);
  const hasImage = fs.existsSync(imagePath);

  if (!hasImage) {
    console.warn(`[PDF Engine] Warning: Underbody image not found at ${imagePath}. Rendering markers on a plain background.`);
  }

  // Markers without an anchor are distributed along a row instead of stacking at the centre.
  const anchored = ubMarkers.filter((m) => m.underbodyAnchor);
  const unanchored = ubMarkers.filter((m) => !m.underbodyAnchor);
  const initial: Point[] = [
    ...anchored.map((m) => m.underbodyAnchor as Point),
    ...distributeRow(unanchored.length, UNDERBODY_VIEWBOX_H * 0.8, 130, 270),
  ];
  const points = nudgeMarkers(initial, { radius: MARKER_R, width: UNDERBODY_VIEWBOX_W, height: UNDERBODY_VIEWBOX_H });
  const ordered = [...anchored, ...unanchored];

  return (
    <View style={{ width: MAP_INNER_W, height: UB_INNER_H, position: "relative", backgroundColor: COLORS.surface }}>
      {hasImage && (
        <Image
          src={imagePath}
          style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "contain" }}
        />
      )}
      <Svg
        viewBox={`0 0 ${UNDERBODY_VIEWBOX_W} ${UNDERBODY_VIEWBOX_H}`}
        style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
      >
        {ordered.map((m, i) => (
          <MarkerCircle key={`pdfub-${m.id}`} x={points[i].x} y={points[i].y} marker={m} />
        ))}
      </Svg>
    </View>
  );
}
