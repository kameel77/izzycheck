"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 60_000;

type ReturnState = "pending" | "paid" | "failed" | "timeout" | "notFound";

function PaymentReturn() {
  const orderId = useSearchParams().get("orderId");
  const [state, setState] = useState<ReturnState>(orderId ? "pending" : "notFound");

  useEffect(() => {
    if (!orderId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();

    const poll = async () => {
      let next: ReturnState = "pending";
      try {
        const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`);
        if (cancelled) return;
        if (res.status === 404) {
          next = "notFound";
        } else if (res.ok) {
          const order = await res.json();
          if (cancelled) return;
          if (order.status === "PAID") next = "paid";
          else if (order.status === "CANCELED" || order.status === "FAILED") next = "failed";
        }
      } catch {
        if (cancelled) return;
        // Transient network error: keep polling until the timeout.
      }

      if (next === "pending" && Date.now() - startedAt >= POLL_TIMEOUT_MS) next = "timeout";
      setState(next);
      if (next === "pending") timer = setTimeout(poll, POLL_INTERVAL_MS);
    };

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [orderId]);

  const backLink = (
    <Link
      href="/credits"
      className="mt-5 inline-flex items-center rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-500/20 hover:bg-blue-500 transition-colors"
    >
      Wróć do kredytów
    </Link>
  );

  return (
    <div className="mx-auto max-w-xl px-4 py-16 sm:px-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
        {state === "pending" && (
          <>
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-500" />
            <p className="mt-4 text-sm text-slate-700 dark:text-slate-300">Sprawdzamy status płatności...</p>
          </>
        )}
        {state === "paid" && (
          <>
            <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" />
            <p className="mt-4 text-sm text-slate-700 dark:text-slate-300">
              Płatność przyjęta. Kredyty zostały dodane do konta organizacji.
            </p>
            {backLink}
          </>
        )}
        {state === "failed" && (
          <>
            <XCircle className="mx-auto h-8 w-8 text-red-500" />
            <p className="mt-4 text-sm text-slate-700 dark:text-slate-300">Płatność nie została zrealizowana.</p>
            {backLink}
          </>
        )}
        {state === "timeout" && (
          <>
            <Clock className="mx-auto h-8 w-8 text-amber-500" />
            <p className="mt-4 text-sm text-slate-700 dark:text-slate-300">
              Czekamy na potwierdzenie płatności z PayU. Kredyty pojawią się automatycznie — sprawdź za chwilę stronę
              kredytów.
            </p>
            {backLink}
          </>
        )}
        {state === "notFound" && (
          <>
            <XCircle className="mx-auto h-8 w-8 text-red-500" />
            <p className="mt-4 text-sm text-slate-700 dark:text-slate-300">Nie znaleziono zamówienia.</p>
            {backLink}
          </>
        )}
      </div>
    </div>
  );
}

export default function PaymentReturnPage() {
  return (
    <Suspense fallback={null}>
      <PaymentReturn />
    </Suspense>
  );
}
