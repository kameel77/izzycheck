import type { CreditType } from "@prisma/client";

export type NewReportCreditCheck =
  | { ok: true }
  | { ok: false; creditType: CreditType; message: string };

/**
 * Early gate for report creation: a PREPAID organization needs at least 1 credit
 * of every paid module type it requests. CLAIM_CHECK is free and never checked.
 */
export function checkCreditsForNewReport(input: {
  prepaid: boolean;
  balances: Record<CreditType, number> | null;
  includeValuation: boolean;
  includeClaimDetails: boolean;
}): NewReportCreditCheck {
  if (!input.prepaid) return { ok: true };

  const balances = input.balances;
  if (input.includeValuation && (balances?.VALUATION ?? 0) < 1) {
    return {
      ok: false,
      creditType: "VALUATION",
      message: "Brak kredytów na wycenę pojazdu. Dokup kredyty, aby zlecić ten raport.",
    };
  }
  if (input.includeClaimDetails && (balances?.CLAIM_DETAILS ?? 0) < 1) {
    return {
      ok: false,
      creditType: "CLAIM_DETAILS",
      message: "Brak kredytów na szczegóły szkód. Dokup kredyty, aby zlecić ten raport.",
    };
  }
  return { ok: true };
}
