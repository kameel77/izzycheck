// Type-only Prisma imports: safe to use from client components (nothing from @prisma/client reaches the bundle).
import type { CreditLedgerType, CreditType } from "@prisma/client";

export const LEDGER_TYPE_LABELS: Record<CreditLedgerType, string> = {
  USAGE: "Zużycie",
  MANUAL_ADJUSTMENT: "Korekta",
};

export const CREDIT_TYPE_LABELS: Record<CreditType, string> = {
  VALUATION: "Wycena",
  CLAIM_DETAILS: "Szczegóły szkód",
};

export function formatCreditAmount(amount: number): string {
  if (amount === 0) return "0 (bez opłaty)";
  return amount > 0 ? `+${amount}` : `${amount}`;
}
