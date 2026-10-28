"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Coins, Loader2 } from "lucide-react";
import { CREDIT_TYPE_LABELS, LEDGER_TYPE_LABELS, formatCreditAmount } from "@/lib/billing/labels";

type BillingMode = "PREPAID" | "UNLIMITED";
type CreditType = "VALUATION" | "CLAIM_DETAILS";

interface LedgerEntry {
  id: string;
  createdAt: string;
  type: "USAGE" | "MANUAL_ADJUSTMENT";
  creditType: CreditType;
  amount: number;
  note: string | null;
  report: { id: string; publicReference: string | null } | null;
  user: { name: string } | null;
}

interface CreditsData {
  billingMode: BillingMode;
  balances: Record<CreditType, number>;
  entries: LedgerEntry[];
}

const BILLING_MODE_LABELS: Record<BillingMode, string> = {
  PREPAID: "Prepaid (kredyty)",
  UNLIMITED: "Bez limitu",
};

const inputClass =
  "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white";

export default function OrgCreditsPanel({ organizationId }: { organizationId: string }) {
  const [data, setData] = useState<CreditsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const latestRequestId = useRef(0);

  const [modeSaving, setModeSaving] = useState(false);
  const [modeError, setModeError] = useState("");

  const [creditType, setCreditType] = useState<CreditType>("VALUATION");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");

  const load = useCallback(async () => {
    const requestId = ++latestRequestId.current;
    setLoadError("");
    try {
      const res = await fetch(`/api/admin/organizations/${organizationId}/credits`);
      const json = await res.json();
      if (requestId !== latestRequestId.current) return;
      if (!res.ok) throw new Error(json.error || "Nie udało się pobrać danych kredytów.");
      setData(json);
    } catch (err: any) {
      if (requestId !== latestRequestId.current) return;
      setLoadError(err.message || "Nie udało się pobrać danych kredytów.");
    } finally {
      if (requestId === latestRequestId.current) setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    setLoading(true);
    setData(null);
    load();
  }, [load]);

  const handleModeChange = async (mode: BillingMode) => {
    if (!data || mode === data.billingMode) return;
    if (!window.confirm("Zmienić tryb rozliczeń tej organizacji?")) return;

    setModeSaving(true);
    setModeError("");
    try {
      const res = await fetch(`/api/admin/organizations/${organizationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billingMode: mode }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Nie udało się zmienić trybu rozliczeń.");
      await load();
    } catch (err: any) {
      setModeError(err.message || "Nie udało się zmienić trybu rozliczeń.");
    } finally {
      setModeSaving(false);
    }
  };

  const handleAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    setFormSuccess("");
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/organizations/${organizationId}/credits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creditType,
          amount: amount.trim() === "" ? null : Number(amount),
          note,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Nie udało się zapisać korekty.");
      setFormSuccess("Saldo zaktualizowane.");
      setAmount("");
      setNote("");
      await load();
    } catch (err: any) {
      setFormError(err.message || "Nie udało się zapisać korekty.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4 dark:border-slate-800 dark:bg-slate-900">
      <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        <Coins className="h-4 w-4 text-blue-500" /> Kredyty
      </h3>

      {loading ? (
        <div className="flex items-center justify-center p-4 text-xs text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin mr-2 text-blue-500" />
          Ładowanie kredytów...
        </div>
      ) : !data ? (
        <p className="text-xs text-red-600 dark:text-red-400">{loadError}</p>
      ) : (
        <>
          {loadError && <p className="text-xs text-red-600 dark:text-red-400">{loadError}</p>}

          <div className="flex flex-wrap items-center gap-2">
            {(Object.keys(BILLING_MODE_LABELS) as BillingMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                disabled={modeSaving}
                onClick={() => handleModeChange(mode)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                  data.billingMode === mode
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                }`}
              >
                {BILLING_MODE_LABELS[mode]}
              </button>
            ))}
            {modeSaving && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
          </div>
          {modeError && <p className="text-xs text-red-600 dark:text-red-400">{modeError}</p>}

          <div className="grid gap-3 sm:grid-cols-2">
            {(Object.keys(CREDIT_TYPE_LABELS) as CreditType[]).map((type) => (
              <div
                key={type}
                className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40"
              >
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {CREDIT_TYPE_LABELS[type]}
                </p>
                <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{data.balances[type]}</p>
              </div>
            ))}
          </div>

          <form onSubmit={handleAdjust} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              Rodzaj
              <select
                value={creditType}
                onChange={(e) => setCreditType(e.target.value as CreditType)}
                className={inputClass}
              >
                {(Object.keys(CREDIT_TYPE_LABELS) as CreditType[]).map((type) => (
                  <option key={type} value={type}>
                    {CREDIT_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              Ilość (ze znakiem, np. 10 lub -2)
              <input
                type="number"
                step="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={`${inputClass} w-48`}
              />
            </label>
            <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              Powód korekty
              <input type="text" value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
            </label>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Zapisz korektę
            </button>
          </form>
          {formError && <p className="text-xs text-red-600 dark:text-red-400">{formError}</p>}
          {formSuccess && <p className="text-xs text-emerald-600 dark:text-emerald-400">{formSuccess}</p>}

          <div>
            <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Ostatnie operacje
            </h4>
            {data.entries.length === 0 ? (
              <p className="text-xs text-slate-500">Brak wpisów w historii.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <tbody className="divide-y divide-slate-100 text-slate-700 dark:divide-slate-800/60 dark:text-slate-300">
                    {data.entries.map((entry) => (
                      <tr key={entry.id}>
                        <td className="py-2 pr-3 whitespace-nowrap text-slate-500 dark:text-slate-400">
                          {new Date(entry.createdAt).toLocaleString("pl-PL")}
                        </td>
                        <td className="py-2 pr-3 font-medium text-slate-900 dark:text-white">
                          {LEDGER_TYPE_LABELS[entry.type]}
                          {entry.note && (
                            <span className="block text-[10px] font-normal text-slate-400">{entry.note}</span>
                          )}
                        </td>
                        <td className="py-2 pr-3">{CREDIT_TYPE_LABELS[entry.creditType]}</td>
                        <td className="py-2 pr-3 font-bold whitespace-nowrap text-slate-900 dark:text-white">
                          {formatCreditAmount(entry.amount)}
                        </td>
                        <td className="py-2 pr-3 font-mono text-[11px]">
                          {entry.report?.publicReference ?? "—"}
                        </td>
                        <td className="py-2 text-slate-500 dark:text-slate-400">{entry.user?.name ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
