"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Building2, Loader2, Receipt, User } from "lucide-react";
import { ORDER_STATUS_LABELS, formatGrosze, formatOrderItem } from "@/lib/billing/labels";

interface OrderRow {
  id: string;
  status: keyof typeof ORDER_STATUS_LABELS;
  totalGrossGrosze: number;
  createdAt: string;
  paidAt: string | null;
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

const STATUS_CLASSES: Record<OrderRow["status"], string> = {
  PENDING_PAYMENT: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  PAID: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  CANCELED: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
  FAILED: "bg-red-500/10 text-red-700 dark:text-red-400",
};

export default function OrdersList({ canViewOrg }: { canViewOrg: boolean }) {
  const [scope, setScope] = useState<Scope>("mine");
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const latestRequestId = useRef(0);

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

  const scopeButtonClass = (active: boolean) =>
    `inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
      active
        ? "bg-blue-600 text-white shadow-sm shadow-blue-500/20"
        : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
    }`;

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
                  {scope === "org" && <th className="px-5 py-3.5 font-semibold">Użytkownik</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 dark:divide-slate-800/60 dark:text-slate-300">
                {orders.length === 0 ? (
                  <tr>
                    <td colSpan={scope === "org" ? 5 : 4} className="px-5 py-8 text-center text-slate-500">
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
                          className={`inline-block rounded-full px-2.5 py-1 text-[11px] font-bold whitespace-nowrap ${STATUS_CLASSES[order.status]}`}
                        >
                          {ORDER_STATUS_LABELS[order.status]}
                        </span>
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
