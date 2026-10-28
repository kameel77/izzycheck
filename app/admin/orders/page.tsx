"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, Receipt, RefreshCw } from "lucide-react";
import AdminOrdersTable, { type AdminOrderRow } from "@/components/billing/AdminOrdersTable";
import { INVOICE_STATUS_LABELS, ORDER_STATUS_LABELS, PAYMENT_METHOD_LABELS, describeCronAge } from "@/lib/billing/labels";

interface Filters {
  status: string;
  invoiceStatus: string;
  paymentMethod: string;
  organizationId: string;
  /** "true" shows only invoices with a KSeF problem. */
  ksefProblem: string;
}

interface Attention {
  needsAttention: number;
  failedManualOnly: number;
  ksefProblems: number;
  emailOverdue: number;
  lastCronRunAt: string | null;
}

const NO_FILTERS: Filters = { status: "", invoiceStatus: "", paymentMethod: "", organizationId: "", ksefProblem: "" };

const selectClass =
  "rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white";
const labelClass = "text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400";

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<AdminOrderRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [organizations, setOrganizations] = useState<Array<{ id: string; name: string }>>([]);
  const [fakturowniaConfigured, setFakturowniaConfigured] = useState(true);
  const [attention, setAttention] = useState<Attention | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const latestRequestId = useRef(0);

  /** `background` reloads the first page without replacing the table by a spinner (keeps row messages). */
  const load = useCallback((activeFilters: Filters, cursor: string | null, background = false) => {
    const params = new URLSearchParams();
    if (activeFilters.status) params.set("status", activeFilters.status);
    if (activeFilters.invoiceStatus) params.set("invoiceStatus", activeFilters.invoiceStatus);
    if (activeFilters.paymentMethod) params.set("paymentMethod", activeFilters.paymentMethod);
    if (activeFilters.organizationId) params.set("organizationId", activeFilters.organizationId);
    if (activeFilters.ksefProblem) params.set("ksefProblem", activeFilters.ksefProblem);
    if (cursor) params.set("cursor", cursor);

    // Only the most recent request may commit its result; older ones are stale.
    const requestId = ++latestRequestId.current;
    const isCurrent = () => requestId === latestRequestId.current;

    setError("");
    if (cursor) {
      setLoadingMore(true);
    } else {
      setLoadingMore(false);
      if (!background) setLoading(true);
    }

    fetch(`/api/admin/orders?${params.toString()}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof data?.error === "string" && data.error ? data.error : "Nie udało się pobrać zamówień.");
        if (!Array.isArray(data.orders)) throw new Error("Nie udało się pobrać zamówień.");
        return data;
      })
      .then((data) => {
        if (!isCurrent()) return;
        setOrders((prev) => (cursor ? [...prev, ...data.orders] : data.orders));
        setNextCursor(data.nextCursor ?? null);
        setFakturowniaConfigured(data.fakturowniaConfigured !== false);
        if (Array.isArray(data.organizations)) setOrganizations(data.organizations);
        if (data.attention && typeof data.attention === "object") setAttention(data.attention);
        if (Array.isArray(data.warnings)) setWarnings(data.warnings.filter((w: unknown): w is string => typeof w === "string"));
      })
      .catch((err) => {
        if (!isCurrent()) return;
        setError(err instanceof Error && err.message ? err.message : "Wystąpił błąd sieciowy podczas pobierania danych.");
        if (!cursor && !background) {
          setOrders([]);
          setNextCursor(null);
        }
      })
      .finally(() => {
        if (!isCurrent()) return;
        setLoading(false);
        setLoadingMore(false);
      });
  }, []);

  useEffect(() => {
    load(filters, null);
  }, [filters, load]);

  const setFilter = (patch: Partial<Filters>) => setFilters((prev) => ({ ...prev, ...patch }));

  const attentionTotal = attention ? attention.needsAttention + attention.failedManualOnly + attention.ksefProblems + attention.emailOverdue : 0;
  const cronAge = attention ? describeCronAge(attention.lastCronRunAt, Date.now()) : null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-3">
            <Receipt className="h-7 w-7 text-blue-600 dark:text-blue-400" />
            Zamówienia
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Wszystkie zamówienia kredytów ze wszystkich organizacji, wraz ze stanem faktur i KSeF.
          </p>
        </div>
        <button
          type="button"
          onClick={() => load(filters, null)}
          title="Odśwież"
          className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors shadow-sm"
        >
          <RefreshCw className="h-4 w-4" />
          Odśwież
        </button>
      </div>

      {attention && cronAge && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs font-semibold">
          <span
            className={attentionTotal > 0 ? "text-red-600 dark:text-red-400" : "text-slate-600 dark:text-slate-300"}
            title={`Wymaga sprawdzenia: ${attention.needsAttention}, błąd tylko ręcznie: ${attention.failedManualOnly}, problemy KSeF: ${attention.ksefProblems}, niewysłane e-maile z fakturą: ${attention.emailOverdue}`}
          >
            Wymaga uwagi: {attentionTotal}
          </span>
          <span className={cronAge.stale ? "text-red-600 dark:text-red-400" : "text-slate-600 dark:text-slate-300"}>
            Ostatni przebieg crona: {cronAge.text}
          </span>
        </div>
      )}

      {warnings.map((warning) => (
        <div
          key={warning}
          className="flex items-center gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-xs font-medium text-red-600 dark:text-red-400"
        >
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{warning}</span>
        </div>
      ))}

      {!fakturowniaConfigured && (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs font-medium text-amber-700 dark:text-amber-400">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>
            Fakturownia nie jest skonfigurowana — faktury czekają w statusie „{INVOICE_STATUS_LABELS.PENDING}”. Akcje „Ponów
            fakturę” i „Odśwież KSeF” są niedostępne.
          </span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-xs font-medium text-red-600 dark:text-red-400">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Status płatności</span>
          <select value={filters.status} onChange={(e) => setFilter({ status: e.target.value })} className={selectClass}>
            <option value="">Wszystkie</option>
            {Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Metoda płatności</span>
          <select value={filters.paymentMethod} onChange={(e) => setFilter({ paymentMethod: e.target.value })} className={selectClass}>
            <option value="">Wszystkie</option>
            {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Status faktury</span>
          <select value={filters.invoiceStatus} onChange={(e) => setFilter({ invoiceStatus: e.target.value })} className={selectClass}>
            <option value="">Wszystkie</option>
            {Object.entries(INVOICE_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>KSeF</span>
          <select value={filters.ksefProblem} onChange={(e) => setFilter({ ksefProblem: e.target.value })} className={selectClass}>
            <option value="">Wszystkie</option>
            <option value="true">Problemy KSeF</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Organizacja</span>
          <select
            value={filters.organizationId}
            onChange={(e) => setFilter({ organizationId: e.target.value })}
            className={`${selectClass} max-w-[16rem]`}
          >
            <option value="">Wszystkie</option>
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center p-12 text-slate-500 text-xs">
            <Loader2 className="h-6 w-6 animate-spin text-blue-500 mr-2" />
            Pobieranie zamówień...
          </div>
        ) : (
          <AdminOrdersTable
            orders={orders}
            fakturowniaConfigured={fakturowniaConfigured}
            onChanged={() => load(filters, null, true)}
          />
        )}
      </div>

      {nextCursor && !loading && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => load(filters, nextCursor)}
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
