import type { CreditType } from "@prisma/client";

const CREDIT_TYPES: readonly CreditType[] = ["VALUATION", "CLAIM_DETAILS"];
const MAX_ADJUSTMENT = 100000;
const MIN_NOTE_LENGTH = 3;
const MAX_NOTE_LENGTH = 500;

export type AdjustmentParseResult =
  | { ok: true; value: { creditType: CreditType; amount: number; note: string } }
  | { ok: false; error: string };

/** Validates the body of a manual credit adjustment sent by an admin. */
export function parseAdjustment(body: unknown): AdjustmentParseResult {
  const input = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;

  const creditType = CREDIT_TYPES.find((t) => t === input.creditType);
  if (!creditType) {
    return { ok: false, error: "Nieprawidłowy rodzaj kredytu." };
  }

  const { amount } = input;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount === 0 || Math.abs(amount) > MAX_ADJUSTMENT) {
    return { ok: false, error: "Ilość musi być liczbą całkowitą różną od zera (maks. 100 000)." };
  }

  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length < MIN_NOTE_LENGTH) {
    return { ok: false, error: "Podaj powód korekty (min. 3 znaki)." };
  }
  if (note.length > MAX_NOTE_LENGTH) {
    return { ok: false, error: "Powód korekty może mieć maks. 500 znaków." };
  }

  return { ok: true, value: { creditType, amount, note } };
}
