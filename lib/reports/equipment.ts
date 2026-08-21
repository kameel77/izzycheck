/**
 * Equipment presentation and alphabetical sorting utilities for IzzyCheck.
 * Uses Polish collation (Intl.Collator) with default 'variant' sensitivity
 * to guarantee strict Polish alphabetical ordering (a < ą < b < c < ć ... L < Ł).
 */

export interface ReportEquipmentItem {
  code: string;
  name: string;
  type?: "Standard" | "Optional";
}

const polishCollator = new Intl.Collator("pl");

/**
 * Sorts equipment items alphabetically by name using the Polish collator.
 */
export function sortEquipmentAlphabetically(
  items: ReportEquipmentItem[]
): ReportEquipmentItem[] {
  if (!Array.isArray(items) || items.length === 0) return [];
  return [...items].sort((a, b) => polishCollator.compare(a.name || "", b.name || ""));
}

/**
 * Chunks a flat list of equipment items into rows of N columns (row-major order).
 * Row-major layout (left-to-right, then next row) allows reliable and safe page-breaking
 * in @react-pdf/renderer without multi-column vertical desynchronisation.
 */
export function chunkEquipmentForRows<T>(items: T[], columns = 3): T[][] {
  if (!Array.isArray(items) || items.length === 0) return [];
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += columns) {
    rows.push(items.slice(i, i + columns));
  }
  return rows;
}
