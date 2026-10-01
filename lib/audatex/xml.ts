/**
 * Escapes a value for safe interpolation into XML text nodes (SOAP envelopes).
 * null/undefined become an empty string; `&` is replaced first to avoid double-escaping.
 */
export function escapeXml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
