"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Car, Calendar, Gauge, CheckSquare, AlertCircle, ArrowRight, Loader2, Info, ShieldAlert, Lock } from "lucide-react";

interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: string;
  canGenerateValuation: boolean;
  canGenerateClaimCheck: boolean;
  canGenerateClaimDetails: boolean;
  canViewOrgReports: boolean;
  organization?: {
    id: string;
    name: string;
  } | null;
}

export default function NewReportPage() {
  const router = useRouter();

  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [userLoading, setUserLoading] = useState(true);

  const [vin, setVin] = useState("");
  const [firstRegDate, setFirstRegDate] = useState("");
  const [mileage, setMileage] = useState("");
  const [valuationDate, setValuationDate] = useState(new Date().toISOString().split("T")[0]);

  const [includeValuation, setIncludeValuation] = useState(false);
  const [includeClaimCheck, setIncludeClaimCheck] = useState(false);
  const [includeClaimDetails, setIncludeClaimDetails] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated && data.user) {
          const u: CurrentUser = data.user;
          setCurrentUser(u);

          const canVal = Boolean(u.canGenerateValuation);
          const canCheck = Boolean(u.canGenerateClaimCheck);
          const canDetails = Boolean(u.canGenerateClaimDetails);

          if (canVal) {
            setIncludeValuation(true);
            setIncludeClaimCheck(true);
            setIncludeClaimDetails(canDetails);
          } else if (canCheck) {
            setIncludeValuation(false);
            setIncludeClaimCheck(true);
            setIncludeClaimDetails(canDetails);
          } else {
            setIncludeValuation(false);
            setIncludeClaimCheck(false);
            setIncludeClaimDetails(false);
          }
        }
      })
      .catch(() => {})
      .finally(() => setUserLoading(false));
  }, []);

  const handleVinChange = (val: string) => {
    setVin(val.replace(/[\s-]/g, "").toUpperCase());
  };

  const handleValuationToggle = (checked: boolean) => {
    setIncludeValuation(checked);
    if (checked) {
      // Core business rule: Valuation automatically includes Claim Check (Y/N)
      setIncludeClaimCheck(true);
    }
  };

  const handleClaimCheckToggle = (val: boolean) => {
    if (includeValuation) {
      // Locked when valuation is active
      return;
    }
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

    const canValuation = currentUser?.canGenerateValuation ?? false;
    const canClaimCheck = currentUser?.canGenerateClaimCheck ?? false;
    const canClaimDetails = currentUser?.canGenerateClaimDetails ?? false;
    const hasAnyPermission = canValuation || canClaimCheck || canClaimDetails;

    if (!hasAnyPermission) {
      setError("Twoje konto nie posiada uprawnień do generowania żadnego z modułów raportu. Skontaktuj się z managerem firmy.");
      return;
    }

    if (includeValuation && !canValuation) {
      setError("Brak uprawnień do generowania modułu wyceny.");
      return;
    }

    if (includeClaimCheck && !includeValuation && !canClaimCheck) {
      setError("Brak uprawnień do sprawdzania obecności wpisów szkód.");
      return;
    }

    if (includeClaimDetails && !canClaimDetails) {
      setError("Brak uprawnień do pobierania szczegółowych danych szkód.");
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

  const canValuation = currentUser?.canGenerateValuation ?? false;
  const canClaimCheck = currentUser?.canGenerateClaimCheck ?? false;
  const canClaimDetails = currentUser?.canGenerateClaimDetails ?? false;
  const hasAnyPermission = canValuation || canClaimCheck || canClaimDetails;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Formularz Zapytania VIN</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Wprowadź dane pojazdu i wybierz zakres modułów zapytań do usług Audatex SOAP.
        </p>
      </div>

      {!userLoading && !hasAnyPermission && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-900 dark:text-amber-200">
          <ShieldAlert className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
          <div className="space-y-1 text-xs">
            <p className="font-bold text-sm">Brak uprawnień do generowania raportów</p>
            <p>Twoje konto nie posiada uprawnień do generowania żadnego z modułów raportu. Skontaktuj się ze swoim managerem firmy, aby uzyskać dostęp.</p>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-xs font-medium text-red-600 dark:text-red-400">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Step 1: Vehicle Inputs */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
          <h2 className="text-sm font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 flex items-center gap-2">
            <Car className="h-4 w-4" /> 1. Dane Wejściowe Pojazdu
          </h2>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {/* VIN */}
            <div className="space-y-2 sm:col-span-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Numer VIN (Wymagany)</label>
                <span className={`text-[11px] font-mono font-semibold ${vin.length === 17 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
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
                className="w-full rounded-xl border border-slate-300 bg-slate-50 py-3 px-4 font-mono text-base font-semibold tracking-widest text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:placeholder-slate-600 dark:focus:bg-slate-950"
              />
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Numer VIN zostanie automatycznie znormalizowany i zweryfikowany przed wysłaniem SOAP.</p>
            </div>

            {/* First Registration Date */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Data Pierwszej Rejestracji (Wymagana)</label>
              <div className="relative">
                <Calendar className="absolute left-3.5 top-3 h-4 w-4 text-slate-400 dark:text-slate-500" />
                <input
                  type="date"
                  required
                  value={firstRegDate}
                  onChange={(e) => setFirstRegDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 py-2.5 pl-10 pr-4 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white dark:focus:bg-slate-950"
                />
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Wymagana przez AudaValuation i zalecana dla filtru szkód CHE.</p>
            </div>

            {/* Mileage */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Przebieg w km (Opcjonalny)</label>
              <div className="relative">
                <Gauge className="absolute left-3.5 top-3 h-4 w-4 text-slate-400 dark:text-slate-500" />
                <input
                  type="number"
                  min={0}
                  value={mileage}
                  onChange={(e) => setMileage(e.target.value)}
                  placeholder="np. 45200"
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 py-2.5 pl-10 pr-4 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white dark:placeholder-slate-600 dark:focus:bg-slate-950"
                />
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Przy braku przebiegu AudaValuation wylicza średni kilometraż rynkowy (0 km).</p>
            </div>

            {/* Valuation Date */}
            <div className="space-y-2 sm:col-span-2">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Data Wyceny (Domyślnie Dzisiejsza)</label>
              <input
                type="date"
                value={valuationDate}
                onChange={(e) => setValuationDate(e.target.value)}
                className="w-full sm:w-1/2 rounded-xl border border-slate-300 bg-slate-50 py-2.5 px-4 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white dark:focus:bg-slate-950"
              />
            </div>
          </div>
        </div>

        {/* Step 2: Module Selection */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
          <h2 className="text-sm font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 flex items-center gap-2">
            <CheckSquare className="h-4 w-4" /> 2. Wybór Modułów Raportu
          </h2>

          <div className="space-y-4">
            {/* Module 1 */}
            <label
              className={`flex items-start gap-4 rounded-xl border p-4 transition-colors ${
                canValuation
                  ? "border-slate-200 bg-slate-50/70 cursor-pointer hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950/60 dark:hover:border-slate-700"
                  : "border-slate-100 bg-slate-50/30 opacity-60 cursor-not-allowed dark:border-slate-850 dark:bg-slate-950/30"
              }`}
            >
              <input
                type="checkbox"
                disabled={!canValuation}
                checked={includeValuation}
                onChange={(e) => handleValuationToggle(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300 bg-white text-blue-600 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 disabled:opacity-40"
              />
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">Moduł 1: Wycena i Wyposażenie (AudaValuation WS 2023)</span>
                  {!canValuation && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700">
                      <Lock className="h-2.5 w-2.5" /> Brak uprawnienia
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Identyfikacja IBS Code po VIN, pobranie wyceny rynkowej (COBv), wartości technicznej (THv), nowej ceny z wyposażeniem (CVv) oraz listy wyposażenia standardowego i opcjonalnego.
                </p>
              </div>
            </label>

            {/* Module 2 */}
            <label
              className={`flex items-start gap-4 rounded-xl border p-4 transition-colors ${
                !canClaimCheck && !includeValuation
                  ? "border-slate-100 bg-slate-50/30 opacity-60 cursor-not-allowed dark:border-slate-850 dark:bg-slate-950/30"
                  : includeValuation
                  ? "border-blue-200/60 bg-blue-50/30 dark:border-blue-900/40 dark:bg-blue-950/20 cursor-default"
                  : "border-slate-200 bg-slate-50/70 cursor-pointer hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950/60 dark:hover:border-slate-700"
              }`}
            >
              <input
                type="checkbox"
                disabled={includeValuation || !canClaimCheck}
                checked={includeClaimCheck}
                onChange={(e) => handleClaimCheckToggle(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300 bg-white text-blue-600 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 disabled:opacity-40"
              />
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">Moduł 2: Kontrola Historii Szkód (Claims History Engine `hasHistory`)</span>
                  {includeValuation ? (
                    <span className="rounded-full bg-blue-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-blue-600 dark:text-blue-400 border border-blue-500/20">
                      Weryfikacja obecności wpisów szkód (Y/N) dołączana automatycznie do wyceny
                    </span>
                  ) : !canClaimCheck ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700">
                      <Lock className="h-2.5 w-2.5" /> Brak uprawnienia
                    </span>
                  ) : null}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Weryfikacja w bazie Audatex, czy dla pojazdu istnieją zarejestrowane szkody komunikacyjne lub zdarzenia ubezpieczeniowe.
                </p>
              </div>
            </label>

            {/* Module 3 */}
            <label
              className={`flex items-start gap-4 rounded-xl border p-4 transition-colors ${
                includeClaimCheck && canClaimDetails
                  ? "border-slate-200 bg-slate-50/70 cursor-pointer hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950/60 dark:hover:border-slate-700"
                  : "border-slate-100 bg-slate-50/30 opacity-60 cursor-not-allowed dark:border-slate-850 dark:bg-slate-950/30"
              }`}
            >
              <input
                type="checkbox"
                disabled={!includeClaimCheck || !canClaimDetails}
                checked={includeClaimDetails}
                onChange={(e) => setIncludeClaimDetails(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300 bg-white text-blue-600 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 disabled:opacity-40"
              />
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">Moduł 3: Szczegóły Szkód (`getDetails`)</span>
                  {!canClaimDetails ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700">
                      <Lock className="h-2.5 w-2.5" /> Brak uprawnienia
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400 border border-amber-500/20">
                      Wymaga dodatniego wyniku Modułu 2
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Pobranie chronologicznej listy szkód z podziałem na kwoty, daty zdarzenia, kody mandatów, strefy uszkodzeń (28 stref) oraz istotne grupy części. Uruchamia się wyłącznie po potwierdzeniu wpisów.
                </p>
              </div>
            </label>
          </div>

          <div className="flex items-center gap-2 rounded-xl bg-blue-500/10 p-3 text-xs text-blue-700 dark:text-blue-300 border border-blue-500/20">
            <Info className="h-4 w-4 shrink-0" />
            <span>
              Wszystkie zapytania SOAP są wykonywane serwerowo po stronie Node.js. Dane poświadczeń i sekrety licencyjne są chronione.
            </span>
          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={loading || userLoading || !hasAnyPermission}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 py-4 text-base font-semibold text-white shadow-xl shadow-blue-600/30 hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {loading ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" /> Łączenie z uslugami SOAP Audatex...
            </>
          ) : !hasAnyPermission && !userLoading ? (
            <>
              <Lock className="h-5 w-5" /> Brak Uprawnień do Generowania Raportów
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
