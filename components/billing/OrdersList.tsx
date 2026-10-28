"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Building2, ExternalLink, FileDown, Loader2, Receipt, RefreshCw, User } from "lucide-react";
import { ORDER_STATUS_LABELS, formatGrosze, formatOrderItem, formatYmdPl, orderStatusLabel } from "@/lib/billing/labels";
import { isProformaExpired } from "@/lib/billing/proforma-dates";

interface OrderRow {
  id: string;
  status: keyof typeof ORDER_STATUS_LABELS;
  totalGrossGrosze: number;
  createdAt: string;
  paidAt: string | null;
  paymentMethod: "PAYU" | "PROFORMA";
  /** YYYY-MM-DD */
  proformaDueDate: string | null;
  proformaNumber: string | null;
  proformaPdfUrl: string | null;
  invoiceStatus: "NOT_REQUIRED" | "PENDING" | "ISSUED";
  invoiceNumber: string | null;
  invoicePdfUrl: string | null;
  user: { name: string } | null;
  items: Array<{
    packageName: string;
    creditType: "VALUATION" | "CLAIM_DETAILS";
    creditsPerPackage: number;
    quantity: number;
    lineGrossGrosze: number;
  }>;
}

type Scope = "mine" | "org";

/** Per-row result of "Sprawdź status"; payuRedirectUri is only present for the order's creator. */
interface RowCheck {
  checking: boolean;
  message?: string;
  error?: boolean;
  payuRedirectUri?: string;
}

const STATUS_CLASSES: Record<OrderRow["status"], string> = {
  PENDING_PAYMENT: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  PAID: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  CANCELED: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
  FAILED: "bg-red-500/10 text-red-700 dark:text-red-400",
};

/** A proforma that ran past its due date looks like a canceled order. */
const EXPIRED_CLASSES = STATUS_CLASSES.CANCELED;

