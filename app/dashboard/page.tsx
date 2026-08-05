"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Car, FileText, AlertTriangle, ShieldCheck, Plus, ArrowUpRight, Search, CheckCircle2, Clock } from "lucide-react";

export default function DashboardPage() {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [quickVin, setQuickVin] = useState("");

  useEffect(() => {
    fetch("/api/reports/history")
      .then((res) => res.json())
      .then((data) => {
        if (data.reports) {
          setReports(data.reports);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const totalReports = reports.length;
  const claimsFoundCount = reports.filter((r) => r.damageClaims && r.damageClaims.length > 0).length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-r from-slate-900 via-slate-900 to-blue-950/40 p-6 sm:p-8">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full bg-blue-500/10 px-3 py-1 text-xs font-semibold text-blue-400 border border-blue-500/20">
              <ShieldCheck className="h-3.5 w-3.5" /> Środowisko Operacyjne Izzy Lease
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              Weryfikacja Wyceny i Historii Szkód VIN
            </h1>
            <p className="text-sm text-slate-400 max-w-2xl">
              Ustandaryzowane tworzenie raportów na podstawie integracji SOAP z Audatex AudaValuation 2023 oraz Claims History Engine B2B v1.23.0.
            </p>
          </div>

          <Link
            href="/reports/new"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/30 hover:bg-blue-500 transition-all shrink-0"
          >
            <Plus className="h-4 w-4" /> Uruchom Nowy Raport VIN
          </Link>
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Sprawdzonych Pojazdów</span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <Car className="h-5 w-5" />
            </div>
          </div>
          <p className="mt-3 text-3xl font-bold text-white">{totalReports}</p>
          <p className="mt-1 text-[11px] text-slate-400">Wygenerowane raporty w bazie</p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Pojazdy Ze Szkołami</span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <AlertTriangle className="h-5 w-5" />
            </div>
          </div>
          <p className="mt-3 text-3xl font-bold text-amber-400">{claimsFoundCount}</p>
          <p className="mt-1 text-[11px] text-slate-400">Potwierdzone rekordy w bazie Audatex</p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Integracje Audatex</span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          </div>
          <p className="mt-3 text-3xl font-bold text-emerald-400">WS 2023 & CHE</p>
          <p className="mt-1 text-[11px] text-slate-400">AudaValuation + SOAP v1.23.0</p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Status Środowiska</span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <Clock className="h-5 w-5" />
            </div>
          </div>
          <p className="mt-3 text-lg font-bold text-white">Przetwarzanie Serwerowe</p>
          <p className="mt-1 text-[11px] text-slate-400">SOAP wyłącznie po stronie Node.js</p>
        </div>
      </div>

      {/* Quick VIN search */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 space-y-4">
        <h2 className="text-base font-semibold text-white">Szybkie Wyszukiwanie VIN w Historii</h2>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-500" />
            <input
              type="text"
              value={quickVin}
              onChange={(e) => setQuickVin(e.target.value.toUpperCase())}
              placeholder="Wpisz numer VIN (np. WBA3N51030KS15173)"
              className="w-full rounded-xl border border-slate-800 bg-slate-950/80 py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <Link
            href={`/history?vin=${quickVin}`}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors"
          >
            Szukaj w Historii
          </Link>
        </div>
      </div>

      {/* Recent Reports Table */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 overflow-hidden space-y-4 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Ostatnie Weryfikacje VIN</h2>
            <p className="text-xs text-slate-400">Wygenerowane raporty przez operatorów Izzy Lease</p>
          </div>
          <Link href="/history" className="text-xs font-semibold text-blue-400 hover:text-blue-300 flex items-center gap-1">
            Zobacz wszystkie <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {loading ? (
          <div className="py-8 text-center text-xs text-slate-500">Ładowanie historii...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 bg-slate-950/60 text-slate-400 uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3 font-semibold">Pojazd / VIN</th>
                  <th className="px-4 py-3 font-semibold">Data 1. Rej.</th>
                  <th className="px-4 py-3 font-semibold">Wycena Rynkowa (COBv)</th>
                  <th className="px-4 py-3 font-semibold">Wynik Szkód</th>
                  <th className="px-4 py-3 font-semibold">Operator</th>
                  <th className="px-4 py-3 font-semibold text-right">Akcja</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {reports.slice(0, 5).map((r) => {
                  const hasClaims = r.damageClaims && r.damageClaims.length > 0;
                  return (
                    <tr key={r.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="px-4 py-3.5 font-medium text-white">
                        <div>
                          <span>{r.vehicleSnapshot?.make ? `${r.vehicleSnapshot.make} ${r.vehicleSnapshot.model}` : "Identyfikacja VIN"}</span>
                          <span className="block text-[11px] font-mono text-slate-400">{r.vin}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">{r.firstRegistrationDate}</td>
                      <td className="px-4 py-3.5 font-semibold text-blue-400">
                        {r.vehicleSnapshot?.marketPriceCob ? `${r.vehicleSnapshot.marketPriceCob.toLocaleString("pl-PL")} PLN` : "—"}
                      </td>
                      <td className="px-4 py-3.5">
                        {hasClaims ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2.5 py-0.5 text-[11px] font-medium text-red-400 border border-red-500/20">
                            Wpisy szkód ({r.damageClaims.length})
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400 border border-emerald-500/20">
                            Brak wpisów
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-slate-400">{r.createdBy?.name || "Operator"}</td>
                      <td className="px-4 py-3.5 text-right">
                        <Link
                          href={`/reports/${r.id}`}
                          className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-600 transition-colors"
                        >
                          Otwórz Raport <ArrowUpRight className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
