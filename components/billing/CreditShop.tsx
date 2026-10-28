"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Minus, Plus, ShoppingCart } from "lucide-react";
import { CREDIT_TYPE_LABELS, formatCreditCount, formatGrosze } from "@/lib/billing/labels";
import { MAX_LINE_QUANTITY, priceCart } from "@/lib/billing/pricing";

type CreditType = "VALUATION" | "CLAIM_DETAILS";

interface ShopPackage {
  id: string;
  name: string;
  creditType: CreditType;
  credits: number;
  priceNetGrosze: number;
  vatRate: number;
  unitGrossGrosze: number;
}

interface PackagesResponse {
  packages: ShopPackage[];
  paymentsEnabled: boolean;
}

const CREDIT_TYPE_ORDER: CreditType[] = ["VALUATION", "CLAIM_DETAILS"];

function clampQuantity(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_LINE_QUANTITY, Math.max(0, Math.trunc(value)));
}

export default function CreditShop() {
  const [data, setData] = useState<PackagesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  // The ref closes the gap between a click and the re-render that disables the button.
  const submittingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/credit-packages")
      .then((res) => {
        if (!res.ok) throw new Error("packages request failed");
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;
        if (!Array.isArray(json?.packages)) throw new Error("invalid packages response");
        setData(json);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // After navigating to PayU and coming back through history the page may be restored with the button locked.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        submittingRef.current = false;
        setSubmitting(false);
      }
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  const packages = data?.packages ?? [];

  // Net price of the 1-credit package of each type (list is already ordered): the baseline for "savings".
  const baselineUnitNet = useMemo(() => {
    const baseline: Partial<Record<CreditType, number>> = {};
    for (const pkg of packages) {
      if (pkg.credits === 1 && baseline[pkg.creditType] === undefined) {
        baseline[pkg.creditType] = pkg.priceNetGrosze;
      }
    }
    return baseline;
  }, [packages]);

  const cartItems = useMemo(
    () =>
      Object.entries(quantities)
        .filter(([, quantity]) => quantity > 0)
        .map(([packageId, quantity]) => ({ packageId, quantity })),
    [quantities],
  );

  // Display only: the server prices the order again from its own data.
  const cart = useMemo(
    () => (cartItems.length > 0 ? priceCart(packages.map((p) => ({ ...p, isActive: true })), cartItems) : null),
    [packages, cartItems],
  );

  const setQuantity = (packageId: string, value: number) => {
    setSubmitError("");
    setQuantities((prev) => ({ ...prev, [packageId]: clampQuantity(value) }));
  };

  const handlePay = async () => {
    if (submittingRef.current || cartItems.length === 0) return;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError("");
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: cartItems }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || typeof json.redirectUri !== "string") {
        throw new Error(json.error || "Nie udało się utworzyć zamówienia.");
      }
      // Keep the button locked while the browser leaves for PayU.
      window.location.href = json.redirectUri;
    } catch (err) {
      submittingRef.current = false;
      setSubmitting(false);
      setSubmitError(err instanceof Error && err.message ? err.message : "Nie udało się utworzyć zamówienia.");
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-xs text-slate-400">Pobieranie cennika...</div>;
  }

  if (loadError || !data) {
    return (
      <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-5 text-sm text-red-700 dark:text-red-300">
        Nie udało się wczytać cennika pakietów.
      </div>
    );
  }

  if (packages.length === 0) {
    return (
      <div className="rounded-2xl border border-blue-500/20 bg-blue-500/10 p-4 text-sm text-blue-800 dark:text-blue-200">
        Brak dostępnych pakietów. Skontaktuj się z opiekunem Izzy Lease.
      </div>
    );
  }

  const paymentsEnabled = data.paymentsEnabled;
  const cartError = cart && "error" in cart ? cart.error : null;
  const pricedCart = cart && !("error" in cart) ? cart : null;
  const vatRates = pricedCart ? Array.from(new Set(pricedCart.lines.map((l) => l.vatRate))) : [];

  return (
    <section className="space-y-5">
      <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
        <ShoppingCart className="h-5 w-5 text-blue-500" /> Kup kredyty
      </h2>

      {!paymentsEnabled && (
        <div className="rounded-2xl border border-blue-500/20 bg-blue-500/10 p-4 text-sm text-blue-800 dark:text-blue-200">
          Płatności online są chwilowo niedostępne. Skontaktuj się z opiekunem Izzy Lease.
        </div>
      )}

      {CREDIT_TYPE_ORDER.map((creditType) => {
        const group = packages.filter((p) => p.creditType === creditType);
        if (group.length === 0) return null;
        return (
          <div key={creditType} className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {CREDIT_TYPE_LABELS[creditType]}
            </h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {group.map((pkg) => {
                const quantity = quantities[pkg.id] ?? 0;
                const baseline = baselineUnitNet[pkg.creditType];
                const savings =
                  baseline !== undefined
                    ? Math.round((1 - pkg.priceNetGrosze / pkg.credits / baseline) * 100)
                    : 0;
                return (
                  <div
                    key={pkg.id}
                    className={`rounded-2xl border bg-white p-5 shadow-sm dark:bg-slate-900/80 ${
                      quantity > 0
                        ? "border-blue-500 dark:border-blue-500"
                        : "border-slate-200 dark:border-slate-800"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-slate-900 dark:text-white">{pkg.name}</p>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {formatCreditCount(pkg.credits)}
                        </p>
                      </div>
                      {savings > 0 && (
                        <span className="shrink-0 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                          -{savings}%
                        </span>
                      )}
                    </div>

                    <p className="mt-4 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                      {formatGrosze(pkg.priceNetGrosze)}{" "}
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">netto</span>
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {formatGrosze(pkg.unitGrossGrosze)} brutto
                    </p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {formatGrosze(Math.round(pkg.priceNetGrosze / pkg.credits))} netto / szt.
                    </p>

                    <div className="mt-4 flex items-center gap-2">
                      <button
                        type="button"
                        aria-label={`Zmniejsz ilość: ${pkg.name}`}
                        onClick={() => setQuantity(pkg.id, quantity - 1)}
                        disabled={quantity <= 0 || submitting || !paymentsEnabled}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-40 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700 transition-colors"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={MAX_LINE_QUANTITY}
                        aria-label={`Ilość: ${pkg.name}`}
                        value={quantity}
                        disabled={submitting || !paymentsEnabled}
                        onChange={(e) => setQuantity(pkg.id, e.target.valueAsNumber)}
                        className="h-9 w-16 rounded-xl border border-slate-200 bg-white text-center text-sm font-semibold text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      />
                      <button
                        type="button"
                        aria-label={`Zwiększ ilość: ${pkg.name}`}
                        onClick={() => setQuantity(pkg.id, quantity + 1)}
                        disabled={quantity >= MAX_LINE_QUANTITY || submitting || !paymentsEnabled}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-40 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700 transition-colors"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {paymentsEnabled && (pricedCart || cartError) && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Podsumowanie
          </p>
          {cartError && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{cartError}</p>}
          {pricedCart && (
            <>
              <ul className="mt-3 space-y-1.5 text-sm text-slate-700 dark:text-slate-300">
                {pricedCart.lines.map((line) => (
                  <li key={line.packageId} className="flex justify-between gap-4">
                    <span>
                      {line.packageName} ×{line.quantity}
                    </span>
                    <span className="whitespace-nowrap">{formatGrosze(line.lineNetGrosze)}</span>
                  </li>
                ))}
              </ul>
              <dl className="mt-4 space-y-1 border-t border-slate-200 pt-3 text-sm dark:border-slate-800">
                <div className="flex justify-between text-slate-600 dark:text-slate-400">
                  <dt>Netto</dt>
                  <dd>{formatGrosze(pricedCart.totalNetGrosze)}</dd>
                </div>
                <div className="flex justify-between text-slate-600 dark:text-slate-400">
                  <dt>VAT{vatRates.length === 1 ? ` ${vatRates[0]}%` : ""}</dt>
                  <dd>{formatGrosze(pricedCart.totalVatGrosze)}</dd>
                </div>
                <div className="flex justify-between text-base font-bold text-slate-900 dark:text-white">
                  <dt>Brutto</dt>
                  <dd>{formatGrosze(pricedCart.totalGrossGrosze)}</dd>
                </div>
              </dl>
            </>
          )}

          {paymentsEnabled && (
            <button
              type="button"
              onClick={handlePay}
              disabled={submitting || !pricedCart}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-500/20 hover:bg-blue-500 disabled:opacity-50 transition-colors"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Zapłać online
            </button>
          )}
          {submitError && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{submitError}</p>}
        </div>
      )}
    </section>
  );
}
