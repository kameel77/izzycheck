# IzzyCheck Agent Handoff

## Active implementation specification

Before changing code, read the canonical PRD:

`../docs/PRD-izzycheck-szkody-wizualizacja-pdf-2026-08-06.md`

For the longer research rationale and task-level detail, also read:

`../../.hermes/plans/2026-08-06_134839-izzycheck-szkody-wizualizacja-pdf-prd.md`

Current work: prepaid report credits per organization. Read the credits spec and the implementation plan (alongside the PRD below):

`../../business/product/SPEC-kredyty-platnosci-2026-10-28.md`

`../docs/PLAN-kredyty-faza-1-2026-10-28.md`

For the PRD above, implement **only** its approved scope: Audatex damage normalisation, two SVG damage views, category legend, controlled server-side PDF download and tests.

## Non-negotiable constraints

- Audatex returns zones and significant-part groups, not a confirmed individual damaged component or repair type. Never infer a scratch, dent, replacement or precise part from the returned data.
- Preserve source codes and `damage.general` / `damage.glass` flags in the persisted structured data.
- Always render right-front and left-rear vehicle views; add an underside inset only when underbody is indicated.
- Keep zones, markers and interactions as own or licensed, versioned SVG. The neutral vehicle base render may be a local, licensed AI-generated asset only after commercial-use and quality review; never copy the reference-report illustrations, use a user's reference photo as a production asset or fetch images at runtime. Follow `../docs/PRD-izzycheck-szkody-wizualizacja-pdf-2026-08-06.md`.
- PDF must be generated server-side with the same report RBAC as the existing report API. Do not substitute `window.print()` for PDF export.
- Do not use real VINs or production data in fixtures, screenshots or tests.

## Required verification

Run `npm test`, `npm run test:db` (real Postgres via Docker, needed for credit logic) and `npm run build`; render a fixture PDF to images and visually inspect markers, legend, pagination and Polish diacritics before declaring the task complete.
