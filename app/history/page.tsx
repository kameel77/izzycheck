"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { History, Search, ArrowUpRight, AlertTriangle, CheckCircle2, Building2, User } from "lucide-react";

interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: string;
  canViewOrgReports: boolean;
  organization?: {
    id: string;
    name: string;
  } | null;
}

function HistoryContent() {
  const searchParams = useSearchParams();
  const initialVin = searchParams.get("vin") || "";

  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState(initialVin);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [activeScope, setActiveScope] = useState<"organization" | "my">("my");

  const canViewOrg = Boolean(
    currentUser?.canViewOrgReports || currentUser?.role === "MANAGER" || currentUser?.role === "ADMIN"
  );

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated && data.user) {
          const u: CurrentUser = data.user;
          setCurrentUser(u);
          if (u.role === "MANAGER" || u.role === "ADMIN" || u.canViewOrgReports) {
            setActiveScope("organization");
          }
        }
      })
      .catch(() => {});
  }, []);

  const fetchReports = (vinQuery: string, scope: "organization" | "my") => {
    setLoading(true);
    const params = new URLSearchParams();
    if (vinQuery) params.set("vin", vinQuery);
    params.set("scope", scope);

    fetch(`/api/reports/history?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.reports) setReports(data.reports);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchReports(searchTerm, activeScope);
  }, [activeScope]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchReports(searchTerm, activeScope);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-3">
          <History className="h-6 w-6 text-blue-500" /> Archiwum Raportów VIN
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Przeglądaj wygenerowane raporty weryfikacji pojazdów i audytu Izzy Lease.
        </p>
      </div>

      {/* Scope Tabs if user has organization view rights */}
      {canViewOrg && (
        <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
          <button
            type="button"
            onClick={() => setActiveScope("organization")}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
              activeScope === "organization"
                ? "bg-blue-600 text-white shadow-sm shadow-blue-500/20"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
            }`}
          >
            <Building2 className="h-3.5 w-3.5" />
            {currentUser?.role === "ADMIN" ? "Wszystkie raporty w systemie" : "Wszystkie w firmie"}
          </button>
          <button
            type="button"
            onClick={() => setActiveScope("my")}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
              activeScope === "my"
                ? "bg-blue-600 text-white shadow-sm shadow-blue-500/20"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
            }`}
          >
            <User className="h-3.5 w-3.5" />
            Moje raporty
          </button>
        </div>
      )}

      {/* Search Bar */}
      <form onSubmit={handleSearchSubmit} className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value.toUpperCase())}
            placeholder="Filtruj po numerze VIN (np. WBA3N51030KS15173)..."
            className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-white dark:placeholder-slate-500"
          />
        </div>
        <button
          type="submit"
          className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 transition-colors"
        >
          Filtruj
        </button>
      </form>

      {/* Reports Table */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
        {loading ? (
          <div className="p-8 text-center text-xs text-slate-400">Pobieranie historii raportów...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 uppercase tracking-wider dark:border-slate-800 dark:bg-slate-950/80 dark:text-slate-400">
                <tr>
                  <th className="px-5 py-3.5 font-semibold">Pojazd / VIN</th>
                  <th className="px-5 py-3.5 font-semibold">Data 1. Rej.</th>
                  <th className="px-5 py-3.5 font-semibold">Wycena Rynkowa</th>
                  <th className="px-5 py-3.5 font-semibold">Szkody Audatex</th>
                  {currentUser?.role === "ADMIN" && activeScope === "organization" && (
                    <th className="px-5 py-3.5 font-semibold">Organizacja</th>
                  )}
                  <th className="px-5 py-3.5 font-semibold">Utworzył</th>
                  <th className="px-5 py-3.5 font-semibold">Data Sprawdzenia</th>
                  <th className="px-5 py-3.5 font-semibold text-right">Akcja</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 dark:divide-slate-800/60 dark:text-slate-300">
                {reports.length === 0 ? (
                  <tr>
                    <td
                      colSpan={currentUser?.role === "ADMIN" && activeScope === "organization" ? 8 : 7}
                      className="px-5 py-8 text-center text-slate-500"
                    >
                      Brak raportów spełniających kryteria.
                    </td>
                  </tr>
                ) : (
                  reports.map((r) => {
                    const hasClaims = r.damageClaims && r.damageClaims.length > 0;
                    return (
                      <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="px-5 py-4 font-medium text-slate-900 dark:text-white">
                          <div className="space-y-0.5">
                            <span className="font-bold text-slate-900 dark:text-white block">
                              {r.vehicleSnapshot?.make ? `${r.vehicleSnapshot.make} ${r.vehicleSnapshot.model}` : "Sprawdzenie VIN"}
                            </span>
                            <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{r.vin}</span>
                          </div>
                        </td>
                        <td className="px-5 py-4">{r.firstRegistrationDate}</td>
                        <td className="px-5 py-4 font-bold text-blue-600 dark:text-blue-400">
                          {r.vehicleSnapshot?.marketPriceCob ? `${r.vehicleSnapshot.marketPriceCob.toLocaleString("pl-PL")} PLN` : "—"}
                        </td>
                        <td className="px-5 py-4">
                          {hasClaims ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-red-600 dark:text-red-400 border border-red-500/20">
                              <AlertTriangle className="h-3 w-3" /> Wpisy ({r.damageClaims.length})
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                              <CheckCircle2 className="h-3 w-3" /> Brak wpisów
                            </span>
                          )}
                        </td>
                        {currentUser?.role === "ADMIN" && activeScope === "organization" && (
                          <td className="px-5 py-4">
                            <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-1 font-mono text-[10px] font-semibold text-slate-700 dark:text-slate-300">
                              {r.organization?.name || "Brak organizacji"}
                            </span>
                          </td>
                        )}
                        <td className="px-5 py-4 text-slate-500 dark:text-slate-400">
                          <div className="space-y-0.5">
                            <span className="font-medium text-slate-900 dark:text-white block">
                              {r.createdBy?.name || "Operator"}
                            </span>
                            {r.createdBy?.email && (
                              <span className="text-[10px] text-slate-400 block">{r.createdBy.email}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-4 text-slate-500 dark:text-slate-400">{new Date(r.createdAt).toLocaleDateString("pl-PL")}</td>
                        <td className="px-5 py-4 text-right">
                          <Link
                            href={`/reports/${r.id}`}
                            className="inline-flex items-center gap-1 rounded-lg bg-slate-100 text-slate-700 hover:bg-blue-600 hover:text-white px-3 py-1.5 text-xs font-semibold dark:bg-slate-800 dark:text-white dark:hover:bg-blue-600 transition-colors"
                          >
                            Otwórz <ArrowUpRight className="h-3 w-3" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function HistoryPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-xs text-slate-500">Wczytywanie...</div>}>
      <HistoryContent />
    </Suspense>
  );
}
