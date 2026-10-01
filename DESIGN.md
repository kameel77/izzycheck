# DESIGN.md: IzzyCheck PDF Report

Scope: the sold PDF report rendered with `@react-pdf/renderer` (`lib/pdf/report-pdf-document.tsx`).
The web app UI is out of scope. Units are PDF points (pt); A4 = 595 x 842 pt.

Audience (decision D-1): end customers and credit committees. The document must read as a credible,
factual, print-friendly report. It is not a marketing page.

## 1. Visual Theme & Atmosphere
- "Trusted report": light background, navy ink, one brand blue, hairline rules and a lot of whitespace.
- Facts first. The key answers (what car, what is it worth, has it been damaged, is the data complete)
  are visible within the top third of page 1.
- Status colors are muted and semantic. Red only means risk, never decoration.
- No gradients, no shadows, no rounded corners larger than 4 pt.

## 2. Color Palette & Roles
Defined once as a `COLORS` constant in the PDF module.

| Token | Hex | Role |
|---|---|---|
| ink | #0f172a | primary text, hero numbers |
| ink2 | #334155 | body text |
| muted | #64748b | labels, secondary text |
| faint | #94a3b8 | footer, captions |
| rule | #e2e8f0 | hairlines, card borders |
| surface | #f8fafc | tile and card background |
| surface2 | #f1f5f9 | table header, chips |
| brandNavy | #1e3a8a | wordmark, header rule, hero value |
| brand | #2563eb | accents, bullets, links |
| riskText / riskBg / riskBorder | #b91c1c / #fef2f2 / #fecaca | total loss, failed module |
| cautionText / cautionBg / cautionBorder | #b45309 / #fffbeb / #fde68a | claims present, partial data |
| okText / okBg / okBorder | #15803d / #f0fdf4 / #bbf7d0 | no claims, complete data |

Damage categories keep the existing marker palette (body, glass, mechanical, underbody) and must come
from the same source as `marker.colorHex`. The legend is never hard-coded separately.

## 3. Typography Rules
- Font: registered `ArialCustom` (Arial regular and bold TTF with Polish glyphs). No other fonts for now.
- Scale:
  - Display 20 pt bold: hero value (market price)
  - Title 15 pt bold: vehicle name
  - H1 11 pt bold: section titles
  - H2 9 pt bold: sub-headings, claim headers
  - Body 8.5 pt, line height 1.35
  - Label 6.5 pt uppercase, letterSpacing 0.5, muted
  - Caption 6.5 pt, faint
- The VIN is always shown in bold with letterSpacing 0.8.
- Amounts are integers with Polish grouping (`toLocaleString("pl-PL", { maximumFractionDigits: 0 })`).
  Per D-7 every amount carries an explicit label. Render it as a small muted suffix or second line:
  `PLN netto (bez VAT)`.

## 4. Component Stylings
- **Header** (fixed, every page): left has the wordmark "IzzyCheck" (14 pt bold navy) and the subtitle
  "Raport historii i wyceny pojazdu" (7 pt uppercase muted). Right has Nr ref, VIN and "Data zapytania".
  Below it sits a 1.5 pt navy rule.
- **Footer** (fixed, every page): one 6.5 pt faint line with issuer, NIP,
  "Wygenerowano: <date, Europe/Warsaw>" and generator version; "Strona x z y" on the right.
  Hairline rule above.
- **Section title**: H1 text, 4 pt brand-blue bar on the left, numbered dynamically (1..n by rendered
  order). No grey filled background.
- **KPI tile**: surface background, 0.75 pt rule border, radius 4, padding 10. Label on top, value,
  then a sub-line. A semantic tile (claims, completeness) uses the matching Bg/Border/Text tokens.
- **Badge/chip**: 6.5 pt bold uppercase, padding 2x5, radius 3, semantic colors.
- **Notice box**: semantic Bg/Border, a 3 pt left border in the Text color, 7.5 pt text.
- **Key-value grid**: 4 columns, label above value, hairline between rows. No card border.
- **Table**: surface2 header row (6.5 pt uppercase muted), rows separated by hairlines, rows
  `wrap={false}`. Category rows get a 3 pt colored left bar.
- **Damage marker**: filled circle in the category color with a 1.5 pt white stroke and centered bold
  white number (`textAnchor="middle"`). On-paper radius is at least 8 pt; overlapping markers are nudged
  apart.

## 5. Layout Principles
- Page padding: top 36, sides 36, bottom 60 (content never touches the fixed footer).
- Spacing scale: 4 / 8 / 12 / 16 / 24 pt. 24 between sections, 8 inside cards.
- Content width is 523 pt. Grids use percentage widths with a fixed gutter.
- Page 1 order:
  1. vehicle band
  2. KPI row
  3. factual summary line
  4. valuation
  5. claims overview and timeline
  6. technical spec
  7. equipment (flows onto following pages)
- Claim pages: claim header, legend, damage maps, optional underbody, table.
- The disclaimer goes once, at the end of the document flow, as a neutral (surface) box.

## 6. Depth & Elevation
- Flat. Hierarchy comes from size, weight, color and whitespace only. Borders are hairlines (0.75 pt).

## 7. Do's and Don'ts
- DO show only facts from the data sources. Summary sentences are generated from data and contain no
  judgements ("bezwypadkowy", "polecamy" etc. are forbidden).
- DO keep an explicit net label at every amount (D-7). DO NOT compute VAT or gross values.
- DO NOT invent defaults for missing data (e.g. a country): show "Brak danych".
- DO NOT print technical keys meant for systems (e.g. `marketCode`).
- DO NOT use pure #ff0000 / #0000ff or yellow warning boxes.

## 8. Responsive Behavior (print)
- A4 portrait only. Long lists flow across pages with the fixed header and footer repeated.
- Rows and tiles never split across pages (`wrap={false}`); a section title is kept with its first
  content (`minPresenceAhead`).

## 9. Agent Prompt Guide
"Render with @react-pdf/renderer using the COLORS and type scale from DESIGN.md: light, navy ink #0f172a,
brand #1e3a8a/#2563eb, hairline #e2e8f0 borders, radius ≤4 pt, semantic risk/caution/ok tokens, fixed
header and footer, 36/60 pt page padding, dynamic section numbering, explicit 'PLN netto (bez VAT)'
label on every amount."
