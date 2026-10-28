/** Days a proforma stays payable, counted in calendar days from its issue date. */
export const PROFORMA_VALIDITY_DAYS = 14;

const warsawDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Warsaw",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** YYYY-MM-DD of the given instant in Europe/Warsaw. */
export function warsawDate(date: Date): string {
  const parts = Object.fromEntries(warsawDay.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const YMD_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written as YYYY-MM-DD (rejects 2026-02-30 and the like). */
export function isValidYmd(ymd: string): boolean {
  const match = YMD_PATTERN.exec(ymd);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Calendar arithmetic on a YYYY-MM-DD string, done in UTC so no time zone or DST can shift the day. */
export function addDaysToDate(ymd: string, days: number): string {
  if (!isValidYmd(ymd)) throw new Error(`Nieprawidłowa data: ${ymd}`);
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Value for a Prisma `@db.Date` column. */
export function ymdToDbDate(ymd: string): Date {
  if (!isValidYmd(ymd)) throw new Error(`Nieprawidłowa data: ${ymd}`);
  return new Date(`${ymd}T00:00:00.000Z`);
}

/** YYYY-MM-DD of a `@db.Date` value (midnight UTC). */
export function dbDateToYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** A pending proforma is expired once the Warsaw calendar day is after its due date (the due day itself is still payable). */
export function isProformaExpired(
  order: { paymentMethod: string; status: string; proformaDueDate: Date | string | null },
  now: Date,
): boolean {
  if (order.paymentMethod !== "PROFORMA" || order.status !== "PENDING_PAYMENT" || !order.proformaDueDate) return false;
  const dueDate = typeof order.proformaDueDate === "string" ? order.proformaDueDate.slice(0, 10) : dbDateToYmd(order.proformaDueDate);
  return warsawDate(now) > dueDate;
}
