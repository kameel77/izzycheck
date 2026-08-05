"use client";

import { useEffect, useState, use } from "react";
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
  ChevronDown,
  ChevronUp,
  Layers,
  ArrowLeft,
  Info,
  Clock,
  Printer,
  Copy,
  Check,
} from "lucide-react";

export default function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const reportId = resolvedParams.id;

  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"valuation" | "claims" | "audit">("valuation");
  const [showRawXml, setShowRawXml] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(`/api/reports/${reportId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.report) {
          setReport(data.report);
        } else {
          setError(data.error || "Nie odnaleziono raportu.");
        }
      })
      .catch(() => setError("Wystąpił błąd podczas ładowania raportu."))
      .finally(() => setLoading(false));
  }, [reportId]);

  if (loading) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-8">
        <div className="text-center space-y-4">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-blue-500 border-t-transparent"></div>
          <p className="text-sm font-semibold text-slate-300">Pobieranie raportu Audatex...</p>
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

  const valModule = report.moduleResults?.find((m: any) => m.moduleId === "VALUATION");
  const checkModule = report.moduleResults?.find((m: any) => m.moduleId === "CLAIM_CHECK");
  const detailsModule = report.moduleResults?.find((m: any) => m.moduleId === "CLAIM_DETAILS");

  const hasClaims = claims.length > 0;
  const noClaimsFound = checkModule?.status === "NO_DATA";

  const handleCopyXml = () => {
    const rawXml = valModule?.rawXml || checkModule?.rawXml || detailsModule?.rawXml || "Brak surowego XML";
    navigator.clipboard.writeText(rawXml);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
        </div>
      </div>

      {/* Main Header Banner */}
      <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-6 sm:p-8 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 pb-6 border-b border-slate-800">
          <div className="space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="rounded-full bg-blue-500/10 px-3 py-1 text-xs font-bold text-blue-400 border border-blue-500/20">
                Raport IzzyCheck #{report.id.substring(0, 8)}
              </span>
              <span className="text-xs text-slate-400">
                Data sprawdzenia: {new Date(report.createdAt).toLocaleString("pl-PL")}
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
              <p className="text-[11px] font-semibold text-slate-400 uppercase">Operator Izzy Lease</p>
              <p className="text-sm font-bold text-white">{report.createdBy?.name || "Operator"}</p>
              <p className="text-[10px] text-slate-500">{report.createdBy?.email}</p>
            </div>
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

          <div className="space-y-1">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <ShieldCheck className="h-3.5 w-3.5 text-purple-400" /> Status Usług
            </span>
            <p className="text-sm font-bold text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="h-4 w-4" /> Zweryfikowano
            </p>
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
          <AlertTriangle className="h-4 w-4" /> Historia & Szczegóły Szkód ({claims.length})
        </button>

        <button
          onClick={() => setActiveTab("audit")}
          className={`flex items-center gap-2 pb-3 px-1 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === "audit"
              ? "border-blue-500 text-white"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <Layers className="h-4 w-4" /> Ślad Audytowy & XML
        </button>
      </div>

      {/* TAB 1: VALUATION & EQUIPMENT */}
      {activeTab === "valuation" && (
        <div className="space-y-8">
          {/* Valuation Summary Cards */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-white">Wartości Pojazdu z AudaValuation</h2>
              <div className="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-400 border border-amber-500/20">
                <Info className="h-3.5 w-3.5" /> Wartości podane bez VAT (netto)
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 space-y-2">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Cena Nowego (CVv)</span>
                <p className="text-3xl font-extrabold text-white">
                  {snapshot?.newPriceCv ? `${snapshot.newPriceCv.toLocaleString("pl-PL")} PLN` : "Brak danych"}
                </p>
                <p className="text-[11px] text-slate-400">Nowy pojazd z wyposażeniem opcjonalnym i pakietami</p>
              </div>

              <div className="rounded-2xl border border-blue-500/30 bg-blue-950/30 p-6 space-y-2 relative overflow-hidden">
                <span className="text-xs font-semibold text-blue-400 uppercase tracking-wider">Cena Rynkowa (COBv)</span>
                <p className="text-3xl font-extrabold text-blue-400">
                  {snapshot?.marketPriceCob ? `${snapshot.marketPriceCob.toLocaleString("pl-PL")} PLN` : "Brak danych"}
                </p>
                <p className="text-[11px] text-slate-300">Bieżąca powszechna wartość rynkowa</p>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 space-y-2">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Wartość Techniczna (THv)</span>
                <p className="text-3xl font-extrabold text-emerald-400">
                  {snapshot?.technicalValueTh ? `${snapshot.technicalValueTh.toLocaleString("pl-PL")} PLN` : "Brak danych"}
                </p>
                <p className="text-[11px] text-slate-400">Wartość techniczna wyliczona przez Audatex</p>
              </div>
            </div>
          </div>

          {/* Equipment Lists */}
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            {/* Standard Equipment */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Wyposażenie Standardowe</h3>
                <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-semibold text-slate-300">
                  {stdEquipment.length} pozycji
                </span>
              </div>

              {stdEquipment.length === 0 ? (
                <p className="text-xs text-slate-500">Brak szczegółów wyposażenia standardowego.</p>
              ) : (
                <ul className="divide-y divide-slate-800/60 text-xs text-slate-300">
                  {stdEquipment.map((eq: any, idx: number) => (
                    <li key={idx} className="py-2.5 flex items-center justify-between">
                      <span className="font-medium text-slate-200">{eq.name}</span>
                      <span className="font-mono text-[11px] text-slate-500 bg-slate-950 px-2 py-0.5 rounded">
                        Kod: {eq.code}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Optional Equipment */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Wyposażenie Dodatkowe & Pakiety</h3>
                <span className="rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-semibold text-blue-400 border border-blue-500/20">
                  {optEquipment.length} pozycji
                </span>
              </div>

              {optEquipment.length === 0 ? (
                <p className="text-xs text-slate-500">Brak wyposażenia opcjonalnego w identyfikacji VIN.</p>
              ) : (
                <ul className="divide-y divide-slate-800/60 text-xs text-slate-300">
                  {optEquipment.map((eq: any, idx: number) => (
                    <li key={idx} className="py-2.5 flex items-center justify-between">
                      <span className="font-medium text-slate-200">{eq.name}</span>
                      <span className="font-mono text-[11px] text-blue-400 bg-blue-950/50 border border-blue-800/40 px-2 py-0.5 rounded">
                        Kod: {eq.code}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: CLAIMS & DAMAGE DETAILS */}
      {activeTab === "claims" && (
        <div className="space-y-8">
          {/* Claims Status Banner */}
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
              Moduł historii szkód nie został wybrany lub jest przetwarzany.
            </div>
          )}

          {/* Claims Timeline List */}
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

                      {/* Claim Details Grid */}
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

                      {/* Affected Damage Zones (28 Zones Matrix) */}
                      {affectedZonesList.length > 0 && (
                        <div className="space-y-2 pt-2 border-t border-slate-800/60">
                          <span className="text-xs font-bold text-slate-300">Uszkodzone Strefy Nadwozia i Szyb (Part Zones):</span>
                          <div className="flex flex-wrap gap-2">
                            {affectedZonesList.map((z: string, zIdx: number) => (
                              <span key={zIdx} className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300">
                                {z}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Significant Parts Groups */}
                      {sigPartsList.length > 0 && (
                        <div className="space-y-2 pt-2 border-t border-slate-800/60">
                          <span className="text-xs font-bold text-slate-300">Istotne Grupy Części Objęte Kalkulacją:</span>
                          <div className="flex flex-wrap gap-2">
                            {sigPartsList.map((p: string, pIdx: number) => (
                              <span key={pIdx} className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-300">
                                {p}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: AUDIT TRAIL & RAW XML */}
      {activeTab === "audit" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 space-y-6">
            <h3 className="text-sm font-bold uppercase tracking-wider text-white">Ślad Audytowy Wykonania Integracji</h3>

            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-1">
                  <span className="text-slate-400 font-semibold block">AudaValuation WS 2023</span>
                  <span className="font-bold text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="h-4 w-4" /> {valModule?.status || "NIEWYKONANO"}
                  </span>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-1">
                  <span className="text-slate-400 font-semibold block">Claims History `hasHistory`</span>
                  <span className="font-bold text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="h-4 w-4" /> {checkModule?.status || "NIEWYKONANO"}
                  </span>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-1">
                  <span className="text-slate-400 font-semibold block">Claims History `getDetails`</span>
                  <span className="font-bold text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="h-4 w-4" /> {detailsModule?.status || "NIEWYKONANO"}
                  </span>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800 space-y-2">
                <button
                  onClick={() => setShowRawXml(!showRawXml)}
                  className="flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700 transition-colors"
                >
                  {showRawXml ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  {showRawXml ? "Ukryj Surowy Komunikat XML" : "Pokaż Surowy Komunikat SOAP XML"}
                </button>

                {showRawXml && (
                  <div className="relative mt-4 rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-[11px] text-slate-300 overflow-x-auto">
                    <button
                      onClick={handleCopyXml}
                      className="absolute right-3 top-3 flex items-center gap-1 rounded bg-slate-800 px-2 py-1 text-[10px] text-slate-300 hover:text-white"
                    >
                      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                      {copied ? "Skopiowano" : "Kopiuj XML"}
                    </button>
                    <pre className="whitespace-pre-wrap">
                      {valModule?.rawXml || checkModule?.rawXml || detailsModule?.rawXml || "Brak zapisanego XML w logu."}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