function ProformaInfo({ order }: { order: OrderRow }) {
  return (
    <div className="flex flex-col items-start gap-1">
      {order.proformaNumber && <span className="font-medium text-slate-700 dark:text-slate-300">{order.proformaNumber}</span>}
      {order.proformaPdfUrl && (
        <a
          href={order.proformaPdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:underline dark:text-blue-400"
        >
          <FileDown className="h-3 w-3" />
          Pobierz proformę
        </a>
      )}
      {order.status === "PENDING_PAYMENT" && order.proformaDueDate && (
        <span className="text-[11px] text-slate-500 dark:text-slate-400">Termin płatności: {formatYmdPl(order.proformaDueDate)}</span>
      )}
    </div>
  );
}

function InvoiceCell({ order }: { order: OrderRow }) {
  if (order.invoiceStatus === "NOT_REQUIRED") {
    return order.paymentMethod === "PROFORMA" ? <ProformaInfo order={order} /> : <span className="text-slate-400">—</span>;
  }
  if (order.invoiceStatus === "PENDING") {
    return (
      <div className="flex flex-col items-start gap-2">
        {order.paymentMethod === "PROFORMA" && <ProformaInfo order={order} />}
        <span className="text-slate-500 dark:text-slate-400">W przygotowaniu</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-2">
      {order.paymentMethod === "PROFORMA" && <ProformaInfo order={order} />}
      {order.invoiceNumber && <span className="font-medium text-slate-700 dark:text-slate-300">{order.invoiceNumber}</span>}
      {order.invoicePdfUrl && (
        <a
          href={order.invoicePdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:underline dark:text-blue-400"
        >
          <FileDown className="h-3 w-3" />
          Pobierz PDF
        </a>
      )}
    </div>
  );
}

function OrderActions({
  order,
  check,
  onCheck,
}: {
  order: OrderRow;
  check: RowCheck | undefined;
  onCheck: (orderId: string) => void;
}) {
  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onCheck(order.id)}
          disabled={check?.checking}
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700 transition-colors"
        >
          {check?.checking ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Sprawdź status
        </button>
        {check?.payuRedirectUri && (
          <a
            href={check.payuRedirectUri}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-500 transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            Dokończ płatność
          </a>
        )}
      </div>
      {check?.message && (
        <p
          role="status"
          className={`text-[11px] ${check.error ? "text-red-600 dark:text-red-400" : "text-slate-500 dark:text-slate-400"}`}
        >
          {check.message}
        </p>
      )}
    </div>
  );
}

export default function OrdersList({ canViewOrg }: { canViewOrg: boolean }) {
  const [scope, setScope] = useState<Scope>("mine");
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [rowChecks, setRowChecks] = useState<Record<string, RowCheck>>({});
  const latestRequestId = useRef(0);
  const checkingRef = useRef(new Set<string>());

  const loadOrders = useCallback((activeScope: Scope, cursor: string | null) => {
    const params = new URLSearchParams({ scope: activeScope });
    if (cursor) params.set("cursor", cursor);

    // Only the most recent request may commit its result; older ones are stale.
    const requestId = ++latestRequestId.current;
    const isCurrent = () => requestId === latestRequestId.current;

    setLoadError(false);
    if (cursor) {
      setLoadingMore(true);
    } else {
      setLoadingMore(false);
      setLoading(true);
    }

    fetch(`/api/orders?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error("orders request failed");
        return res.json();
      })
      .then((data) => {
        if (!isCurrent()) return;
        if (!Array.isArray(data.orders)) throw new Error("invalid orders response");
        setOrders((prev) => (cursor ? [...prev, ...data.orders] : data.orders));
        setNextCursor(data.nextCursor ?? null);
      })
      .catch(() => {
        if (!isCurrent()) return;
        setLoadError(true);
        if (!cursor) {
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
    setOrders([]);
    setNextCursor(null);
    loadOrders(scope, null);
  }, [scope, loadOrders]);

  // The credit shop announces a new (proforma) order, so it shows up here without a page reload.
  useEffect(() => {
    const reload = () => loadOrders(scope, null);
    window.addEventListener("orders:changed", reload);
    return () => window.removeEventListener("orders:changed", reload);
  }, [scope, loadOrders]);

  // GET /api/orders/:id syncs a pending order with PayU (throttled server-side) and returns its current state.
  const checkStatus = useCallback((orderId: string) => {
    if (checkingRef.current.has(orderId)) return;
    checkingRef.current.add(orderId);
    setRowChecks((prev) => ({ ...prev, [orderId]: { checking: true } }));

    fetch(`/api/orders/${encodeURIComponent(orderId)}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof json?.error === "string" && json.error ? json.error : "Nie udało się sprawdzić statusu.");
        if (typeof json?.status !== "string") throw new Error("Nie udało się sprawdzić statusu.");
        setOrders((prev) =>
          prev.map((row) =>
            row.id === orderId
              ? {
                  ...row,
                  status: json.status,
                  paidAt: json.paidAt ?? null,
                  invoiceStatus: json.invoiceStatus ?? row.invoiceStatus,
                  invoiceNumber: json.invoiceNumber ?? null,
                  invoicePdfUrl: json.invoicePdfUrl ?? null,
                }
              : row,
          ),
        );
        setRowChecks((prev) => ({
          ...prev,
          [orderId]: {
            checking: false,
            message:
              json.synced === true || json.status !== "PENDING_PAYMENT"
                ? "Status sprawdzony."
                : "Sprawdzono niedawno — spróbuj ponownie za kilka sekund.",
            payuRedirectUri:
              json.status === "PENDING_PAYMENT" && typeof json.payuRedirectUri === "string" ? json.payuRedirectUri : undefined,
          },
        }));
      })
      .catch((err) => {
        setRowChecks((prev) => ({
          ...prev,
          [orderId]: {
            checking: false,
            error: true,
            message: err instanceof Error && err.message ? err.message : "Nie udało się sprawdzić statusu.",
          },
        }));
      })
      .finally(() => {
        checkingRef.current.delete(orderId);
      });
  }, []);

  const scopeButtonClass = (active: boolean) =>
    `inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
      active
        ? "bg-blue-600 text-white shadow-sm shadow-blue-500/20"
        : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
    }`;

  const now = new Date();

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
        <Receipt className="h-5 w-5 text-blue-500" /> Zamówienia
      </h2>

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
        {loading ? (
          <div className="p-8 text-center text-xs text-slate-400">Pobieranie zamówień...</div>
        ) : loadError && orders.length === 0 ? (
          <div className="p-8 text-center text-xs text-red-600 dark:text-red-400">Nie udało się wczytać zamówień.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 uppercase tracking-wider dark:border-slate-800 dark:bg-slate-950/80 dark:text-slate-400">
                <tr>
                  <th className="px-5 py-3.5 font-semibold">Data</th>
                  <th className="px-5 py-3.5 font-semibold">Pozycje</th>
                  <th className="px-5 py-3.5 font-semibold">Kwota brutto</th>
                  <th className="px-5 py-3.5 font-semibold">Status</th>
                  <th className="px-5 py-3.5 font-semibold">Faktura</th>
                  <th className="px-5 py-3.5 font-semibold">Akcje</th>
                  {scope === "org" && <th className="px-5 py-3.5 font-semibold">Użytkownik</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 dark:divide-slate-800/60 dark:text-slate-300">
                {orders.length === 0 ? (
                  <tr>
                    <td colSpan={scope === "org" ? 7 : 6} className="px-5 py-8 text-center text-slate-500">
                      Brak zamówień.
                    </td>
                  </tr>
                ) : (
                  orders.map((order) => (
                    <tr key={order.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="px-5 py-4 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {new Date(order.createdAt).toLocaleString("pl-PL")}
                      </td>
                      <td className="px-5 py-4">{order.items.map(formatOrderItem).join(", ")}</td>
                      <td className="px-5 py-4 font-bold text-slate-900 dark:text-white whitespace-nowrap">
                        {formatGrosze(order.totalGrossGrosze)}
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`inline-block rounded-full px-2.5 py-1 text-[11px] font-bold whitespace-nowrap ${
                            isProformaExpired(order, now) ? EXPIRED_CLASSES : STATUS_CLASSES[order.status]
                          }`}
                        >
                          {orderStatusLabel(order, now)}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <InvoiceCell order={order} />
                      </td>
                      <td className="px-5 py-4">
                        {order.status === "PENDING_PAYMENT" && order.paymentMethod === "PAYU" && (
                          <OrderActions order={order} check={rowChecks[order.id]} onCheck={checkStatus} />
                        )}
                      </td>
                      {scope === "org" && (
                        <td className="px-5 py-4 text-slate-500 dark:text-slate-400">{order.user?.name ?? "—"}</td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {loadError && orders.length > 0 && (
        <p className="text-center text-xs text-red-600 dark:text-red-400">Nie udało się wczytać zamówień.</p>
      )}

      {nextCursor && !loading && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => loadOrders(scope, nextCursor)}
            disabled={loadingMore}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
          >
            {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
            Pokaż więcej
          </button>
        </div>
      )}
    </section>
  );
}
