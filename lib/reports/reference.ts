import { randomBytes } from "crypto";

/**
 * Generates human-readable external reference for IzzyCheck reports.
 * Format: IC-YYYY-MM-XXXX (e.g. IC-2026-08-0417)
 */
export function generatePublicReference(date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `IC-${yyyy}-${mm}-${randomSuffix}`;
}
