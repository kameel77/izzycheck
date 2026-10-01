"use client";

import { useEffect, useState, use, useCallback, useRef } from "react";
import Link from "next/link";
import {
  Car,
  Calendar,
  Gauge,
  DollarSign,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  FileText,
  ShieldCheck,
  Layers,
  ArrowLeft,
  Info,
  Clock,
  Printer,
  FileDown,
  RefreshCw,
  Lock,
  Loader2,
} from "lucide-react";
import { getClaimsHistoryPresentation } from "@/lib/report-claims-summary";
import { DamageClaimVisualization } from "@/components/report/DamageClaimVisualization";
import { DownloadReportPdfButton } from "@/components/report/DownloadReportPdfButton";
import { sortEquipmentAlphabetically } from "@/lib/reports/equipment";

export default function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const reportId = resolvedParams.id;

  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"valuation" | "claims" | "audit">("valuation");
  const [executingModules, setExecutingModules] = useState<Record<string, boolean>>({});
  const [freezeModalOpen, setFreezeModalOpen] = useState(false);
  const [freezeReason, setFreezeReason] = useState("");
  const [freezing, setFreezing] = useState(false);

  // Tracks whether a report was already loaded (readable inside stable callbacks without stale closures)
  const reportLoadedRef = useRef(false);
  // Last failed dispatch timestamp per module; used to back off automatic re-dispatch
  const failedAtRef = useRef<Record<string, number>>({});

  const fetchReport = useCallback(async () => {
    try {
      const res = await fetch(`/api/reports/${reportId}`);
      const data = await res.json();
      if (data.report) {
        setReport(data.report);
        reportLoadedRef.current = true;
        setError("");
      } else if (reportLoadedRef.current) {
        console.warn("Background report refresh failed", data.error);
      } else {
        setError(data.error || "Nie odnaleziono raportu w bazie.");
      }
    } catch {
      if (reportLoadedRef.current) {
        console.warn("Background report refresh failed (network error)");
      } else {
        setError("Wystąpił błąd podczas ładowania raportu z bazy danych.");
      }
    } finally {
      setLoading(false);
    }
  }, [reportId]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  // Execute a single module by calling POST /api/reports/:id/modules/:moduleId
  const executeModule = useCallback(
    async (moduleId: string) => {
      setExecutingModules((prev) => ({ ...prev, [moduleId]: true }));
      try {
        const res = await fetch(`/api/reports/${reportId}/modules/${moduleId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        if (res.ok) {
          delete failedAtRef.current[moduleId];
        } else {
          failedAtRef.current[moduleId] = Date.now();
        }
      } catch (e) {
        failedAtRef.current[moduleId] = Date.now();
        console.error(`Error executing module ${moduleId}`, e);
      } finally {
        // Refresh first, then release the local "executing" flag, so the orchestration effect
        // never sees a stale report together with executing=false (double-dispatch window).
        await fetchReport();
        setExecutingModules((prev) => ({ ...prev, [moduleId]: false }));
      }
    },
    [reportId, fetchReport]
  );

  // Progressive Orchestration Effect: dispatches PENDING modules (and RUNNING modules with a stale server lock)
  useEffect(() => {
    if (!report || report.status === "COMPLETED" || report.status === "PARTIALLY_FAILED" || report.status === "FAILED") {
      return;
    }

    const valMod = report.moduleResults?.find((m: any) => m.moduleId === "VALUATION");
    const checkMod = report.moduleResults?.find((m: any) => m.moduleId === "CLAIM_CHECK");
    const detailsMod = report.moduleResults?.find((m: any) => m.moduleId === "CLAIM_DETAILS");

    // Parallel execution of initial independent modules
    const shouldDispatch = (mod: any) => {
      if (!mod) return false;
      if (Date.now() - (failedAtRef.current[mod.moduleId] ?? 0) < 15000) return false; // back off after a failed dispatch
      return mod.status === "PENDING" || mod.isStaleLock === true;
    };

    if (shouldDispatch(valMod) && !executingModules["VALUATION"]) {
      executeModule("VALUATION");
    }

    if (shouldDispatch(checkMod) && !executingModules["CLAIM_CHECK"]) {
      executeModule("CLAIM_CHECK");
    }

    // Dependent sequential execution of CLAIM_DETAILS only after CLAIM_CHECK succeeds
    if (
      checkMod &&
      (checkMod.status === "SUCCEEDED" || checkMod.status === "NO_DATA") &&
      shouldDispatch(detailsMod) &&
      !executingModules["CLAIM_DETAILS"]
    ) {
      executeModule("CLAIM_DETAILS");
    }
  }, [report, executingModules, executeModule]);

  // Polling: while the report is PROCESSING and a requested module is PENDING/RUNNING without a local
  // execution (running in another tab/session, stale lock, or waiting in dispatch backoff), refresh every
  // 15s so stale locks get picked up and failed dispatches are eventually retried.
  const needsPolling =
    report?.status === "PROCESSING" &&
    Boolean(
      report.moduleResults?.some(
        (m: any) => (m.status === "PENDING" || m.status === "RUNNING") && !executingModules[m.moduleId]
      )
    );

  useEffect(() => {
    if (!needsPolling) return;
    const interval = setInterval(() => {
      fetchReport();
    }, 15000);
    return () => clearInterval(interval);
  }, [needsPolling, fetchReport]);

  const handleFreezeReport = async () => {
    setFreezing(true);
    try {
      const res = await fetch(`/api/reports/${reportId}/freeze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: freezeReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Nie udało się zamrozić raportu.");
      } else {
        setFreezeModalOpen(false);
        await fetchReport();
      }
    } catch {
      alert("Wystąpił błąd sieciowy podczas zatwierdzania raportu.");
    } finally {
      setFreezing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-8">
        <div className="text-center space-y-4">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-blue-500 border-t-transparent"></div>
          <p className="text-sm font-semibold text-slate-300">Wczytywanie raportu z bazy danych...</p>
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center space-y-4">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/10 text-red-400 border border-red-500/20">
          <XCircle className="h-8 w-8" />
        </div>
        <h1 className="text-xl font-bold text-white">Błąd Raportu</h1>
        <p className="text-sm text-slate-400">{error || "Nie udało się wczytać danych."}</p>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
        >
          <ArrowLeft className="h-4 w-4" /> Wróć do Pulpitu
        </Link>
      </div>
    );
  }

  const snapshot = report.vehicleSnapshot;
  const claims = report.damageClaims || [];

  const stdEquipment = snapshot?.standardEquipment ? JSON.parse(snapshot.standardEquipment) : [];
  const optEquipment = snapshot?.optionalEquipment ? JSON.parse(snapshot.optionalEquipment) : [];
  const technicalSpec = snapshot?.technicalSpecJson ? JSON.parse(snapshot.technicalSpecJson) : null;

  const valModule = report.moduleResults?.find((m: any) => m.moduleId === "VALUATION");
  const checkModule = report.moduleResults?.find((m: any) => m.moduleId === "CLAIM_CHECK");
  const detailsModule = report.moduleResults?.find((m: any) => m.moduleId === "CLAIM_DETAILS");

  const isValuationFailed = !valModule || valModule.status === "FAILED" || valModule.status === "NIEWYKONANO";

  const claimsHistoryPresentation = getClaimsHistoryPresentation({
    claimCount: claims.length,
    claimCheckStatus: checkModule?.status,
    claimDetailsStatus: detailsModule?.status,
  });
  const hasClaims = claimsHistoryPresentation === "CLAIM_DETAILS_AVAILABLE";
  const historyDetectedWithoutDetails = claimsHistoryPresentation === "HISTORY_DETECTED_DETAILS_NOT_REQUESTED";
  const historyDetectedDetailsUnavailable = claimsHistoryPresentation === "HISTORY_DETECTED_DETAILS_UNAVAILABLE";
  const noClaimsFound = claimsHistoryPresentation === "NO_HISTORY";

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* Top Navigation */}
      <div className="flex items-center justify-between">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Powrót do pulpitu
        </Link>

        <div className="flex items-center gap-3">
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
          >
            <Printer className="h-4 w-4" /> Drukuj Raport
          </button>
          <DownloadReportPdfButton reportId={report.id} vin={report.vin} />
        </div>
      </div>

      {/* Partially Failed Banner & Freeze Modal Trigger */}
      {report.status === "PARTIALLY_FAILED" && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 shrink-0">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-amber-300">Raport częściowo ukończony (Stan As-Is)</h3>
              <p className="text-xs text-amber-200/80">
                Wybrane moduły zakończyły się błędem. Możesz ponowić ich wykonanie poniżej lub zatwierdzić raport w obecnym stanie niepełnym.
              </p>
            </div>
          </div>

          <button
            onClick={() => setFreezeModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-600 hover:bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 shrink-0 shadow-lg shadow-amber-600/20 transition"
          >
            <Lock className="h-4 w-4" /> Zatwierdź i zamroź raport
          </button>
        </div>
      )}

      {/* Freeze Confirmation Modal */}
      {freezeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400">
                <Lock className="h-5 w-5" />
              </div>
              <h3 className="text-base font-bold text-white">Zatwierdzenie Raportu Niepełnego</h3>
            </div>

            <p className="text-xs text-slate-300">
              Zatwierdzenie raportu jako niepełnego (sprzedaż As-Is) spowoduje wygenerowanie i zamrożenie snapshotu PDF z widoczną adnotacją ostrzegawczą o brakujących modułach.
            </p>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-400">Uzasadnienie zatwierdzenia (wymagane min. 5 znaków):</label>
              <textarea
                value={freezeReason}
                onChange={(e) => setFreezeReason(e.target.value)}
                placeholder="np. Akceptacja klienta dla wyceny bez historii szkód..."
                className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs text-white focus:border-amber-500 focus:outline-none h-24"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setFreezeModalOpen(false)}
                disabled={freezing}
                className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800"
              >
                Anuluj
              </button>
              <button
                onClick={handleFreezeReport}
                disabled={freezing || freezeReason.trim().length < 5}
                className="inline-flex items-center gap-2 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 px-4 py-2 text-xs font-bold text-slate-950"
              >
                {freezing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                Potwierdź i Zamroź PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Header Banner */}
      <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-6 sm:p-8 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 pb-6 border-b border-slate-800">
          <div className="space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="rounded-full bg-blue-500/10 px-3 py-1 text-xs font-bold text-blue-400 border border-blue-500/20">
                {report.publicReference ? `Nr ref: ${report.publicReference}` : `Raport IzzyCheck #${report.id.substring(0, 8)}`}
              </span>
              <span className="text-xs text-slate-400">
                Data weryfikacji: {new Date(report.createdAt).toLocaleString("pl-PL")}
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                  report.status === "COMPLETED"
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    : report.status === "PARTIALLY_FAILED"
                    ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                    : "bg-red-500/10 text-red-400 border border-red-500/20"
                }`}
              >
                Status: {report.status}
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
              {snapshot?.make ? `${snapshot.make} ${snapshot.model} ${snapshot.variant || ""}` : `VIN: ${report.vin}`}
            </h1>

            <div className="flex items-center gap-4 text-xs font-mono text-slate-400 flex-wrap">
              <span className="rounded-lg bg-slate-950 px-3 py-1 font-semibold text-white border border-slate-800">
                VIN: {report.vin}
              </span>
              {snapshot?.ibsCode && (
                <span className="rounded-lg bg-slate-950 px-3 py-1 font-semibold text-slate-300 border border-slate-800">
                  IBS Code: {snapshot.ibsCode}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 bg-slate-950/70 p-4 rounded-2xl border border-slate-800">
            <div className="text-left sm:text-right">
              <span className="text-[11px] text-slate-400 block font-medium">Pobierz Certyfikowany Raport</span>
              <span className="text-xs text-slate-300 font-semibold">Niezmienny dokument PDF</span>
            </div>
            <a
              href={`/api/reports/${report.id}/pdf`}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-lg shadow-blue-500/20 transition"
              download
            >
              <FileDown className="h-4 w-4" /> Pobierz PDF
            </a>
          </div>
        </div>

        {/* Key Parameters Row */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="space-y-1">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5 text-blue-400" /> Data 1. Rejestracji
            </span>
            <p className="text-sm font-bold text-white">{report.firstRegistrationDate}</p>
          </div>

          <div className="space-y-1">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5 text-purple-400" /> Data Produkcji
            </span>
            <p className="text-sm font-bold text-white">
              {snapshot?.manufactureDate ? snapshot.manufactureDate : "Brak potwierdzenia źródła"}
            </p>
          </div>

          <div className="space-y-1">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <Gauge className="h-3.5 w-3.5 text-cyan-400" /> Kilometraż
            </span>
            <p className="text-sm font-bold text-white">
              {report.mileage ? `${report.mileage.toLocaleString("pl-PL")} km` : "Średni rynkowy (0 km)"}
            </p>
          </div>

          <div className="space-y-1">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <Clock className="h-3.5 w-3.5 text-emerald-400" /> Data Wyceny
            </span>
            <p className="text-sm font-bold text-white">{report.valuationDate}</p>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-800 space-x-4">
        <button
          onClick={() => setActiveTab("valuation")}
          className={`flex items-center gap-2 pb-3 px-1 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === "valuation"
              ? "border-blue-500 text-white"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <DollarSign className="h-4 w-4" /> Wycena i Wyposażenie (WS 2023)
        </button>

        <button
          onClick={() => setActiveTab("claims")}
          className={`flex items-center gap-2 pb-3 px-1 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === "claims"
              ? "border-blue-500 text-white"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <AlertTriangle className="h-4 w-4" /> Historia & Szczegóły Szkód ({historyDetectedWithoutDetails || historyDetectedDetailsUnavailable ? "wpisy wykryte" : claims.length})
        </button>

        <button
          onClick={() => setActiveTab("audit")}
          className={`flex items-center gap-2 pb-3 px-1 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === "audit"
              ? "border-blue-500 text-white"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <Layers className="h-4 w-4" /> Ślad Audytowy
        </button>
      </div>

      {/* TAB 1: VALUATION & EQUIPMENT */}
      {activeTab === "valuation" && (
        <div className="space-y-8">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-white">Wartości Pojazdu z AudaValuation</h2>
              <div className="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-400 border border-amber-500/20">
                <Info className="h-3.5 w-3.5" /> Wartości podane w przykładach dokumentacji BEZ VAT (netto)
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 space-y-2">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Cena Nowego (CVv)</span>
                <p className="text-3xl font-extrabold text-white">
                  {snapshot?.newPriceCv ? `${snapshot.newPriceCv.toLocaleString("pl-PL")} PLN netto` : "Brak danych"}
                </p>
                <p className="text-[11px] text-slate-400">Nowy pojazd z wyposażeniem opcjonalnym (bez VAT)</p>
              </div>

              <div className="rounded-2xl border border-blue-500/30 bg-blue-950/30 p-6 space-y-2 relative overflow-hidden">
                <span className="text-xs font-semibold text-blue-400 uppercase tracking-wider">Cena Rynkowa (COBv)</span>
                <p className="text-3xl font-extrabold text-blue-400">
                  {snapshot?.marketPriceCob ? `${snapshot.marketPriceCob.toLocaleString("pl-PL")} PLN netto` : "Brak danych"}
                </p>
                <p className="text-[11px] text-slate-300">Bieżąca wartość rynkowa netto (bez VAT)</p>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 space-y-2">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Wartość Techniczna (THv)</span>
                <p className="text-3xl font-extrabold text-emerald-400">
                  {snapshot?.technicalValueTh ? `${snapshot.technicalValueTh.toLocaleString("pl-PL")} PLN netto` : "Brak danych"}
                </p>
                <p className="text-[11px] text-slate-400">Wartość techniczna netto (bez VAT) wyliczona przez Audatex</p>
              </div>
            </div>
          </div>

          {/* Technical Specifications Card */}
          {technicalSpec && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Car className="h-4 w-4 text-blue-400" /> Specyfikacja Techniczna Pojazdu
                </h3>
                <span className="text-[11px] font-medium text-slate-400 bg-slate-950 px-2.5 py-1 rounded-full border border-slate-800">
                  Audatex Classification
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 text-xs">
                <div className="space-y-1 p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
                  <span className="text-slate-400 font-semibold uppercase text-[10px]">Pojemność silnika</span>
                  <p className="text-sm font-bold text-white">
                    {technicalSpec.engineCapacityCm3 ? `${technicalSpec.engineCapacityCm3.toLocaleString("pl-PL")} cm³` : "Brak danych"}
                  </p>
                </div>

                <div className="space-y-1 p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
                  <span className="text-slate-400 font-semibold uppercase text-[10px]">Moc silnika</span>
                  <p className="text-sm font-bold text-white">
                    {technicalSpec.enginePowerKw && technicalSpec.enginePowerHp
                      ? `${technicalSpec.enginePowerKw} kW (${technicalSpec.enginePowerHp} KM${technicalSpec.isEnginePowerHpCalculated ? " — przeliczone" : ""})`
                      : technicalSpec.enginePowerKw
                      ? `${technicalSpec.enginePowerKw} kW`
                      : technicalSpec.enginePowerHp
                      ? `${technicalSpec.enginePowerHp} KM`
                      : "Brak danych"}
                  </p>
                </div>

                <div className="space-y-1 p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
                  <span className="text-slate-400 font-semibold uppercase text-[10px]">Paliwo / Napęd</span>
                  <p className="text-sm font-bold text-white">
                    {[technicalSpec.fuelType, technicalSpec.driveType].filter(Boolean).join(" / ") || "Brak danych"}
                  </p>
                </div>

                <div className="space-y-1 p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
                  <span className="text-slate-400 font-semibold uppercase text-[10px]">Skrzynia biegów</span>
                  <p className="text-sm font-bold text-white">
                    {technicalSpec.gearboxType ? `${technicalSpec.gearboxType}${technicalSpec.gearCount ? ` (${technicalSpec.gearCount} biegów)` : ""}` : "Brak danych"}
                  </p>
                </div>

                <div className="space-y-1 p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
                  <span className="text-slate-400 font-semibold uppercase text-[10px]">Nadwozie / Miejsca</span>
                  <p className="text-sm font-bold text-white">
                    {[technicalSpec.bodyType, technicalSpec.seatsCount ? `${technicalSpec.seatsCount} miejsc` : undefined].filter(Boolean).join(" / ") || "Brak danych"}
                  </p>
                </div>

                <div className="space-y-1 p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
                  <span className="text-slate-400 font-semibold uppercase text-[10px]">Masa własna / DMC</span>
                  <p className="text-sm font-bold text-white">
                    {technicalSpec.curbWeightKg ? `${technicalSpec.curbWeightKg} kg / ${technicalSpec.grossWeightKg || "—"} kg` : "Brak danych"}
                  </p>
                </div>

                <div className="space-y-1 p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
                  <span className="text-slate-400 font-semibold uppercase text-[10px]">Wymiary (Dł/Szer/Wys)</span>
                  <p className="text-sm font-bold text-white">
                    {technicalSpec.lengthMm ? `${technicalSpec.lengthMm} x ${technicalSpec.widthMm} x ${technicalSpec.heightMm} mm` : "Brak danych"}
                  </p>
                </div>

                <div className="space-y-1 p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
                  <span className="text-slate-400 font-semibold uppercase text-[10px]">Koła / Emisja</span>
                  <p className="text-sm font-bold text-white">
                    {[technicalSpec.wheelSize, technicalSpec.emissionStandard].filter(Boolean).join(" / ") || "Brak danych"}
                  </p>
                </div>
              </div>

              {/* Unmapped Raw Attributes Fallback */}
              {technicalSpec.rawAttributes && Object.keys(technicalSpec.rawAttributes).length > 0 && (
                <div className="pt-3 border-t border-slate-800/80 space-y-2">
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                    Pozostałe parametry od Audatex
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 text-xs">
                    {Object.entries(technicalSpec.rawAttributes).map(([k, v]) => (
                      <div key={k} className="p-2 rounded-lg bg-slate-950/40 border border-slate-800/50">
                        <span className="text-[10px] text-slate-500 font-mono block">{k}</span>
                        <span className="text-xs font-medium text-slate-300">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Equipment Sections */}
          <div className="space-y-6">
            {/* Optional Equipment & Packages Card */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Layers className="h-4 w-4 text-blue-400" /> Wyposażenie Dodatkowe & Pakiety
                </h3>
                <span className="rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-semibold text-blue-400 border border-blue-500/20">
                  {sortEquipmentAlphabetically(optEquipment).length} pozycji
                </span>
              </div>

              {isValuationFailed ? (
                <div className="p-3 rounded-xl bg-red-950/30 border border-red-800/40 text-xs text-red-400 flex items-center gap-2">
                  <XCircle className="h-4 w-4 shrink-0" />
                  <span>Moduł wyceny nie został wykonany</span>
                </div>
              ) : sortEquipmentAlphabetically(optEquipment).length === 0 ? (
                <p className="text-xs text-slate-500 italic py-2">
                  Brak zarejestrowanego wyposażenia opcjonalnego w Audatex.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {sortEquipmentAlphabetically(optEquipment).map((eq: any, idx: number) => (
                    <div
                      key={idx}
                      className="p-3 rounded-xl bg-blue-950/20 border border-blue-800/40 flex items-center justify-between gap-2"
                    >
                      <span className="font-medium text-xs text-blue-200">{eq.name}</span>
                      {eq.code && (
                        <span className="font-mono text-[10px] text-blue-400 bg-blue-900/40 px-2 py-0.5 rounded shrink-0 border border-blue-700/40">
                          {eq.code}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Standard Equipment 3-Column Alphabetical Grid */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Car className="h-4 w-4 text-slate-400" /> Wyposażenie Standardowe
                </h3>
                <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-semibold text-slate-300">
                  {sortEquipmentAlphabetically(stdEquipment).length} pozycji
                </span>
              </div>

              {isValuationFailed ? (
                <div className="p-3 rounded-xl bg-red-950/30 border border-red-800/40 text-xs text-red-400 flex items-center gap-2">
                  <XCircle className="h-4 w-4 shrink-0" />
                  <span>Moduł wyceny nie został wykonany</span>
                </div>
              ) : sortEquipmentAlphabetically(stdEquipment).length === 0 ? (
                <p className="text-xs text-slate-500 italic py-2">
                  Audatex nie zwrócił pozycji wyposażenia.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs text-slate-300">
                  {sortEquipmentAlphabetically(stdEquipment).map((eq: any, idx: number) => (
                    <div
                      key={idx}
                      className="p-2.5 rounded-lg bg-slate-950/50 border border-slate-800/60 flex items-center justify-between gap-2"
                    >
                      <span className="text-slate-200">{eq.name}</span>
                      {eq.code && (
                        <span className="font-mono text-[10px] text-slate-500 bg-slate-900 px-1.5 py-0.5 rounded shrink-0">
                          {eq.code}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: CLAIMS & DAMAGE DETAILS */}
      {activeTab === "claims" && (
        <div className="space-y-8">
          {hasClaims ? (
            <div className="rounded-2xl border border-red-500/30 bg-red-950/20 p-6 flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/20 text-red-400 shrink-0">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-red-400">Znaleziono Wpisy Historii Szkód</h2>
                <p className="text-xs text-slate-300">
                  Baza Audatex Claims History Engine zawiera {claims.length} zarejestrowane zdarzenia dla tego pojazdu.
                </p>
              </div>
            </div>
          ) : historyDetectedWithoutDetails ? (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-6 flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/20 text-amber-400 shrink-0">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-amber-400">Wykryto wpisy historii szkód</h2>
                <p className="text-xs text-slate-300">
                  Usługa `hasHistory` potwierdziła wpisy dla tego VIN. Nie wybrano jednak Modułu 3 (`getDetails`), dlatego raport nie zawiera liczby ani szczegółów szkód.
                </p>
                <p className="text-[11px] text-slate-400 pt-1">
                  Aby pobrać szczegóły, utwórz nowy raport z zaznaczonym Modułem 3: Szczegóły Szkód.
                </p>
              </div>
            </div>
          ) : historyDetectedDetailsUnavailable ? (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-6 flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/20 text-amber-400 shrink-0">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-amber-400">Wykryto wpisy historii szkód</h2>
                <p className="text-xs text-slate-300">
                  Wykryto wpisy historii szkód w bazie Audatex. Szczegóły zdarzeń nie są dostępne w tym raporcie.
                </p>
              </div>
            </div>
          ) : noClaimsFound ? (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-6 flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-400 shrink-0">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-emerald-400">Brak Wpisów Szkód w Bazie Audatex</h2>
                <p className="text-xs text-slate-300">
                  Usługa `hasHistory` nie odnalazła wpisów szkód dla przekazanego VIN i parametrów rejestracji.
                </p>
                <p className="text-[11px] text-slate-400 pt-1">
                  * Zgodnie z wytycznymi PRD: brak wpisów odnosi się wyłącznie do zasobów Audatex i nie jest deklaracją bezszkodowości poza tą bazą.
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 text-xs text-slate-400">
              Moduł historii szkód nie został wybrany lub nie przyniósł wyników.
            </div>
          )}

          {hasClaims && (
            <div className="space-y-6">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">Chronologiczny Wykaz Szkód</h3>

              <div className="space-y-6">
                {claims.map((c: any, index: number) => {
                  const affectedZonesList = c.damageZones ? JSON.parse(c.damageZones) : [];
                  const sigPartsList = c.significantParts ? JSON.parse(c.significantParts) : [];

                  return (
                    <div key={c.id || index} className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 space-y-6">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-800">
                        <div className="space-y-1">
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-bold text-white">Szkoda #{index + 1}</span>
                            {c.isTotalLoss && (
                              <span className="rounded-full bg-red-600 px-2.5 py-0.5 text-[10px] font-black uppercase text-white tracking-widest animate-pulse">
                                SZKODA CAŁKOWITA
                              </span>
                            )}
                            <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-mono text-slate-300">
                              Kraj: {c.country || "PL"}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400">Identyfikator rekordu: {c.claimId}</p>
                        </div>

                        <div className="text-left sm:text-right">
                          <span className="text-[11px] text-slate-400 block">Wartość Szkody</span>
                          <span className="text-xl font-black text-red-400">
                            {c.damageValue ? `${c.damageValue.toLocaleString("pl-PL")} ${c.currency || "PLN"}` : "Brak kwoty"}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 text-xs">
                        <div>
                          <span className="text-[11px] text-slate-400 block">Data Zdarzenia</span>
                          <span className="font-semibold text-white">{c.accidentDate || "Brak danych"}</span>
                        </div>
                        <div>
                          <span className="text-[11px] text-slate-400 block">Przebieg Zgłoszony</span>
                          <span className="font-semibold text-white">{c.mileage ? `${c.mileage.toLocaleString("pl-PL")} km` : "Brak danych"}</span>
                        </div>
                        <div>
                          <span className="text-[11px] text-slate-400 block">Kod Mandatu</span>
                          <span className="font-mono font-bold text-amber-400">{c.mandateCode || "—"}</span>
                        </div>
                        <div>
                          <span className="text-[11px] text-slate-400 block">Kwalifikacja Mandatu</span>
                          <span className="font-semibold text-slate-200">{c.mandateDescription || "Brak opisu"}</span>
                        </div>
                      </div>

                      {/* Audatex Damage Visualization Section */}
                      <DamageClaimVisualization
                        claim={c}
                        vehicleMakeModel={snapshot?.make ? `${snapshot.make} ${snapshot.model || ""}` : undefined}
                        bodyType={technicalSpec?.bodyType}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: AUDIT TRAIL */}
      {activeTab === "audit" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 space-y-6">
            <h3 className="text-sm font-bold uppercase tracking-wider text-white">Ślad Audytowy Wykonania Integracji</h3>

            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  { name: "AudaValuation WS 2023", mod: valModule, id: "VALUATION" },
                  { name: "Claims History `hasHistory`", mod: checkModule, id: "CLAIM_CHECK" },
                  { name: "Claims History `getDetails`", mod: detailsModule, id: "CLAIM_DETAILS" },
                ].map(({ name, mod, id }) => {
                  const status = mod?.status || "NOT_REQUESTED";
                  const isExecuting = executingModules[id];
                  const canRetry = status === "FAILED" && !mod?.isNonRetryable && (mod?.retryCount || 0) < 3;

                  return (
                    <div key={id} className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-3 flex flex-col justify-between">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400 font-semibold block">{name}</span>
                          {mod && (
                            <span className="font-mono text-[10px] text-slate-500 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                              próby: {mod.retryCount || 0}/3
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 text-xs font-bold">
                          {status === "SUCCEEDED" && (
                            <span className="text-emerald-400 flex items-center gap-1">
                              <CheckCircle2 className="h-4 w-4" /> SUCCEEDED
                            </span>
                          )}
                          {status === "NO_DATA" && (
                            <span className="text-cyan-400 flex items-center gap-1">
                              <Info className="h-4 w-4" /> NO_DATA (Brak wpisów)
                            </span>
                          )}
                          {(status === "RUNNING" || isExecuting) && (
                            <span className="text-blue-400 flex items-center gap-1">
                              <Loader2 className="h-4 w-4 animate-spin" /> RUNNING (Przetwarzanie...)
                            </span>
                          )}
                          {status === "PENDING" && !isExecuting && (
                            <span className="text-amber-400 flex items-center gap-1">
                              <Clock className="h-4 w-4" /> PENDING (Oczekuje)
                            </span>
                          )}
                          {status === "FAILED" && (
                            <span className="text-red-400 flex items-center gap-1">
                              <XCircle className="h-4 w-4" /> FAILED
                            </span>
                          )}
                          {status === "NOT_REQUESTED" && (
                            <span className="text-slate-500 flex items-center gap-1">
                              NOT_REQUESTED
                            </span>
                          )}
                        </div>

                        {mod?.errorMessage && (
                          <p className="text-[11px] text-red-400 break-words bg-red-950/30 p-2 rounded-lg border border-red-900/40">
                            {mod.errorMessage}
                          </p>
                        )}

                        {mod?.isNonRetryable && (
                          <span className="inline-block text-[10px] font-semibold text-red-400 bg-red-950/50 px-2 py-0.5 rounded border border-red-800/50">
                            Błąd nienaprawialny (brak możliwości ponowienia)
                          </span>
                        )}

                        {status === "FAILED" && (mod?.retryCount || 0) >= 3 && (
                          <span className="inline-block text-[10px] font-semibold text-amber-400 bg-amber-950/50 px-2 py-0.5 rounded border border-amber-800/50">
                            Wyczerpano limit 3 ponowień
                          </span>
                        )}
                      </div>

                      {canRetry && (
                        <button
                          onClick={() => executeModule(id)}
                          disabled={isExecuting}
                          className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 py-1.5 px-3 text-xs font-bold text-white transition shadow"
                        >
                          {isExecuting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                          Ponów moduł
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-400 space-y-1">
                <p className="font-semibold text-slate-300">Zgodność z RODO & PRD:</p>
                <p>Surowe parametry XML SOAP są parsowane wyłącznie po stronie serwera i nie są utrwalane w przeglądarce.</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
