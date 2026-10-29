import type { CreditType } from "@prisma/client";

const CREDIT_TYPES: readonly CreditType[] = ["VALUATION", "CLAIM_DETAILS"];

export interface PackageInput {
  name: string;
  creditType: CreditType;
  credits: number;
  priceNetGrosze: number;
  vatRate: number;
  isActive: boolean;
  sortOrder: number;
}

export type PackageParseResult =
  | { ok: true; value: PackageInput }
  | { ok: false; error: string };

type PartialParseResult = { ok: true; value: Partial<PackageInput> } | { ok: false; error: string };

function isIntInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

const REQUIRED = ["name", "creditType", "credits", "priceNetGrosze"] as const;

/**
 * Validates a credit package body from an admin. `partial: true` (PATCH) validates only the provided
 * fields; `partial: false` (POST) requires name, creditType, credits and priceNetGrosze and defaults
 * vatRate (23), isActive (true) and sortOrder (0). sortOrder is legacy: optional, still accepted, no longer
 * used for ordering (packages sort by credits).
 */
export function parsePackageInput(body: unknown, opts: { partial: false }): PackageParseResult;
export function parsePackageInput(body: unknown, opts: { partial: true }): PartialParseResult;
export function parsePackageInput(body: unknown, opts: { partial: boolean }): PackageParseResult | PartialParseResult;
export function parsePackageInput(body: unknown, opts: { partial: boolean }): PackageParseResult | PartialParseResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Nieprawidłowe dane pakietu." };
  }
  const input = body as Record<string, unknown>;
  const has = (key: string) => input[key] !== undefined;
  const value: Partial<PackageInput> = {};

  if (!opts.partial) {
    for (const key of REQUIRED) {
      if (!has(key)) {
        return { ok: false, error: "Uzupełnij wszystkie wymagane pola pakietu." };
      }
    }
  }

  if (has("name")) {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (name.length < 3 || name.length > 80) {
      return { ok: false, error: "Nazwa pakietu musi mieć od 3 do 80 znaków." };
    }
    value.name = name;
  }
  if (has("creditType")) {
    const creditType = CREDIT_TYPES.find((t) => t === input.creditType);
    if (!creditType) return { ok: false, error: "Nieprawidłowy rodzaj kredytu." };
    value.creditType = creditType;
  }
  if (has("credits")) {
    if (!isIntInRange(input.credits, 1, 10000)) {
      return { ok: false, error: "Liczba kredytów musi być liczbą całkowitą 1–10000." };
    }
    value.credits = input.credits;
  }
  if (has("priceNetGrosze")) {
    if (!isIntInRange(input.priceNetGrosze, 1, 100000000)) {
      return { ok: false, error: "Cena netto (w groszach) musi być liczbą całkowitą 1–100000000." };
    }
    value.priceNetGrosze = input.priceNetGrosze;
  }
  if (has("vatRate")) {
    if (!isIntInRange(input.vatRate, 0, 100)) {
      return { ok: false, error: "Stawka VAT musi być liczbą całkowitą 0–100." };
    }
    value.vatRate = input.vatRate;
  }
  if (has("isActive")) {
    if (typeof input.isActive !== "boolean") {
      return { ok: false, error: "Aktywność musi być wartością logiczną." };
    }
    value.isActive = input.isActive;
  }
  if (has("sortOrder")) {
    if (!isIntInRange(input.sortOrder, -1_000_000, 1_000_000)) {
      return { ok: false, error: "Kolejność musi być liczbą całkowitą od -1 000 000 do 1 000 000." };
    }
    value.sortOrder = input.sortOrder;
  }

  if (opts.partial) {
    if (Object.keys(value).length === 0) return { ok: false, error: "Brak pól do zmiany." };
    return { ok: true, value };
  }

  return {
    ok: true,
    value: {
      vatRate: 23,
      isActive: true,
      sortOrder: 0,
      ...value,
    } as PackageInput,
  };
}
