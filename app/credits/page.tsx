"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Coins, Building2, User, Info, Loader2 } from "lucide-react";

interface CurrentUser {
  role: string;
  organizationId?: string | null;
}

interface CreditsInfo {
  billingMode: "PREPAID" | "UNLIMITED";
  balances: { VALUATION: number; CLAIM_DETAILS: number } | null;
}

interface LedgerEntry {
  id: string;
  createdAt: string;
  type: "USAGE" | "MANUAL_ADJUSTMENT";
  creditType: "VALUATION" | "CLAIM_DETAILS";
  amount: number;
  note: string | null;
  report: { id: string; publicReference: string | null } | null;
  user: { name: string } | null;
}

type Scope = "mine" | "org";

const CREDIT_TYPE_LABELS: Record<LedgerEntry["creditType"], string> = {
  VALUATION: "Wycena",
  CLAIM_DETAILS: "Szczegóły szkód",
};

const ENTRY_TYPE_LABELS: Record<LedgerEntry["type"], string> = {
  USAGE: "Zużycie",
  MANUAL_ADJUSTMENT: "Korekta",
};

function formatAmount(amount: number): string {
  if (amount === 0) return "0 (bez opłaty)";
  return amount > 0 ? `+${amount}` : `${amount}`;
}

function BalanceTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</p>
      <p
        className={`mt-2 text-3xl font-bold tracking-tight ${
          value < 1 ? "text-red-600 dark:text-red-400" : "text-slate-900 dark:text-white"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export default function CreditsPage() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [credits, setCredits] = useState<CreditsInfo | null>(null);
  const [creditsLoading, setCreditsLoading] = useState(true);

  const [scope, setScope] = useState<Scope>("mine");
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const canViewOrg = currentUser?.role === "MANAGER" || currentUser?.role === "ADMIN";

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated && data.user) setCurrentUser(data.user);
      })
      .catch(() => {});

    fetch("/api/credits/balance")
      .then((res) => res.json())
      .then((data) => {
        if (data && data.billingMode) setCredits(data);
      })
      .catch(() => {})
      .finally(() => setCreditsLoading(false));
  }, []);

  const loadLedger = useCallback((activeScope: Scope, cursor: string | null) => {
    const params = new URLSearchParams({ scope: activeScope });
    if (cursor) params.set("cursor", cursor);

    if (cursor) setLoadingMore(true);
    else setLedgerLoading(true);

    fetch(`/api/credits/ledger?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (!Array.isArray(data.entries)) return;
        setEntries((prev) => (cursor ? [...prev, ...data.entries] : data.entries));
        setNextCursor(data.nextCursor ?? null);
      })
      .catch(() => {})
      .finally(() => {
        setLedgerLoading(false);
        setLoadingMore(false);
      });
  }, []);

  useEffect(() => {
    loadLedger(scope, null);
  }, [scope, loadLedger]);

  const scopeButtonClass = (active: boolean) =>
    `inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
      active
        ? "bg-blue-600 text-white shadow-sm shadow-blue-500/20"
        : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
    }`;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-3">
          <Coins className="h-6 w-6 text-blue-500" /> Kredyty
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Saldo kredytów organizacji i historia ich zużycia.
        </p>
      </div>

      {creditsLoading ? (
        <div className="p-8 text-center text-xs text-slate-400">Pobieranie salda kredytów...</div>
      ) : credits?.billingMode === "PREPAID" && credits.balances ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <BalanceTile label="Wycena" value={credits.balances.VALUATION} />
          <BalanceTile label="Szczegóły szkód" value={credits.balances.CLAIM_DETAILS} />
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-300">
          Twoja organizacja nie jest rozliczana kredytami.
        </div>
      )}

      <div className="flex items-start gap-3 rounded-2xl border border-blue-500/20 bg-blue-500/10 p-4 text-sm text-blue-800 dark:text-blue-200">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <p>Zakup online pojawi się wkrótce. Aby doładować konto, skontaktuj się z opiekunem Izzy Lease.</p>
      </div>

      {canViewOrg && (
        <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
          <button type="button" onClick={() => setScope("mine")} className={scopeButtonClass(scope === "mine")}>
            <User className="h-3.5 w-3.5" />
            Moje
          </button>
          <button type="button" onClick={() => setScope("org")} className={scopeButtonClass(scope === "org")}>
            <Building2 className="h-3.5 w-3.5" />
            Cała organizacja
          </button>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
        {ledgerLoading ? (
          <div className="p-8 text-center text-xs text-slate-400">Pobieranie historii zużycia...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 uppercase tracking-wider dark:border-slate-800 dark:bg-slate-950/80 dark:text-slate-400">
                <tr>
                  <th className="px-5 py-3.5 font-semibold">Data</th>
                  <th className="px-5 py-3.5 font-semibold">Typ</th>
                  <th className="px-5 py-3.5 font-semibold">Rodzaj</th>
                  <th className="px-5 py-3.5 font-semibold">Ilość</th>
                  <th className="px-5 py-3.5 font-semibold">Raport</th>
                  <th className="px-5 py-3.5 font-semibold">Użytkownik</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 dark:divide-slate-800/60 dark:text-slate-300">
                {entries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-slate-500">
                      Brak wpisów w historii.
                    </td>
                  </tr>
                ) : (
                  entries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="px-5 py-4 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {new Date(entry.createdAt).toLocaleString("pl-PL")}
                      </td>
                      <td className="px-5 py-4 font-medium text-slate-900 dark:text-white">
                        {ENTRY_TYPE_LABELS[entry.type]}
                        {entry.note && (
                          <span className="block text-[10px] font-normal text-slate-400">{entry.note}</span>
                        )}
                      </td>
                      <td className="px-5 py-4">{CREDIT_TYPE_LABELS[entry.creditType]}</td>
                      <td className="px-5 py-4 font-bold text-slate-900 dark:text-white whitespace-nowrap">
                        {formatAmount(entry.amount)}
                      </td>
                      <td className="px-5 py-4">
                        {entry.report ? (
                          <Link
                            href={`/reports/${entry.report.id}`}
                            className="font-mono text-[11px] font-semibold text-blue-600 hover:underline dark:text-blue-400"
                          >
                            {entry.report.publicReference}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-5 py-4 text-slate-500 dark:text-slate-400">{entry.user?.name ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {nextCursor && !ledgerLoading && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => loadLedger(scope, nextCursor)}
            disabled={loadingMore}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
          >
            {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
            Pokaż więcej
          </button>
        </div>
      )}
    </div>
  );
}
