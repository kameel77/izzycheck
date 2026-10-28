"use client";

import { useEffect, useState } from "react";
import { Tags, Plus, Edit2, Check, X, RefreshCw, Loader2, AlertCircle } from "lucide-react";
import { CREDIT_TYPE_LABELS } from "@/lib/billing/labels";
import { unitGrossFromNet } from "@/lib/billing/pricing";

type CreditType = "VALUATION" | "CLAIM_DETAILS";

interface CreditPackage {
  id: string;
  name: string;
  creditType: CreditType;
  credits: number;
  priceNetGrosze: number;
  vatRate: number;
  isActive: boolean;
  sortOrder: number;
}

interface FormState {
  name: string;
  creditType: CreditType;
  credits: string;
  pricePln: string;
  vatRate: string;
  sortOrder: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  creditType: "VALUATION",
  credits: "",
  pricePln: "",
  vatRate: "23",
  sortOrder: "0",
};

const pln = new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" });
const formatGrosze = (grosze: number) => pln.format(grosze / 100);

/** "123,45" / "123.4" / "123" -> integer grosze; null when the input is not a PLN amount with up to 2 decimals. */
function plnToGrosze(input: string): number | null {
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
}

function groszeToPlnInput(grosze: number): string {
  const whole = Math.floor(grosze / 100);
  const cents = String(grosze % 100).padStart(2, "0");
  return cents === "00" ? String(whole) : `${whole},${cents}`;
}

function formFromPackage(p: CreditPackage): FormState {
  return {
    name: p.name,
    creditType: p.creditType,
    credits: String(p.credits),
    pricePln: groszeToPlnInput(p.priceNetGrosze),
    vatRate: String(p.vatRate),
    sortOrder: String(p.sortOrder),
  };
}

/** Converts the form to an API body, or returns an error message. */
function formToBody(form: FormState): { body: Record<string, unknown> } | { error: string } {
  const priceNetGrosze = plnToGrosze(form.pricePln);
  if (priceNetGrosze === null) {
    return { error: "Podaj cenę netto w złotych (maks. 2 miejsca po przecinku)." };
  }
  return {
    body: {
      name: form.name,
      creditType: form.creditType,
      credits: form.credits.trim() === "" ? null : Number(form.credits),
      priceNetGrosze,
      vatRate: form.vatRate.trim() === "" ? null : Number(form.vatRate),
      sortOrder: form.sortOrder.trim() === "" ? null : Number(form.sortOrder),
    },
  };
}

const inputClass =
  "rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white";
const labelClass = "text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400";

function PackageFields({ form, onChange }: { form: FormState; onChange: (next: FormState) => void }) {
  const set = (patch: Partial<FormState>) => onChange({ ...form, ...patch });
  return (
    <>
      <input
        aria-label="Nazwa"
        value={form.name}
        onChange={(e) => set({ name: e.target.value })}
        className={`${inputClass} w-full min-w-[10rem]`}
      />
      <select
        aria-label="Rodzaj"
        value={form.creditType}
        onChange={(e) => set({ creditType: e.target.value as CreditType })}
        className={inputClass}
      >
        {(Object.keys(CREDIT_TYPE_LABELS) as CreditType[]).map((t) => (
          <option key={t} value={t}>
            {CREDIT_TYPE_LABELS[t]}
          </option>
        ))}
      </select>
      <input
        aria-label="Kredyty"
        type="number"
        min={1}
        value={form.credits}
        onChange={(e) => set({ credits: e.target.value })}
        className={`${inputClass} w-24`}
      />
      <input
        aria-label="Cena netto (PLN)"
        inputMode="decimal"
        value={form.pricePln}
        onChange={(e) => set({ pricePln: e.target.value })}
        placeholder="0,00"
        className={`${inputClass} w-28`}
      />
      <input
        aria-label="VAT (%)"
        type="number"
        min={0}
        max={100}
        value={form.vatRate}
        onChange={(e) => set({ vatRate: e.target.value })}
        className={`${inputClass} w-20`}
      />
      <input
        aria-label="Kolejność"
        type="number"
        value={form.sortOrder}
        onChange={(e) => set({ sortOrder: e.target.value })}
        className={`${inputClass} w-20`}
      />
    </>
  );
}

