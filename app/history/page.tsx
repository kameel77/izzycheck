"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { History, Search, ArrowUpRight, Car, AlertTriangle, CheckCircle2 } from "lucide-react";

function HistoryContent() {
  const searchParams = useSearchParams();
  const initialVin = searchParams.get("vin") || "";

  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState(initialVin);

  const fetchReports = (vinQuery: string) => {
    setLoading(true);
    const url = vinQuery ? `/api/reports/history?vin=${encodeURIComponent(vinQuery)}` : "/api/reports/history";
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        if (data.reports) setReports(data.reports);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchReports(initialVin);
  }, [initialVin]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchReports(searchTerm);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-3">
          <History className="h-6 w-6 text-blue-500" /> Archiwum Raportów VIN
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Przeglądaj wygenerowane raporty weryfikacji pojazdów i audytu Izzy Lease.
        </p>
      </div>

      {/* Search Bar */}
      <form onSubmit={handleSearchSubmit} className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value.toUpperCase())}
            placeholder="Filtruj po numerze VIN (np. WBA3N51030KS15173)..."
            className="w-full rounded-xl border border-slate-800 bg-slate-900 py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
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
      <div className="rounded-2xl border border-slate-800 bg-slate-900/80 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs text-slate-500">Pobieranie historii raportów...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 bg-slate-950/80 text-slate-400 uppercase tracking-wider">
                <tr>
                  <th className="px-5 py-3.5 font-semibold">Pojazd / VIN</th>
                  <th className="px-5 py-3.5 font-semibold">Data 1. Rej.</th>
                  <th className="px-5 py-3.5 font-semibold">Wycena Rynkowa</th>
                  <th className="px-5 py-3.5 font-semibold">Szkody Audatex</th>
                  <th className="px-5 py-3.5 font-semibold">Operator</th>
                  <th className="px-5 py-3.5 font-semibold">Data Sprawdzenia</th>
                  <th className="px-5 py-3.5 font-semibold text-right">Akcja</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {reports.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-8 text-center text-slate-500">
                      Brak raportów spełniających kryteria.
                    </td>
                  </tr>
                ) : (
                  reports.map((r) => {
                    const hasClaims = r.damageClaims && r.damageClaims.length > 0;
                    return (
                      <tr key={r.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="px-5 py-4 font-medium text-white">
                          <div className="space-y-0.5">
                            <span className="font-bold text-white block">
                              {r.vehicleSnapshot?.make ? `${r.vehicleSnapshot.make} ${r.vehicleSnapshot.model}` : "Sprawdzenie VIN"}
                            </span>
                            <span className="font-mono text-[11px] text-slate-400">{r.vin}</span>
                          </div>
                        </td>
                        <td className="px-5 py-4">{r.firstRegistrationDate}</td>
                        <td className="px-5 py-4 font-bold text-blue-400">
                          {r.vehicleSnapshot?.marketPriceCob ? `${r.vehicleSnapshot.marketPriceCob.toLocaleString("pl-PL")} PLN` : "—"}
                        </td>
                        <td className="px-5 py-4">
                          {hasClaims ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-red-400 border border-red-500/20">
                              <AlertTriangle className="h-3 w-3" /> Wpisy ({r.damageClaims.length})
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-400 border border-emerald-500/20">
                              <CheckCircle2 className="h-3 w-3" /> Brak wpisów
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-4 text-slate-400">{r.createdBy?.name || "Operator"}</td>
                        <td className="px-5 py-4 text-slate-400">{new Date(r.createdAt).toLocaleDateString("pl-PL")}</td>
                        <td className="px-5 py-4 text-right">
                          <Link
                            href={`/reports/${r.id}`}
                            className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-600 transition-colors"
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
