"use client";

import { useEffect, useState } from "react";
import { KeyRound, Plus, RefreshCw, Loader2, AlertCircle, Copy, Check, Download } from "lucide-react";
import { currentMonthWarsaw } from "@/lib/api-clients/month";

interface Organization {
  id: string;
  name: string;
  nip: string;
}

interface ApiClient {
  id: string;
  name: string;
  organizationId: string;
  organization: { name: string; nip: string };
  tokenPrefix: string;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

interface UsageSummary {
  month: string;
  billableCount: number;
  totalCount: number;
  byOutcome: Record<string, number>;
}

const OUTCOME_LABELS: Record<string, string> = {
  IDENTIFIED: "Zidentyfikowano",
  NOT_FOUND: "Nie znaleziono VIN",
  UPSTREAM_ERROR: "Błąd Audatex",
  REJECTED: "Odrzucone (400/429)",
  INTERNAL_ERROR: "Błąd wewnętrzny",
};

const inputClass =
  "rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white";
const labelClass = "text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400";
const cardClass = "rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900";

const formatDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" }) : "—";

export default function AdminApiPage() {
  const [clients, setClients] = useState<ApiClient[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newOrgId, setNewOrgId] = useState("");
  const [addError, setAddError] = useState("");
  const [adding, setAdding] = useState(false);
  const [createdToken, setCreatedToken] = useState<{ name: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [usageOrgId, setUsageOrgId] = useState("");
  const [usageMonth, setUsageMonth] = useState(currentMonthWarsaw());
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [clientsRes, orgsRes] = await Promise.all([fetch("/api/admin/api-clients"), fetch("/api/admin/organizations")]);
      const clientsData = await clientsRes.json();
      const orgsData = await orgsRes.json();
      if (!clientsRes.ok) {
        setError(clientsData.error || "Nie udało się pobrać klientów API.");
      } else {
        setClients(clientsData.clients || []);
      }
      if (orgsRes.ok) setOrganizations(orgsData.organizations || []);
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
    setAdding(true);
    try {
      const res = await fetch("/api/admin/api-clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, organizationId: newOrgId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Nie udało się utworzyć klienta API.");
      setCreatedToken({ name: data.client.name, token: data.token });
      setCopied(false);
      setNewName("");
      setNewOrgId("");
      setShowAdd(false);
      await load();
    } catch (err: any) {
      setAddError(err.message || "Nie udało się utworzyć klienta API.");
    } finally {
      setAdding(false);
    }
  };

  const handleCopy = async () => {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(createdToken.token);
      setCopied(true);
    } catch {
      setError("Nie udało się skopiować tokenu. Zaznacz go i skopiuj ręcznie.");
    }
  };