export default function AdminCreditPackagesPage() {
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<FormState>(EMPTY_FORM);
  const [addError, setAddError] = useState("");
  const [adding, setAdding] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);
  const [editError, setEditError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/credit-packages");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Nie udało się pobrać cennika pakietów.");
      } else {
        setPackages(data.packages || []);
      }
    } catch {
      setError("Wystąpił błąd sieciowy podczas pobierania danych.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError("");
    const converted = formToBody(addForm);
    if ("error" in converted) {
      setAddError(converted.error);
      return;
    }
    setAdding(true);
    try {
      const res = await fetch("/api/admin/credit-packages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(converted.body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Nie udało się dodać pakietu.");
      setAddForm(EMPTY_FORM);
      setShowAdd(false);
      await load();
    } catch (err: any) {
      setAddError(err.message || "Nie udało się dodać pakietu.");
    } finally {
      setAdding(false);
    }
  };

  const patchPackage = async (id: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/admin/credit-packages/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Nie udało się zapisać pakietu.");
  };

  const startEdit = (p: CreditPackage) => {
    setEditingId(p.id);
    setEditForm(formFromPackage(p));
    setEditError("");
  };

  const handleSaveEdit = async (id: string) => {
    setEditError("");
    const converted = formToBody(editForm);
    if ("error" in converted) {
      setEditError(converted.error);
      return;
    }
    setSavingId(id);
    try {
      await patchPackage(id, converted.body);
      setEditingId(null);
      await load();
    } catch (err: any) {
      setEditError(err.message || "Nie udało się zapisać pakietu.");
    } finally {
      setSavingId(null);
    }
  };

  const handleToggleActive = async (p: CreditPackage) => {
    setSavingId(p.id);
    setError("");
    try {
      await patchPackage(p.id, { isActive: !p.isActive });
      await load();
    } catch (err: any) {
      setError(err.message || "Nie udało się zmienić aktywności pakietu.");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-3">
            <Tags className="h-7 w-7 text-blue-600 dark:text-blue-400" />
            Cennik kredytów
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Pakiety kredytów dostępne w sklepie. Ceny podawane netto, VAT naliczany od ceny za sztukę. Pakietów nie usuwamy,
            wyłączamy je z oferty.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={load}
            title="Odśwież"
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors shadow-sm"
          >
            <RefreshCw className="h-4 w-4" />
            Odśwież
          </button>
          <button
            onClick={() => {
              setShowAdd((v) => !v);
              setAddError("");
            }}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 shadow-sm shadow-blue-500/20 transition-all"
          >
            <Plus className="h-4 w-4" />
            Nowy pakiet
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-xs font-medium text-red-600 dark:text-red-400">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {showAdd && (
        <form
          onSubmit={handleAdd}
          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3 dark:border-slate-800 dark:bg-slate-900"
        >
          <h2 className={labelClass}>Nowy pakiet</h2>
          <div className="flex flex-wrap items-center gap-2">
            <PackageFields form={addForm} onChange={setAddForm} />
            <button
              type="submit"
              disabled={adding}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
            >
              {adding && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Dodaj
            </button>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Kolumny: nazwa, rodzaj, kredyty, cena netto (PLN), VAT (%), kolejność.
          </p>
          {addError && <p className="text-xs text-red-600 dark:text-red-400">{addError}</p>}
        </form>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center p-12 text-slate-500 text-xs">
            <Loader2 className="h-6 w-6 animate-spin text-blue-500 mr-2" />
            Ładowanie cennika...
          </div>
        ) : packages.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-500 dark:text-slate-400">Brak pakietów w cenniku.</div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <th className="px-4 py-3 font-semibold">Nazwa</th>
                <th className="px-4 py-3 font-semibold">Rodzaj</th>
                <th className="px-4 py-3 font-semibold text-right">Kredyty</th>
                <th className="px-4 py-3 font-semibold text-right">Cena netto</th>
                <th className="px-4 py-3 font-semibold text-right">Cena brutto</th>
                <th className="px-4 py-3 font-semibold text-right">Cena/szt. netto</th>
                <th className="px-4 py-3 font-semibold">Aktywny</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {packages.map((p) => {
                const isEditing = editingId === p.id;
                const isSaving = savingId === p.id;
                return (
                  <tr
                    key={p.id}
                    className={`border-b border-slate-100 last:border-0 dark:border-slate-800 ${
                      p.isActive ? "" : "opacity-60"
                    }`}
                  >
                    {isEditing ? (
                      <td colSpan={7} className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <PackageFields form={editForm} onChange={setEditForm} />
                        </div>
                        {editError && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{editError}</p>}
                      </td>
                    ) : (
                      <>
                        <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">{p.name}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{CREDIT_TYPE_LABELS[p.creditType]}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-900 dark:text-white">{p.credits}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-900 dark:text-white">
                          {formatGrosze(p.priceNetGrosze)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-600 dark:text-slate-300">
                          {formatGrosze(unitGrossFromNet(p.priceNetGrosze, p.vatRate))}
                          <span className="ml-1 text-[10px] text-slate-400">({p.vatRate}% VAT)</span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-600 dark:text-slate-300">
                          {formatGrosze(p.priceNetGrosze / p.credits)}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={p.isActive}
                            aria-label={p.isActive ? "Wyłącz pakiet" : "Włącz pakiet"}
                            disabled={isSaving}
                            onClick={() => handleToggleActive(p)}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${
                              p.isActive ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-700"
                            }`}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                p.isActive ? "translate-x-4" : "translate-x-0.5"
                              }`}
                            />
                          </button>
                        </td>
                      </>
                    )}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              disabled={isSaving}
                              onClick={() => handleSaveEdit(p.id)}
                              title="Zapisz"
                              className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
                            >
                              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              title="Anuluj"
                              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => startEdit(p)}
                            title="Edytuj"
                            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                            Edytuj
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
