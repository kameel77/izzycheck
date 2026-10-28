// Type-only Prisma imports: safe to use from client components (nothing from @prisma/client reaches the bundle).
import type { CreditLedgerType, CreditType, InvoiceStatus, OrderStatus } from "@prisma/client";

export const LEDGER_TYPE_LABELS: Record<CreditLedgerType, string> = {
  USAGE: "Zużycie",
  MANUAL_ADJUSTMENT: "Korekta",
  PURCHASE: "Zakup",
};

export const CREDIT_TYPE_LABELS: Record<CreditType, string> = {
  VALUATION: "Wycena",
  CLAIM_DETAILS: "Szczegóły szkód",
};

export function formatCreditAmount(amount: number): string {
  if (amount === 0) return "0 (bez opłaty)";
  return amount > 0 ? `+${amount}` : `${amount}`;
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING_PAYMENT: "Oczekuje na płatność",
  PAID: "Opłacone",
  CANCELED: "Anulowane",
  FAILED: "Nieudane",
};

/** Admin view of an order's invoice status (customers only see "Pobierz PDF" or "W przygotowaniu"). */
export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  NOT_REQUIRED: "Nie dotyczy",
  PENDING: "Do wystawienia",
  ISSUING: "W trakcie",
  ISSUED: "Wystawiona",
  FAILED: "Błąd (ponowienie)",
  NEEDS_ATTENTION: "Wymaga sprawdzenia",
};

/**
 * Admin label of an order's invoice: a FAILED invoice with no next attempt has used up its automatic retries
 * and only a manual action helps.
 */
export function invoiceStatusLabel(status: InvoiceStatus, nextAttemptAt: Date | string | null): string {
  if (status === "FAILED" && nextAttemptAt === null) return "Błąd (tylko ręcznie)";
  return INVOICE_STATUS_LABELS[status];
}

/** A cron that has not run for longer than this is considered stopped (it is scheduled every few minutes). */
export const CRON_STALE_AFTER_MS = 15 * 60_000;

/** "5 min temu" for the admin header; stale when the cron never ran or the last run is older than 15 min. */
export function describeCronAge(lastRunAt: string | null, nowMs: number): { text: string; stale: boolean } {
  if (lastRunAt === null) return { text: "brak (cron nie uruchomił się)", stale: true };
  const ageMs = Math.max(0, nowMs - new Date(lastRunAt).getTime());
  const minutes = Math.floor(ageMs / 60_000);
  const text = minutes < 120 ? `${minutes} min temu` : `${Math.floor(minutes / 60)} h temu`;
  return { text, stale: ageMs > CRON_STALE_AFTER_MS };
}

/** Polish plural forms (one, few, many) of what a single credit of each type buys. */
const CREDIT_NOUNS: Record<CreditType, [string, string, string]> = {
  VALUATION: ["wycena pojazdu", "wyceny pojazdu", "wycen pojazdu"],
  CLAIM_DETAILS: ["raport historii szkód", "raporty historii szkód", "raportów historii szkód"],
};

function pluralPl(n: number, [one, few, many]: [string, string, string]): string {
  if (n === 1) return one;
  const lastTwo = n % 100;
  const last = n % 10;
  return last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14) ? few : many;
}

/** "10 raportów historii szkód ×1" for an order line. */
export function formatOrderItem(item: { creditType: CreditType; creditsPerPackage: number; quantity: number }): string {
  return `${item.creditsPerPackage} ${pluralPl(item.creditsPerPackage, CREDIT_NOUNS[item.creditType])} ×${item.quantity}`;
}

/** "10 kredytów" with the correct Polish plural. */
export function formatCreditCount(n: number): string {
  return `${n} ${pluralPl(n, ["kredyt", "kredyty", "kredytów"])}`;
}

const plnFormatter = new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" });

export function formatGrosze(grosze: number): string {
  return plnFormatter.format(grosze / 100);
}