  const handleToggleActive = async (client: ApiClient) => {
    setSavingId(client.id);
    setError("");
    try {
      const res = await fetch(`/api/admin/api-clients/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !client.isActive }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Nie udało się zmienić aktywności klienta.");
      await load();
    } catch (err: any) {
      setError(err.message || "Nie udało się zmienić aktywności klienta.");
    } finally {
      setSavingId(null);
    }
  };

  const loadUsage = async () => {
    setUsageError("");
    setSummary(null);
    if (!usageOrgId) {
      setUsageError("Wybierz organizację.");
      return;
    }
    setUsageLoading(true);
    try {
      const params = new URLSearchParams({ organizationId: usageOrgId, month: usageMonth });
      const res = await fetch(`/api/admin/api-usage?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Nie udało się pobrać użycia API.");
      setSummary(data.summary);
    } catch (err: any) {
      setUsageError(err.message || "Nie udało się pobrać użycia API.");
    } finally {
      setUsageLoading(false);
    }
  };

  const csvHref = usageOrgId
    ? `/api/admin/api-usage/export?${new URLSearchParams({ organizationId: usageOrgId, month: usageMonth })}`
    : undefined;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-3">
            <KeyRound className="h-7 w-7 text-blue-600 dark:text-blue-400" />
            API dla partnerów
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Klienci API (np. mamygo) i rozliczenia wywołań identyfikacji VIN. Token jest pokazywany tylko raz, po utworzeniu.
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
            Nowy klient API
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-xs font-medium text-red-600 dark:text-red-400">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {createdToken && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 space-y-3">
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
            Token klienta „{createdToken.name}”. Skopiuj go teraz: po zamknięciu tego okna nie da się go odczytać ponownie.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-lg bg-white px-3 py-1.5 text-xs text-slate-900 break-all dark:bg-slate-900 dark:text-white">
              {createdToken.token}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 transition-colors"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Skopiowano" : "Kopiuj"}
            </button>
            <button
              type="button"
              onClick={() => setCreatedToken(null)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors"
            >
              Zamknij
            </button>
          </div>
        </div>
      )}

      {showAdd && (
        <form onSubmit={handleAdd} className={`${cardClass} p-5 space-y-3`}>
          <h2 className={labelClass}>Nowy klient API</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label="Nazwa klienta"
              placeholder="Nazwa (np. mamygo)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className={`${inputClass} w-64`}
            />
            <select
              aria-label="Organizacja"
              value={newOrgId}
              onChange={(e) => setNewOrgId(e.target.value)}
              className={inputClass}
            >
              <option value="">Wybierz organizację</option>
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} (NIP {o.nip})
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={adding}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
            >
              {adding && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Utwórz
            </button>
          </div>
          {addError && <p className="text-xs text-red-600 dark:text-red-400">{addError}</p>}
        </form>
      )}

      <div className={`${cardClass} overflow-x-auto`}>
        {loading ? (
          <div className="flex items-center justify-center p-12 text-slate-500 text-xs">
            <Loader2 className="h-6 w-6 animate-spin text-blue-500 mr-2" />
            Ładowanie klientów API...
          </div>
        ) : clients.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-500 dark:text-slate-400">Brak klientów API.</div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <th className="px-4 py-3 font-semibold">Nazwa</th>
                <th className="px-4 py-3 font-semibold">Organizacja</th>
                <th className="px-4 py-3 font-semibold">Token</th>
                <th className="px-4 py-3 font-semibold">Aktywny</th>
                <th className="px-4 py-3 font-semibold">Ostatnie użycie</th>
                <th className="px-4 py-3 font-semibold">Utworzono</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr
                  key={c.id}
                  className={`border-b border-slate-100 last:border-0 dark:border-slate-800 ${c.isActive ? "" : "opacity-60"}`}
                >
                  <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">{c.name}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {c.organization.name}
                    <span className="ml-1 text-[10px] text-slate-400">NIP {c.organization.nip}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-300">{c.tokenPrefix}…</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={c.isActive}
                      aria-label={c.isActive ? "Wyłącz klienta" : "Włącz klienta"}
                      disabled={savingId === c.id}
                      onClick={() => handleToggleActive(c)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${
                        c.isActive ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-700"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          c.isActive ? "translate-x-4" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatDateTime(c.lastUsedAt)}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatDateTime(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className={`${cardClass} p-5 space-y-4`}>
        <h2 className={labelClass}>Użycie API</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Organizacja"
            value={usageOrgId}
            onChange={(e) => setUsageOrgId(e.target.value)}
            className={inputClass}
          >
            <option value="">Wybierz organizację</option>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} (NIP {o.nip})
              </option>
            ))}
          </select>
          <input
            aria-label="Miesiąc"
            type="month"
            value={usageMonth}
            onChange={(e) => setUsageMonth(e.target.value)}
            className={inputClass}
          />
          <button
            type="button"
            onClick={loadUsage}
            disabled={usageLoading}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
          >
            {usageLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Pokaż
          </button>
          {csvHref ? (
            <a
              href={csvHref}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Pobierz CSV
            </a>
          ) : (
            <span className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-400 dark:border-slate-700">
              <Download className="h-3.5 w-3.5" />
              Pobierz CSV
            </span>
          )}
        </div>
        {usageError && <p className="text-xs text-red-600 dark:text-red-400">{usageError}</p>}
        {summary && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-6">
              <div>
                <p className={labelClass}>Płatne raporty</p>
                <p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-white">{summary.billableCount}</p>
              </div>
              <div>
                <p className={labelClass}>Wszystkie wywołania</p>
                <p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-white">{summary.totalCount}</p>
              </div>
            </div>
            <table className="text-left text-xs">
              <tbody>
                {Object.entries(OUTCOME_LABELS).map(([outcome, label]) => (
                  <tr key={outcome}>
                    <td className="pr-6 py-1 text-slate-600 dark:text-slate-300">{label}</td>
                    <td className="py-1 tabular-nums font-semibold text-slate-900 dark:text-white">
                      {summary.byOutcome[outcome] ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
