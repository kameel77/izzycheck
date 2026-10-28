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
  Coins,
} from "lucide-react";
import { getClaimsHistoryPresentation } from "@/lib/report-claims-summary";
import { DamageClaimVisualization } from "@/components/report/DamageClaimVisualization";
import { DownloadReportPdfButton } from "@/components/report/DownloadReportPdfButton";
import { sortEquipmentAlphabetically } from "@/lib/reports/equipment";
import {
  filterRawAttributes,
  formatBodyType,
  formatMandateDescription,
  entryCountLabel,
  claimCountGenitive,
  formatDamageGrossRange,
  formatAmount,
  DAMAGE_GROSS_CAPTION,
} from "@/lib/pdf/pdf-format";
import { dedupeRawClaims } from "@/lib/reports/claim-dedup";

const VAT_RATE = 0.23;

function formatUserFriendlyError(rawMessage?: string | null): string {
  if (!rawMessage) {
    return "Nie udało się pobrać danych dla tej sekcji raportu.";
  }
  const cleaned = rawMessage
    .replace(/^AUDATEX_[A-Z_]+:\s*/i, "")
    .trim();

  if (
    cleaned.includes("sklasyfikowany") ||
    cleaned.includes("IBSCode") ||
    cleaned.includes("HTTP 500") ||
    cleaned.includes("Błąd komunikacji z serwisem wycen")
  ) {
    return "Pojazd nie mógł zostać sklasyfikowany w katalogu wycen dla podanego numeru VIN i daty pierwszej rejestracji (np. wersja z importu spoza UE lub nietypowa konfiguracja).";
  }

  if (cleaned.includes("Błąd serwera historii szkód") || cleaned.includes("SOAP CHE")) {
    return "System historii szkód jest chwilowo niedostępny. Spróbuj ponowić pobranie danych za chwilę.";
  }

  if (cleaned.includes("limit czasu oczekiwania") || cleaned.includes("TIMEOUT")) {
    return "Przekroczono czas oczekiwania na odpowiedź systemu zewnętrznego. Spróbuj ponowić pobranie danych.";
  }

  return cleaned.replace(/\s*\(HTTP \d+\)\.?$/i, ".");
}

function formatReportStatusLabel(status?: string): string {
  switch (status) {
    case "COMPLETED":
      return "Gotowy";
    case "PARTIALLY_FAILED":
      return "Częściowy";
    case "PROCESSING":
      return "W trakcie generowania";
    case "FAILED":
      return "Nieudany";
    default:
      return status || "—";
  }
}

