"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Car, Calendar, Gauge, CheckSquare, AlertCircle, ArrowRight, Loader2, Info } from "lucide-react";

export default function NewReportPage() {
  const router = useRouter();

  const [vin, setVin] = useState("WBA3N51030KS15173");
  const [firstRegDate, setFirstRegDate] = useState("2021-04-15");
  const [mileage, setMileage] = useState("45200");
  const [valuationDate, setValuationDate] = useState(new Date().toISOString().split("T")[0]);

  const [includeValuation, setIncludeValuation] = useState(true);
  const [includeClaimCheck, setIncludeClaimCheck] = useState(true);
  const [includeClaimDetails, setIncludeClaimDetails] = useState(true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleVinChange = (val: string) => {
    setVin(val.replace(/[\s-]/g, "").toUpperCase());
  };

  const handleClaimCheckToggle = (val: boolean) => {
    setIncludeClaimCheck(val);
    if (!val) {
      setIncludeClaimDetails(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!vin || vin.length !== 17) {
      setError("Podaj poprawny, 17-cyfrowy numer VIN.");
      return;
    }

    if (!firstRegDate) {
      setError("Data pierwszej rejestracji jest wymagana.");
      return;
    }

    if (!includeValuation && !includeClaimCheck && !includeClaimDetails) {
      setError("Wybierz co najmniej jeden moduł zapytania.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vin,
          firstRegistrationDate: firstRegDate,
          mileage: mileage ? parseInt(mileage, 10) : undefined,
          valuationDate,
          modules: {
            includeValuation,
            includeClaimCheck,
            includeClaimDetails,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Nie udało się wygenerować raportu.");
      } else {
        router.push(`/reports/${data.reportId}`);
      }
    } catch (err: any) {
      setError("Wystąpił błąd sieciowy podczas wywoływania usług Audatex.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Formularz Zapytania VIN</h1>
        <p className="text-xs text-slate-400 mt-1">
          Wprowadź dane pojazdu i wybierz zakres modułów zapytań do usług Audatex SOAP.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-xs font-medium text-red-400">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Step 1: Vehicle Inputs */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 space-y-6">
          <h2 className="text-sm font-bold uppercase tracking-wider text-blue-400 flex items-center gap-2">
            <Car className="h-4 w-4" /> 1. Dane Wejściowe Pojazdu
          </h2>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {/* VIN */}
            <div className="space-y-2 sm:col-span-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-300">Numer VIN (Wymagany)</label>
                <span className={`text-[11px] font-mono font-semibold ${vin.length === 17 ? "text-emerald-400" : "text-amber-400"}`}>
                  {vin.length}/17 znaki
                </span>
              </div>
              <input
                type="text"
                required
                maxLength={17}
                value={vin}
                onChange={(e) => handleVinChange(e.target.value)}
                placeholder="np. WBA3N51030KS15173"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 py-3 px-4 font-mono text-base font-semibold tracking-widest text-white placeholder-slate-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <p className="text-[11px] text-slate-400">Numer VIN zostanie automatycznie znormalizowany i zweryfikowany przed wysłaniem SOAP.</p>
            </div>

            {/* First Registration Date */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300">Data Pierwszej Rejestracji (Wymagana)</label>
              <div className="relative">
                <Calendar className="absolute left-3.5 top-3 h-4 w-4 text-slate-500" />
                <input
                  type="date"
                  required
                  value={firstRegDate}
                  onChange={(e) => setFirstRegDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 py-2.5 pl-10 pr-4 text-sm text-white focus:border-blue-500 focus:outline-none"
                />
              </div>
              <p className="text-[11px] text-slate-400">Wymagana przez AudaValuation i zalecana dla filtru szkód CHE.</p>
            </div>

            {/* Mileage */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300">Przebieg w km (Opcjonalny)</label>
              <div className="relative">
                <Gauge className="absolute left-3.5 top-3 h-4 w-4 text-slate-500" />
                <input
                  type="number"
                  min={0}
                  value={mileage}
                  onChange={(e) => setMileage(e.target.value)}
                  placeholder="np. 45200"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-600 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <p className="text-[11px] text-slate-400">Przy braku przebiegu AudaValuation wylicza średni kilometraż rynkowy (0 km).</p>
            </div>

            {/* Valuation Date */}
            <div className="space-y-2 sm:col-span-2">
              <label className="text-xs font-semibold text-slate-300">Data Wyceny (Domyślnie Dzisiejsza)</label>
              <input
                type="date"
                value={valuationDate}
                onChange={(e) => setValuationDate(e.target.value)}
                className="w-full sm:w-1/2 rounded-xl border border-slate-800 bg-slate-950 py-2.5 px-4 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Step 2: Module Selection */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 space-y-6">
          <h2 className="text-sm font-bold uppercase tracking-wider text-blue-400 flex items-center gap-2">
            <CheckSquare className="h-4 w-4" /> 2. Wybór Modułów Raportu
          </h2>

          <div className="space-y-4">
            {/* Module 1 */}
            <label className="flex items-start gap-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4 cursor-pointer hover:border-slate-700 transition-colors">
              <input
                type="checkbox"
                checked={includeValuation}
                onChange={(e) => setIncludeValuation(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
              />
              <div className="space-y-1">
                <span className="text-sm font-semibold text-white">Moduł 1: Wycena i Wyposażenie (AudaValuation WS 2023)</span>
                <p className="text-xs text-slate-400">
                  Identyfikacja IBS Code po VIN, pobranie wyceny rynkowej (COBv), wartości technicznej (THv), nowej ceny z wyposażeniem (CVv) oraz listy wyposażenia standardowego i opcjonalnego.
                </p>
              </div>
            </label>

            {/* Module 2 */}
            <label className="flex items-start gap-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4 cursor-pointer hover:border-slate-700 transition-colors">
              <input
                type="checkbox"
                checked={includeClaimCheck}
                onChange={(e) => handleClaimCheckToggle(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
              />
              <div className="space-y-1">
                <span className="text-sm font-semibold text-white">Moduł 2: Kontrola Historii Szkód (Claims History Engine `hasHistory`)</span>
                <p className="text-xs text-slate-400">
                  Weryfikacja w bazie Audatex, czy dla pojazdu istnieją zarejestrowane szkody komunikacyjne lub zdarzenia ubezpieczeniowe.
                </p>
              </div>
            </label>

            {/* Module 3 */}
            <label
              className={`flex items-start gap-4 rounded-xl border p-4 transition-colors ${
                includeClaimCheck
                  ? "border-slate-800 bg-slate-950/60 cursor-pointer hover:border-slate-700"
                  : "border-slate-850 bg-slate-950/30 opacity-50 cursor-not-allowed"
              }`}
            >
              <input
                type="checkbox"
                disabled={!includeClaimCheck}
                checked={includeClaimDetails}
                onChange={(e) => setIncludeClaimDetails(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
              />
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">Moduł 3: Szczegóły Szkód (`getDetails`)</span>
                  <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400 border border-amber-500/20">
                    Wymaga dodatniego wyniku Modułu 2
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Pobranie chronologicznej listy szkód z podziałem na kwoty, daty zdarzenia, kody mandatów, strefy uszkodzeń (28 stref) oraz istotne grupy części. Uruchamia się wyłącznie po potwierdzeniu wpisów.
                </p>
              </div>
            </label>
          </div>

          <div className="flex items-center gap-2 rounded-xl bg-blue-500/10 p-3 text-xs text-blue-300 border border-blue-500/20">
            <Info className="h-4 w-4 shrink-0" />
            <span>
              Wszystkie zapytania SOAP są wykonywane serwerowo po stronie Node.js. Dane poświadczeń i sekrety licencyjne są chronione.
            </span>
          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 py-4 text-base font-semibold text-white shadow-xl shadow-blue-600/30 hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 transition-all"
        >
          {loading ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" /> Łączenie z uslugami SOAP Audatex...
            </>
          ) : (
            <>
              Generuj Raport IzzyCheck <ArrowRight className="h-5 w-5" />
            </>
          )}
        </button>
      </form>
    </div>
  );
}
