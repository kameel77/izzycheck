/** Granice miesięcy rozliczeniowych liczone w czasie polskim (Europe/Warsaw), z uwzględnieniem zmiany czasu. */
const TIME_ZONE = "Europe/Warsaw";

const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function warsawParts(instant: Date) {
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) parts[part.type] = part.value;
  return parts;
}

/** Przesunięcie czasu polskiego względem UTC (ms) w danej chwili. */
function warsawOffsetMs(instant: Date): number {
  const p = warsawParts(instant);
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Chwila UTC odpowiadająca północy czasu polskiego danego dnia. */
function warsawMidnightUtc(year: number, month: number, day: number): Date {
  const naive = Date.UTC(year, month - 1, day);
  const firstOffset = warsawOffsetMs(new Date(naive));
  let result = naive - firstOffset;
  const secondOffset = warsawOffsetMs(new Date(result));
  if (secondOffset !== firstOffset) result = naive - secondOffset;
  return new Date(result);
}

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isValidMonth(value: string): boolean {
  return MONTH_RE.test(value);
}

/** Bieżący miesiąc (YYYY-MM) w czasie polskim. */
export function currentMonthWarsaw(now: Date = new Date()): string {
  const p = warsawParts(now);
  return `${p.year}-${p.month}`;
}

/** [start, end) miesiąca YYYY-MM w czasie polskim: od 1. dnia 00:00 do 1. dnia następnego miesiąca 00:00. */
export function monthBoundsWarsaw(month: string): { start: Date; end: Date } {
  const match = MONTH_RE.exec(month);
  if (!match) throw new Error(`Nieprawidłowy miesiąc: ${month}`);
  const year = Number(match[1]);
  const m = Number(match[2]);
  return {
    start: warsawMidnightUtc(year, m, 1),
    end: m === 12 ? warsawMidnightUtc(year + 1, 1, 1) : warsawMidnightUtc(year, m + 1, 1),
  };
}

/** Data w czasie polskim w formacie `YYYY-MM-DD HH:mm:ss`. */
export function formatWarsawDateTime(date: Date): string {
  const p = warsawParts(date);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}