export default function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const reportId = resolvedParams.id;

  const [report, setReport] = useState<any>(null);
  const [viewerRole, setViewerRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"valuation" | "claims" | "audit">("valuation");
  const [priceDisplayMode, setPriceDisplayMode] = useState<"net" | "gross">("net");
  const [executingModules, setExecutingModules] = useState<Record<string, boolean>>({});
  const [freezeModalOpen, setFreezeModalOpen] = useState(false);
  const [freezeReason, setFreezeReason] = useState("");
  const [freezing, setFreezing] = useState(false);
  // Modules the API refused with 402 NO_CREDITS: no automatic re-dispatch until the user resumes or skips them
  const [creditBlocked, setCreditBlocked] = useState<Record<string, { creditType: string; message: string }>>({});
  const [skippingModules, setSkippingModules] = useState<Record<string, boolean>>({});

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
        if (data.viewerRole) {
          setViewerRole(data.viewerRole);
        }
        reportLoadedRef.current = true;
        setError("");
      } else if (reportLoadedRef.current) {
        console.warn("Background report refresh failed", data.error);
      } else {
        setError(data.error || "Nie odnaleziono wybranego raportu.");
      }
    } catch {
      if (reportLoadedRef.current) {
        console.warn("Background report refresh failed (network error)");
      } else {
        setError("Nie udało się wczytać raportu. Sprawdź połączenie z internetem i odśwież stronę.");
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
          const data = await res.json().catch(() => null);
          if (res.status === 402 && data?.code === "NO_CREDITS") {
            setCreditBlocked((prev) => ({
              ...prev,
              [moduleId]: { creditType: data.creditType, message: data.error },
            }));
          } else {
            failedAtRef.current[moduleId] = Date.now();
          }
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
      if (creditBlocked[mod.moduleId]) return false; // waiting for the user to buy credits or skip the module
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
  }, [report, executingModules, executeModule, creditBlocked]);

  // Polling: while the report is PROCESSING and a requested module is PENDING/RUNNING without a local
  // execution (running in another tab/session, stale lock, or waiting in dispatch backoff), refresh every
  // 15s so stale locks get picked up and failed dispatches are eventually retried.
  const needsPolling =
    report?.status === "PROCESSING" &&
    Boolean(
      report.moduleResults?.some(
        (m: any) =>
          (m.status === "PENDING" || m.status === "RUNNING") &&
          !executingModules[m.moduleId] &&
          !creditBlocked[m.moduleId]
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
        alert(data.error || "Nie udało się zatwierdzić raportu.");
      } else {
        setFreezeModalOpen(false);
        await fetchReport();
      }
    } catch {
      alert("Wystąpił błąd połączenia podczas zatwierdzania raportu.");
    } finally {
      setFreezing(false);
    }
  };

  const handleResumeModule = (moduleId: string) => {
    setCreditBlocked((prev) => {
      const next = { ...prev };
      delete next[moduleId];
      return next;
    });
    delete failedAtRef.current[moduleId];
    executeModule(moduleId);
  };

  const handleSkipModule = async (moduleId: string) => {
    if (!window.confirm("Pominąć ten moduł? Raport zostanie ukończony bez niego, a kredyt nie zostanie pobrany.")) {
      return;
    }
    setSkippingModules((prev) => ({ ...prev, [moduleId]: true }));
    try {
      const res = await fetch(`/api/reports/${reportId}/modules/${moduleId}/skip`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        alert(data?.error || "Nie udało się pominąć modułu.");
      } else {
        setCreditBlocked((prev) => {
          const next = { ...prev };
          delete next[moduleId];
          return next;
        });
      }
      await fetchReport();
    } catch {
      alert("Wystąpił błąd połączenia podczas pomijania modułu.");
    } finally {
      setSkippingModules((prev) => ({ ...prev, [moduleId]: false }));
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-8">
        <div className="text-center space-y-4">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-blue-500 border-t-transparent"></div>
          <p className="text-sm font-semibold text-slate-300">Wczytywanie raportu...</p>
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center space-y-4">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/20">
          <XCircle className="h-8 w-8" />
        </div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">Nie można wyświetlić raportu</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">{error || "Nie udało się wczytać danych."}</p>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 rounded-xl bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 px-4 py-2 text-sm font-semibold transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Wróć do Pulpitu
        </Link>
      </div>
    );
  }

  const snapshot = report.vehicleSnapshot;
  const rawClaims = report.damageClaims || [];
  // Assessments of one accident are merged / marked as probably the same claim (same rules as the PDF).
  const dedup = dedupeRawClaims<any>(rawClaims);
  const claims = dedup.items;
  const hasProbableClaims = dedup.likelyEventsCount < dedup.entriesCount;
  const hasMergedClaims = dedup.items.some((i) => i.dedupKind === "MERGED");

  const stdEquipment = snapshot?.standardEquipment ? JSON.parse(snapshot.standardEquipment) : [];
  const optEquipment = snapshot?.optionalEquipment ? JSON.parse(snapshot.optionalEquipment) : [];
  const technicalSpec = snapshot?.technicalSpecJson ? JSON.parse(snapshot.technicalSpecJson) : null;

  const valModule = report.moduleResults?.find((m: any) => m.moduleId === "VALUATION");
  const checkModule = report.moduleResults?.find((m: any) => m.moduleId === "CLAIM_CHECK");
  const detailsModule = report.moduleResults?.find((m: any) => m.moduleId === "CLAIM_DETAILS");

  const isValuationFailed = !valModule || valModule.status === "FAILED" || valModule.status === "NOT_REQUESTED" || valModule.status === "NIEWYKONANO";
  const isAdmin = viewerRole === "ADMIN";

  const failedModules = [
    { label: "Wycena i wyposażenie pojazdu", mod: valModule, id: "VALUATION" },
    { label: "Sprawdzenie historii szkód", mod: checkModule, id: "CLAIM_CHECK" },
    { label: "Szczegółowy wykaz szkód", mod: detailsModule, id: "CLAIM_DETAILS" },
  ].filter((item) => item.mod?.status === "FAILED");

  const creditBlockedModules = [
    { label: "Wycena i wyposażenie pojazdu", mod: valModule, id: "VALUATION" },
    { label: "Szczegółowy wykaz szkód", mod: detailsModule, id: "CLAIM_DETAILS" },
  ].filter(
    (item) =>
      creditBlocked[item.id] &&
      (item.mod?.status === "PENDING" || item.mod?.status === "FAILED" || item.mod?.status === "RUNNING")
  );

  const claimsHistoryPresentation = getClaimsHistoryPresentation({
    claimCount: claims.length,
    claimCheckStatus: checkModule?.status,
    claimDetailsStatus: detailsModule?.status,
  });
  const hasClaims = claimsHistoryPresentation === "CLAIM_DETAILS_AVAILABLE";
  const historyDetectedWithoutDetails = claimsHistoryPresentation === "HISTORY_DETECTED_DETAILS_NOT_REQUESTED";
  const historyDetectedDetailsUnavailable = claimsHistoryPresentation === "HISTORY_DETECTED_DETAILS_UNAVAILABLE";
  const noClaimsFound = claimsHistoryPresentation === "NO_HISTORY";

  const formatPriceValue = (val: number) =>
    val.toLocaleString("pl-PL", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  const renderValuationPrice = (netValue: number | null | undefined, primaryColorClass: string) => {
    if (typeof netValue !== "number" || netValue <= 0) {
      return <p className="text-2xl font-bold text-slate-400 dark:text-slate-500">Brak danych</p>;
    }
    const grossValue = Math.round(netValue * (1 + VAT_RATE) * 100) / 100;
    const primaryAmount = priceDisplayMode === "net" ? netValue : grossValue;
    const primaryLabel = priceDisplayMode === "net" ? "PLN netto" : "PLN brutto";
    const secondaryAmount = priceDisplayMode === "net" ? grossValue : netValue;
    const secondaryLabel = priceDisplayMode === "net" ? "PLN brutto" : "PLN netto";

    return (
      <div className="space-y-1">
        <p className={`text-3xl font-extrabold ${primaryColorClass}`}>
          {formatPriceValue(primaryAmount)} {primaryLabel}
        </p>
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
          ({formatPriceValue(secondaryAmount)} {secondaryLabel})
        </p>
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* Top Navigation */}
      <div className="flex items-center justify-between">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Powrót do pulpitu
        </Link>

        <div className="flex items-center gap-3">
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white transition-colors"
          >
            <Printer className="h-4 w-4" /> Drukuj Raport
          </button>
          <DownloadReportPdfButton reportId={report.id} vin={report.vin} />
        </div>
      </div>

      {/* No-credits banner: the module waits for purchased credits (resume) or is skipped */}
      {creditBlockedModules.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 flex items-start gap-3">
          <div className="p-2 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0">
            <Coins className="h-5 w-5" />
          </div>
          <div className="space-y-3 flex-1">
            <h3 className="text-sm font-bold text-amber-800 dark:text-amber-300">Brak kredytów</h3>
            <ul className="space-y-3 text-xs text-amber-900/90 dark:text-amber-200/90">
              {creditBlockedModules.map(({ label, id }) => {
                const isExecuting = executingModules[id];
                const isSkipping = skippingModules[id];
                return (
                  <li key={id} className="space-y-2">
                    <p>
                      <strong className="font-semibold">{label}:</strong> {creditBlocked[id].message}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href="/credits"
                        className="inline-flex items-center gap-1 rounded-lg bg-amber-600 hover:bg-amber-500 px-3 py-1.5 text-[11px] font-bold text-white transition"
                      >
                        <Coins className="h-3 w-3" /> Dokup kredyty
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleResumeModule(id)}
                        disabled={isExecuting || isSkipping}
                        className="inline-flex items-center gap-1 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 px-3 py-1.5 text-[11px] font-bold text-amber-900 dark:text-amber-200 transition disabled:opacity-50"
                      >
                        {isExecuting ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                        Wznów
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSkipModule(id)}
                        disabled={isExecuting || isSkipping}
                        className="inline-flex items-center gap-1 rounded-lg border border-amber-600/30 hover:bg-amber-600/10 px-3 py-1.5 text-[11px] font-bold text-amber-900 dark:text-amber-200 transition disabled:opacity-50"
                      >
                        {isSkipping && <Loader2 className="h-3 w-3 animate-spin" />}
                        Pomiń ten moduł
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {/* User-Friendly Notification Banner when Report is Partially Failed or Failed */}
      {(report.status === "PARTIALLY_FAILED" || report.status === "FAILED") && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-sm font-bold text-amber-800 dark:text-amber-300">
                {report.status === "FAILED"
                  ? "Nie udało się pobrać danych dla tego pojazdu"
                  : "Nie wszystkie dane raportu udało się pobrać"}
              </h3>
              {failedModules.length > 0 ? (
                <ul className="space-y-1 text-xs text-amber-900/90 dark:text-amber-200/90">
                  {failedModules.map(({ label, mod, id }) => {
                    const canRetry = !mod?.isNonRetryable && (mod?.retryCount || 0) < 3;
                    const isExecuting = executingModules[id];
                    return (
                      <li key={id} className="flex flex-wrap items-center gap-2">
                        <span>
                          <strong className="font-semibold">{label}:</strong>{" "}
                          {formatUserFriendlyError(mod?.errorMessage)}
                        </span>
                        {canRetry && (
                          <button
                            type="button"
                            onClick={() => executeModule(id)}
                            disabled={isExecuting}
                            className="inline-flex items-center gap-1 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 px-2.5 py-1 text-[11px] font-bold text-amber-900 dark:text-amber-200 transition disabled:opacity-50"
                          >
                            {isExecuting ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3 w-3" />
                            )}
                            Spróbuj ponownie
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-xs text-amber-800/80 dark:text-amber-200/80">
                  Część informacji nie była dostępna w katalogu zewnętrznym dla tego numeru VIN.
                </p>
              )}
            </div>
          </div>

          {report.status === "PARTIALLY_FAILED" && (
            <button
              onClick={() => setFreezeModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-600 hover:bg-amber-500 px-4 py-2 text-xs font-bold text-white shrink-0 shadow-lg shadow-amber-600/20 transition"
            >
              <Lock className="h-4 w-4" /> Zatwierdź niepełny raport
            </button>
          )}
        </div>
      )}

      {/* Freeze Confirmation Modal */}
      {freezeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 space-y-4 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400">
                <Lock className="h-5 w-5" />
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Zatwierdzenie niepełnego raportu</h3>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300">
              Zatwierdzenie raportu pozwoli na zapisanie i pobranie dokumentu PDF z dotychczas pobranymi informacjami (z adnotacją o niedostępnej części danych).
            </p>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-400">Powód zatwierdzenia (wymagane min. 5 znaków):</label>
              <textarea
                value={freezeReason}
                onChange={(e) => setFreezeReason(e.target.value)}
                placeholder="np. Raport historii szkód wystarczający do weryfikacji pojazdu..."
                className="w-full rounded-xl border border-slate-300 bg-slate-50 p-3 text-xs text-slate-900 placeholder-slate-400 focus:border-amber-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:placeholder-slate-600 dark:focus:bg-slate-950 h-24"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setFreezeModalOpen(false)}
                disabled={freezing}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Anuluj
              </button>
              <button
                onClick={handleFreezeReport}
                disabled={freezing || freezeReason.trim().length < 5}
                className="inline-flex items-center gap-2 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 px-4 py-2 text-xs font-bold text-white"
              >
                {freezing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                Zatwierdź i wygeneruj PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Header Banner */}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8 space-y-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/90">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 pb-6 border-b border-slate-200 dark:border-slate-800">
          <div className="space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="rounded-full bg-blue-500/10 px-3 py-1 text-xs font-bold text-blue-600 dark:text-blue-400 border border-blue-500/20">
                {report.publicReference ? `Nr ref: ${report.publicReference}` : `Raport IzzyCheck #${report.id.substring(0, 8)}`}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Data weryfikacji: {new Date(report.createdAt).toLocaleString("pl-PL")}
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                  report.status === "COMPLETED"
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                    : report.status === "PARTIALLY_FAILED" || report.status === "PROCESSING"
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                    : "bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20"
                }`}
              >
                Status: {formatReportStatusLabel(report.status)}
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
              {snapshot?.make ? `${snapshot.make} ${snapshot.model} ${snapshot.variant || ""}` : `VIN: ${report.vin}`}
            </h1>

            <div className="flex items-center gap-4 text-xs font-mono text-slate-500 dark:text-slate-400 flex-wrap">
              <span className="rounded-lg bg-slate-100 px-3 py-1 font-semibold text-slate-900 border border-slate-200 dark:bg-slate-950 dark:text-white dark:border-slate-800">
                VIN: {report.vin}
              </span>
              {snapshot?.ibsCode && (
                <span className="rounded-lg bg-slate-100 px-3 py-1 font-semibold text-slate-700 border border-slate-200 dark:bg-slate-950 dark:text-slate-300 dark:border-slate-800">
                  IBS Code: {snapshot.ibsCode}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Key Parameters Row */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="space-y-1">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" /> Data 1. Rejestracji
            </span>
            <p className="text-sm font-bold text-slate-900 dark:text-white">{report.firstRegistrationDate}</p>
          </div>

          <div className="space-y-1">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" /> Data Produkcji
            </span>
            <p className="text-sm font-bold text-slate-900 dark:text-white">
              {snapshot?.manufactureDate ? snapshot.manufactureDate : "Brak danych"}
            </p>
          </div>

          <div className="space-y-1">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <Gauge className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" /> Kilometraż
            </span>
            <p className="text-sm font-bold text-slate-900 dark:text-white">
              {report.mileage ? `${report.mileage.toLocaleString("pl-PL")} km` : "Średni przebieg rynkowy"}
            </p>
          </div>

          <div className="space-y-1">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <Clock className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> Data Wyceny
            </span>
            <p className="text-sm font-bold text-slate-900 dark:text-white">{report.valuationDate}</p>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 space-x-4">
        <button
          onClick={() => setActiveTab("valuation")}
          className={`flex items-center gap-2 pb-3 px-1 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === "valuation"
              ? "border-blue-600 text-blue-600 dark:border-blue-500 dark:text-white"
              : "border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
          }`}
        >
          <DollarSign className="h-4 w-4" /> Wycena i Wyposażenie
        </button>

        <button
          onClick={() => setActiveTab("claims")}
          className={`flex items-center gap-2 pb-3 px-1 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === "claims"
              ? "border-blue-600 text-blue-600 dark:border-blue-500 dark:text-white"
              : "border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
          }`}
        >
          <AlertTriangle className="h-4 w-4" /> Historia i Szczegóły Szkód ({historyDetectedWithoutDetails || historyDetectedDetailsUnavailable ? "wpisy wykryte" : hasProbableClaims ? `${dedup.entriesCount}, prawdop. ${dedup.likelyEventsCount}` : claims.length})
        </button>

        {isAdmin && (
          <button
            onClick={() => setActiveTab("audit")}
            className={`flex items-center gap-2 pb-3 px-1 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === "audit"
                ? "border-blue-600 text-blue-600 dark:border-blue-500 dark:text-white"
                : "border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            <Layers className="h-4 w-4" /> Ślad Audytowy
          </button>
        )}
      </div>

      {/* TAB 1: VALUATION & EQUIPMENT */}
      {activeTab === "valuation" && (
        <div className="space-y-8">
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Wartości Pojazdu</h2>

              <div
                role="group"
                aria-label="Przełącznik wartości netto lub brutto"
                className="inline-flex items-center rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-slate-800 dark:bg-slate-900 self-start sm:self-auto"
              >
                <button
                  type="button"
                  onClick={() => setPriceDisplayMode("net")}
                  className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all ${
                    priceDisplayMode === "net"
                      ? "bg-white text-blue-600 shadow-sm dark:bg-slate-800 dark:text-blue-400"
                      : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                  }`}
                >
                  Wartości netto
                </button>
                <button
                  type="button"
                  onClick={() => setPriceDisplayMode("gross")}
                  className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all ${
                    priceDisplayMode === "gross"
                      ? "bg-white text-blue-600 shadow-sm dark:bg-slate-800 dark:text-blue-400"
                      : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                  }`}
                >
                  Wartości brutto (23% VAT)
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-6 space-y-2 shadow-sm">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Cena Nowego (CVv)</span>
                {renderValuationPrice(snapshot?.newPriceCv, "text-slate-900 dark:text-white")}
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Nowy pojazd z wyposażeniem opcjonalnym</p>
              </div>

              <div className="rounded-2xl border border-blue-200 dark:border-blue-500/30 bg-blue-50/50 dark:bg-blue-950/30 p-6 space-y-2 relative overflow-hidden shadow-sm">
                <span className="text-xs font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wider">Cena Rynkowa (COBv)</span>
                {renderValuationPrice(snapshot?.marketPriceCob, "text-blue-600 dark:text-blue-400")}
                <p className="text-[11px] text-slate-600 dark:text-slate-300">Bieżąca szacunkowa wartość rynkowa pojazdu</p>
              </div>

              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-6 space-y-2 shadow-sm">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Wartość Techniczna (THv)</span>
                {renderValuationPrice(snapshot?.technicalValueTh, "text-emerald-600 dark:text-emerald-400")}
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Wartość techniczna pojazdu wyliczona przez Audatex</p>
              </div>
            </div>
          </div>

          {/* Technical Specifications Card */}
          {technicalSpec && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-6 space-y-4 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                  <Car className="h-4 w-4 text-blue-600 dark:text-blue-400" /> Specyfikacja Techniczna Pojazdu
                </h3>
                <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-950 px-2.5 py-1 rounded-full border border-slate-200 dark:border-slate-800">
                  Dane katalogowe
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 text-xs">
                <div className="space-y-1 p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80">
                  <span className="text-slate-500 dark:text-slate-400 font-semibold uppercase text-[10px]">Pojemność silnika</span>
                  <p className="text-sm font-bold text-slate-900 dark:text-white">
                    {technicalSpec.engineCapacityCm3 ? `${technicalSpec.engineCapacityCm3.toLocaleString("pl-PL")} cm³` : "Brak danych"}
                  </p>
                </div>

                <div className="space-y-1 p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80">
                  <span className="text-slate-500 dark:text-slate-400 font-semibold uppercase text-[10px]">Moc silnika</span>
                  <p className="text-sm font-bold text-slate-900 dark:text-white">
                    {technicalSpec.enginePowerKw && technicalSpec.enginePowerHp
                      ? `${technicalSpec.enginePowerKw} kW (${technicalSpec.enginePowerHp} KM${technicalSpec.isEnginePowerHpCalculated ? " — przeliczone" : ""})`
                      : technicalSpec.enginePowerKw
                      ? `${technicalSpec.enginePowerKw} kW`
                      : technicalSpec.enginePowerHp
                      ? `${technicalSpec.enginePowerHp} KM`
                      : "Brak danych"}
                  </p>
                </div>

                <div className="space-y-1 p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80">
                  <span className="text-slate-500 dark:text-slate-400 font-semibold uppercase text-[10px]">Paliwo / Napęd</span>
                  <p className="text-sm font-bold text-slate-900 dark:text-white">
                    {[technicalSpec.fuelType, technicalSpec.driveType].filter(Boolean).join(" / ") || "Brak danych"}
                  </p>
                </div>

                <div className="space-y-1 p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80">
                  <span className="text-slate-500 dark:text-slate-400 font-semibold uppercase text-[10px]">Skrzynia biegów</span>
                  <p className="text-sm font-bold text-slate-900 dark:text-white">
                    {technicalSpec.gearboxType ? `${technicalSpec.gearboxType}${technicalSpec.gearCount ? ` (${technicalSpec.gearCount} biegów)` : ""}` : "Brak danych"}
                  </p>
                </div>

                <div className="space-y-1 p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80">
                  <span className="text-slate-500 dark:text-slate-400 font-semibold uppercase text-[10px]">Nadwozie / Miejsca</span>
                  <p className="text-sm font-bold text-slate-900 dark:text-white">
                    {[formatBodyType(technicalSpec.bodyType), technicalSpec.seatsCount ? `${technicalSpec.seatsCount} miejsc` : undefined].filter(Boolean).join(" / ") || "Brak danych"}
                  </p>
                </div>

                <div className="space-y-1 p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80">
                  <span className="text-slate-500 dark:text-slate-400 font-semibold uppercase text-[10px]">Masa własna / DMC</span>
                  <p className="text-sm font-bold text-slate-900 dark:text-white">
                    {technicalSpec.curbWeightKg ? `${technicalSpec.curbWeightKg} kg / ${technicalSpec.grossWeightKg || "—"} kg` : "Brak danych"}
                  </p>
                </div>

                <div className="space-y-1 p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80">
                  <span className="text-slate-500 dark:text-slate-400 font-semibold uppercase text-[10px]">Wymiary (Dł/Szer/Wys)</span>
                  <p className="text-sm font-bold text-slate-900 dark:text-white">
                    {technicalSpec.lengthMm ? `${technicalSpec.lengthMm} x ${technicalSpec.widthMm} x ${technicalSpec.heightMm} mm` : "Brak danych"}
                  </p>
                </div>

                <div className="space-y-1 p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80">
                  <span className="text-slate-500 dark:text-slate-400 font-semibold uppercase text-[10px]">Koła / Emisja</span>
                  <p className="text-sm font-bold text-slate-900 dark:text-white">
                    {[technicalSpec.wheelSize, technicalSpec.emissionStandard].filter(Boolean).join(" / ") || "Brak danych"}
                  </p>
                </div>
              </div>

              {/* Unmapped Raw Attributes Fallback */}
              {filterRawAttributes(technicalSpec.rawAttributes).length > 0 && (
                <div className="pt-3 border-t border-slate-200 dark:border-slate-800/80 space-y-2">
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                    Dodatkowe parametry techniczne
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 text-xs">
                    {filterRawAttributes(technicalSpec.rawAttributes).map(([label, value]) => (
                      <div key={label} className="p-2 rounded-lg bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800/50">
                        <span className="text-[10px] text-slate-500 block">{label}</span>
                        <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{value}</span>
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
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-6 space-y-4 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                  <Layers className="h-4 w-4 text-blue-600 dark:text-blue-400" /> Wyposażenie Dodatkowe & Pakiety
                </h3>
                <span className="rounded-full bg-blue-50 dark:bg-blue-500/10 px-2.5 py-0.5 text-xs font-semibold text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-500/20">
                  {sortEquipmentAlphabetically(optEquipment).length} pozycji
                </span>
              </div>

              {isValuationFailed ? (
                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span>
                    {valModule?.status === "FAILED"
                      ? formatUserFriendlyError(valModule?.errorMessage)
                      : "Wycena i wyposażenie nie zostały uwzględnione w tym raporcie."}
                  </span>
                </div>
              ) : sortEquipmentAlphabetically(optEquipment).length === 0 ? (
                <p className="text-xs text-slate-500 italic py-2">
                  Brak zarejestrowanego wyposażenia opcjonalnego w katalogu.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {sortEquipmentAlphabetically(optEquipment).map((eq: any, idx: number) => (
                    <div
                      key={idx}
                      className="p-3 rounded-xl bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800/40 flex items-center justify-between gap-2"
                    >
                      <span className="font-medium text-xs text-slate-800 dark:text-blue-200">{eq.name}</span>
                      {eq.code && (
                        <span className="font-mono text-[10px] text-blue-700 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/40 px-2 py-0.5 rounded shrink-0 border border-blue-200 dark:border-blue-700/40">
                          {eq.code}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Standard Equipment 3-Column Alphabetical Grid */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-6 space-y-4 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                  <Car className="h-4 w-4 text-slate-500 dark:text-slate-400" /> Wyposażenie Standardowe
                </h3>
                <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 text-xs font-semibold text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-transparent">
                  {sortEquipmentAlphabetically(stdEquipment).length} pozycji
                </span>
              </div>

              {isValuationFailed ? (
                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span>
                    {valModule?.status === "FAILED"
                      ? formatUserFriendlyError(valModule?.errorMessage)
                      : "Wycena i wyposażenie nie zostały uwzględnione w tym raporcie."}
                  </span>
                </div>
              ) : sortEquipmentAlphabetically(stdEquipment).length === 0 ? (
                <p className="text-xs text-slate-500 italic py-2">
                  Katalog nie zwrócił pozycji wyposażenia standardowego.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs text-slate-700 dark:text-slate-300">
                  {sortEquipmentAlphabetically(stdEquipment).map((eq: any, idx: number) => (
                    <div
                      key={idx}
                      className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800/60 flex items-center justify-between gap-2"
                    >
                      <span className="text-slate-800 dark:text-slate-200">{eq.name}</span>
                      {eq.code && (
                        <span className="font-mono text-[10px] text-slate-500 bg-slate-200 dark:bg-slate-900 px-1.5 py-0.5 rounded shrink-0">
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
            <div className="rounded-2xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-950/20 p-6 flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400 shrink-0">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-red-700 dark:text-red-400">Znaleziono historię szkód</h2>
                <p className="text-xs text-slate-700 dark:text-slate-300">
                  {hasProbableClaims
                    ? `W bazie odnaleziono ${entryCountLabel(dedup.entriesCount)} dla tego pojazdu, prawdopodobnie dotyczące ${claimCountGenitive(dedup.likelyEventsCount)}.`
                    : `W bazie odnaleziono ${claims.length} zarejestrowane zdarzenia szkodowe dla tego pojazdu.`}
                </p>
                {(hasMergedClaims || hasProbableClaims) && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Wyceny tej samej szkody scalamy automatycznie, gdy zgadzają się data zdarzenia i zakres uszkodzeń; przy częściowej zgodności oznaczamy wpisy jako prawdopodobnie tę samą szkodę.
                  </p>
                )}
              </div>
            </div>
          ) : historyDetectedWithoutDetails ? (
            <div className="rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-950/20 p-6 flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-amber-800 dark:text-amber-400">Wykryto historię szkód</h2>
                <p className="text-xs text-slate-700 dark:text-slate-300">
                  Dla tego numeru VIN odnotowano zdarzenia szkodowe w bazie Audatex. Raport nie zawiera jednak szczegółowego wykazu uszkodzeń, ponieważ podczas tworzenia raportu nie wybrano opcji pobrania szczegółów szkód.
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 pt-1">
                  Aby zobaczyć dokładną listę szkód i zakres uszkodzeń, utwórz nowy raport z zaznaczoną opcją szczegółów historii szkód.
                </p>
              </div>
            </div>
          ) : historyDetectedDetailsUnavailable ? (
            <div className="rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-950/20 p-6 flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-amber-800 dark:text-amber-400">Wykryto historię szkód</h2>
                <p className="text-xs text-slate-700 dark:text-slate-300">
                  W bazie odnotowano historię szkód dla tego pojazdu, jednak szczegółowy wykaz zdarzeń nie jest dostępny w tym raporcie.
                </p>
              </div>
            </div>
          ) : noClaimsFound ? (
            <div className="rounded-2xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-950/20 p-6 flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 shrink-0">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-emerald-700 dark:text-emerald-400">Brak odnotowanych szkód</h2>
                <p className="text-xs text-slate-700 dark:text-slate-300">
                  Nie odnaleziono żadnych zarejestrowanych szkód komunikacyjnych dla podanego numeru VIN.
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 pt-1">
                  * Informacja dotyczy zdarzeń zarejestrowanych w systemie eksperckim Audatex.
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-6 text-xs text-slate-500 dark:text-slate-400 shadow-sm">
              Weryfikacja historii szkód nie została wybrana lub nie zwróciła danych.
            </div>
          )}

          {hasClaims && (
            <div className="space-y-6">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 dark:text-slate-300">Chronologiczny Wykaz Szkód</h3>

              <div className="space-y-6">
                {claims.map((item, index: number) => {
                  const c: any = item.primary;

                  return (
                    <div key={c.id || index} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-6 space-y-6 shadow-sm">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
                        <div className="space-y-1">
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-bold text-slate-900 dark:text-white">Szkoda #{index + 1}</span>
                            {item.probableWith.length > 0 && (
                              <span className="rounded-full border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                                Prawdopodobnie ta sama szkoda
                              </span>
                            )}
                            {item.isTotalLoss && (
                              <span className="rounded-full bg-red-600 px-2.5 py-0.5 text-[10px] font-black uppercase text-white tracking-widest animate-pulse">
                                SZKODA CAŁKOWITA
                              </span>
                            )}
                            <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 text-xs font-mono text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-transparent">
                              Kraj: {c.country || "PL"}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400">Identyfikator rekordu: {c.claimId}</p>
                          {item.dedupKind === "MERGED" && (
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                              Najnowsza z {item.earlierAssessments.length + 1} wycen tej szkody
                            </p>
                          )}
                          {item.probableWith.length > 0 && (
                            <p className="text-[11px] text-amber-700 dark:text-amber-300/80">
                              Zbliżony zakres uszkodzeń i termin jak {item.probableWith.length === 1 ? "szkoda" : "szkody"} {item.probableWith.join(", ")}. Audatex nie podaje wspólnego identyfikatora zdarzenia.
                            </p>
                          )}
                        </div>

                        <div className="text-left sm:text-right">
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 block">Wartość Szkody</span>
                          <span className="text-xl font-black text-red-600 dark:text-red-400">
                            {!c.damageValue || c.damageValue <= 0
                              ? "Brak kwoty"
                              : (c.currency || "PLN") === "PLN"
                              ? formatDamageGrossRange(c.damageValue)
                              : `${formatAmount(c.damageValue)} ${c.currency}`}
                          </span>
                          {c.damageValue > 0 && (
                            <span className="text-[11px] text-slate-500 block">
                              {(c.currency || "PLN") === "PLN" ? DAMAGE_GROSS_CAPTION : `${c.currency} netto (bez VAT)`}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 text-xs">
                        <div>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                            {!item.accidentDate && c.claimDate ? "Data Zgłoszenia" : "Data Zdarzenia"}
                          </span>
                          <span className="font-semibold text-slate-900 dark:text-white">{item.accidentDate || c.claimDate || "Brak danych"}</span>
                        </div>
                        <div>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 block">Stan drogomierza</span>
                          <span className="font-semibold text-slate-900 dark:text-white">{c.mileage ? `${c.mileage.toLocaleString("pl-PL")} km` : "Brak danych"}</span>
                        </div>
                        <div>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 block">Kod Mandatu</span>
                          <span className="font-mono font-bold text-amber-600 dark:text-amber-400">{c.mandateCode || "—"}</span>
                        </div>
                        <div>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 block">Kwalifikacja Mandatu</span>
                          <span className="font-semibold text-slate-800 dark:text-slate-200">{formatMandateDescription(c.mandateDescription)}</span>
                        </div>
                      </div>

                      {item.earlierAssessments.length > 0 && (
                        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-4 space-y-2">
                          <h4 className="text-xs font-bold text-slate-800 dark:text-slate-300 uppercase tracking-wider">Wcześniejsze wyceny tej szkody</h4>
                          <ul className="space-y-1.5 text-xs">
                            {item.earlierAssessments.map((e: any) => (
                              <li key={e.claimId} className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-slate-800 dark:text-slate-200">
                                <span className="font-semibold">
                                  {e.claimDate || e.accidentDate || "Brak danych"} <span className="font-normal text-slate-500">zgłoszenie</span>
                                </span>
                                {e.isTotalLoss && (
                                  <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-black uppercase text-white tracking-widest">
                                    SZKODA CAŁKOWITA
                                  </span>
                                )}
                                <span>
                                  {typeof e.damageValue !== "number" || e.damageValue <= 0
                                    ? "Brak kwoty"
                                    : (e.currency || "PLN") === "PLN"
                                    ? `${formatDamageGrossRange(e.damageValue)} brutto, szacunek`
                                    : `${formatAmount(e.damageValue)} ${e.currency} netto (bez VAT)`}
                                </span>
                                <span className="text-[11px] text-slate-500">{e.claimId}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

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

      {/* TAB 3: AUDIT TRAIL (Admin only) */}
      {isAdmin && activeTab === "audit" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-6 space-y-6 shadow-sm">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 dark:text-white">Ślad Audytowy Wykonania Integracji</h3>

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
                    <div key={id} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4 space-y-3 flex flex-col justify-between">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-600 dark:text-slate-400 font-semibold block">{name}</span>
                          {mod && (
                            <span className="font-mono text-[10px] text-slate-500 bg-slate-200 dark:bg-slate-900 px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-800">
                              próby: {mod.retryCount || 0}/3
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 text-xs font-bold">
                          {status === "SUCCEEDED" && (
                            <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                              <CheckCircle2 className="h-4 w-4" /> SUCCEEDED
                            </span>
                          )}
                          {status === "NO_DATA" && (
                            <span className="text-cyan-600 dark:text-cyan-400 flex items-center gap-1">
                              <Info className="h-4 w-4" /> NO_DATA (Brak wpisów)
                            </span>
                          )}
                          {(status === "RUNNING" || isExecuting) && (
                            <span className="text-blue-600 dark:text-blue-400 flex items-center gap-1">
                              <Loader2 className="h-4 w-4 animate-spin" /> RUNNING (Przetwarzanie...)
                            </span>
                          )}
                          {status === "PENDING" && !isExecuting && creditBlocked[id] && (
                            <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1">
                              <Coins className="h-4 w-4" /> Brak kredytów
                            </span>
                          )}
                          {status === "PENDING" && !isExecuting && !creditBlocked[id] && (
                            <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1">
                              <Clock className="h-4 w-4" /> PENDING (Oczekuje)
                            </span>
                          )}
                          {status === "FAILED" && (
                            <span className="text-red-600 dark:text-red-400 flex items-center gap-1">
                              <XCircle className="h-4 w-4" /> FAILED
                            </span>
                          )}
                          {status === "NOT_REQUESTED" && (
                            <span className="text-slate-400 dark:text-slate-500 flex items-center gap-1">
                              NOT_REQUESTED
                            </span>
                          )}
                        </div>

                        {mod?.errorMessage && (
                          <p className="text-[11px] text-red-600 dark:text-red-400 break-words bg-red-50 dark:bg-red-950/30 p-2 rounded-lg border border-red-200 dark:border-red-900/40">
                            {mod.errorMessage}
                          </p>
                        )}

                        {mod?.isNonRetryable && (
                          <span className="inline-block text-[10px] font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/50 px-2 py-0.5 rounded border border-red-200 dark:border-red-800/50">
                            Błąd nienaprawialny (brak możliwości ponowienia)
                          </span>
                        )}

                        {status === "FAILED" && (mod?.retryCount || 0) >= 3 && (
                          <span className="inline-block text-[10px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-800/50">
                            Wyczerpano limit 3 ponowień
                          </span>
                        )}
                      </div>

                      {canRetry && (
                        <button
                          onClick={() => executeModule(id)}
                          disabled={isExecuting}
                          className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 dark:hover:bg-blue-500 disabled:opacity-50 py-1.5 px-3 text-xs font-bold text-white transition shadow"
                        >
                          {isExecuting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                          Ponów moduł
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-400 space-y-1">
                <p className="font-semibold text-slate-800 dark:text-slate-300">Zgodność z RODO & PRD:</p>
                <p>Surowe parametry XML SOAP są parsowane wyłącznie po stronie serwera i nie są utrwalane w przeglądarce.</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
