"use client";

import { useRef, useState } from "react";
import { ExternalLink, FileDown, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import {
  INVOICE_STATUS_LABELS,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  formatGrosze,
  formatOrderItem,
  formatYmdPl,
  invoiceStatusLabel,
} from "@/lib/billing/labels";
import { isProformaExpired, warsawDate } from "@/lib/billing/proforma-dates";

export interface AdminOrderRow {
  id: string;
  status: keyof typeof ORDER_STATUS_LABELS;
  totalGrossGrosze: number;
  createdAt: string;
  paidAt: string | null;
  payuSandbox: boolean;
  paymentMethod: keyof typeof PAYMENT_METHOD_LABELS;
  paymentNote: string | null;
  proformaFakturowniaId: string | null;
  proformaNumber: string | null;
  proformaPdfUrl: string | null;
  proformaIssuedAt: string | null;
  /** A serialized date column: "YYYY-MM-DDT00:00:00.000Z". */
  proformaDueDate: string | null;
  proformaEmailedAt: string | null;
  proformaLastError: string | null;
  organization: { id: string; name: string };
  user: { name: string; email: string };
  items: Array<{
    packageName: string;
    creditType: "VALUATION" | "CLAIM_DETAILS";
    creditsPerPackage: number;
    quantity: number;
    lineGrossGrosze: number;
  }>;
  invoiceStatus: keyof typeof INVOICE_STATUS_LABELS;
  invoiceAttempts: number;
  invoiceNextAttemptAt: string | null;
  invoiceLastError: string | null;
  invoiceNumber: string | null;
  invoicePdfUrl: string | null;
  invoiceIssuedAt: string | null;
  invoiceEmailedAt: string | null;
  fakturowniaInvoiceId: string | null;
  ksefStatus: string | null;
  ksefId: string | null;
  ksefVerificationLink: string | null;
  /** ERROR: KSeF failure status; STALE: no confirmation 6 h after issuing. */
  ksefProblem: "ERROR" | "STALE" | null;
}

const ORDER_STATUS_CLASSES: Record<AdminOrderRow["status"], string> = {
  PENDING_PAYMENT: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  PAID: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  CANCELED: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
  FAILED: "bg-red-500/10 text-red-700 dark:text-red-400",
};

const INVOICE_STATUS_CLASSES: Record<AdminOrderRow["invoiceStatus"], string> = {
  NOT_REQUIRED: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
  PENDING: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  ISSUING: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  ISSUED: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  FAILED: "bg-red-500/10 text-red-700 dark:text-red-400",
  NEEDS_ATTENTION: "bg-red-500/10 text-red-700 dark:text-red-400",
};

const KSEF_PROBLEM_LABELS: Record<NonNullable<AdminOrderRow["ksefProblem"]>, string> = {
  ERROR: "Błąd KSeF",
  STALE: "KSeF: brak potwierdzenia",
};

const inputClass =
  "rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white";
const secondaryButtonClass =
  "inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700 transition-colors";

type InvoiceActionBody =
  | { action: "retry" }
  | { action: "refreshKsef" }
  | { action: "markManual"; invoiceNumber: string }
  | { action: "markEmailed" };
type PaymentActionBody = { action: "markPaid"; paidDate: string; note?: string } | { action: "cancel" };
type ActionBody = InvoiceActionBody | PaymentActionBody;

interface RowFeedback {
  busy: boolean;
  message?: string;
  error?: boolean;
}

const PAYMENT_METHOD_CLASSES: Record<AdminOrderRow["paymentMethod"], string> = {
  PAYU: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
  PROFORMA: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400",
};

const isResolvable = (order: AdminOrderRow) => order.invoiceStatus === "FAILED" || order.invoiceStatus === "NEEDS_ATTENTION";

function KsefCell({ order }: { order: AdminOrderRow }) {
  if (!order.ksefProblem && !order.ksefStatus && !order.ksefId && !order.ksefVerificationLink) {
    return <span className="text-slate-400">—</span>;
  }
  // The link comes from Fakturownia; only plain http(s) links are rendered.
  const safeLink = order.ksefVerificationLink && /^https?:\/\//i.test(order.ksefVerificationLink) ? order.ksefVerificationLink : null;
  return (
    <div className="flex flex-col items-start gap-1">
      {order.ksefProblem && (
        <span className="inline-block rounded-full bg-red-500/10 px-2.5 py-1 text-[11px] font-bold whitespace-nowrap text-red-700 dark:text-red-400">
          {KSEF_PROBLEM_LABELS[order.ksefProblem]}
        </span>
      )}
      {order.ksefStatus && <span className="font-medium">{order.ksefStatus}</span>}
      {order.ksefId && <span className="break-all text-[11px] text-slate-500 dark:text-slate-400">{order.ksefId}</span>}
      {safeLink && (
        <a
          href={safeLink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:underline dark:text-blue-400"
        >
          <ExternalLink className="h-3 w-3" />
          Weryfikacja
        </a>
      )}
    </div>
  );
}

function InvoiceCell({ order }: { order: AdminOrderRow }) {
  return (
    <div className="flex flex-col items-start gap-1.5">
      <span
        className={`inline-block rounded-full px-2.5 py-1 text-[11px] font-bold whitespace-nowrap ${INVOICE_STATUS_CLASSES[order.invoiceStatus]}`}
      >
        {invoiceStatusLabel(order.invoiceStatus, order.invoiceNextAttemptAt)}
      </span>
      {order.invoiceNumber && <span className="font-medium">{order.invoiceNumber}</span>}
      {order.invoiceIssuedAt && (
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          Wystawiona: {new Date(order.invoiceIssuedAt).toLocaleString("pl-PL")}
        </span>
      )}
      {order.invoiceStatus === "ISSUED" && order.fakturowniaInvoiceId && (
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          E-mail: {order.invoiceEmailedAt ? `wysłany ${new Date(order.invoiceEmailedAt).toLocaleString("pl-PL")}` : "nie"}
        </span>
      )}
      {order.invoicePdfUrl && (
        <a
          href={order.invoicePdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:underline dark:text-blue-400"
        >
          <FileDown className="h-3 w-3" />
          Pobierz PDF
        </a>
      )}
      {order.invoiceAttempts > 0 && (
        <span className="text-[11px] text-slate-500 dark:text-slate-400">Próby: {order.invoiceAttempts}</span>
      )}
      {order.invoiceLastError && (
        <p className="max-w-xs text-[11px] text-red-600 dark:text-red-400" title={order.invoiceLastError}>
          {order.invoiceLastError}
        </p>
      )}
    </div>
  );
}

/** A proforma whose document exists in Fakturownia; only such orders can be marked paid or canceled. */
const hasProforma = (order: AdminOrderRow) => order.paymentMethod === "PROFORMA" && order.proformaFakturowniaId !== null;

function PaymentCell({ order, now }: { order: AdminOrderRow; now: Date }) {
  const expired = isProformaExpired(order, now);
  const emailNotSent = hasProforma(order) && order.status === "PENDING_PAYMENT" && order.proformaEmailedAt === null;
  return (
    <div className="flex flex-col items-start gap-1.5">
      <span
        className={`inline-block rounded-full px-2.5 py-1 text-[11px] font-bold whitespace-nowrap ${PAYMENT_METHOD_CLASSES[order.paymentMethod]}`}
      >
        {PAYMENT_METHOD_LABELS[order.paymentMethod]}
      </span>
      {order.paymentMethod === "PROFORMA" && order.proformaNumber && <span className="font-medium">{order.proformaNumber}</span>}
      {order.paymentMethod === "PROFORMA" && order.proformaDueDate && (
        <span className="text-[11px] text-slate-500 dark:text-slate-400">Termin: {formatYmdPl(order.proformaDueDate)}</span>
      )}
      {expired && (
        <span className="inline-block rounded-full bg-red-500/10 px-2.5 py-1 text-[11px] font-bold whitespace-nowrap text-red-700 dark:text-red-400">
          Wygasła
        </span>
      )}
      {emailNotSent && (
        <span
          title={order.proformaLastError ?? undefined}
          className="inline-block rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold whitespace-nowrap text-amber-700 dark:text-amber-400"
        >
          Proforma niewysłana e-mailem
        </span>
      )}
      {hasProforma(order) && order.proformaEmailedAt && (
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          E-mail: wysłany {new Date(order.proformaEmailedAt).toLocaleString("pl-PL")}
        </span>
      )}
      {order.proformaPdfUrl && (
        <a
          href={order.proformaPdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:underline dark:text-blue-400"
        >
          <FileDown className="h-3 w-3" />
          Pobierz proformę
        </a>
      )}
      {order.paymentNote && (
        <p className="max-w-xs break-words text-[11px] text-slate-500 dark:text-slate-400">Notatka wpłaty: {order.paymentNote}</p>
      )}
    </div>
  );
}

function MarkPaidForm({
  order,
  busy,
  onSubmit,
}: {
  order: AdminOrderRow;
  busy: boolean;
  onSubmit: (paidDate: string, note: string) => void;
}) {
  const [paidDate, setPaidDate] = useState(() => warsawDate(new Date()));
  const [note, setNote] = useState("");
  return (
    <form
      className="flex max-w-xs flex-col items-start gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(paidDate, note);
      }}
    >
      <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400">
        Data wpłaty
        <input
          type="date"
          value={paidDate}
          onChange={(e) => setPaidDate(e.target.value)}
          min={warsawDate(new Date(order.createdAt))}
          max={warsawDate(new Date())}
          required
          className={`${inputClass} w-40 dark:[color-scheme:dark]`}
        />
      </label>
      <label className="flex w-full flex-col gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400">
        Notatka (opcjonalnie)
        <input
          aria-label="Notatka do wpłaty"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder="Np. numer przelewu"
          className={`${inputClass} w-full`}
        />
      </label>
      <p className="text-[11px] text-slate-600 dark:text-slate-300">
        Kredyty: {order.items.map(formatOrderItem).join(", ")}, kwota {formatGrosze(order.totalGrossGrosze)}. Potwierdzam, że wpłata
        jest na koncie.
      </p>
      <button
        type="submit"
        disabled={busy || paidDate === ""}
        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
      >
        {busy && <Loader2 className="h-3 w-3 animate-spin" />}
        Potwierdź wpłatę
      </button>
    </form>
  );
}

function PaymentActions({
  order,
  feedback,
  onAction,
}: {
  order: AdminOrderRow;
  feedback: RowFeedback | undefined;
  onAction: (orderId: string, body: ActionBody) => Promise<boolean>;
}) {
  const [markPaidOpen, setMarkPaidOpen] = useState(false);
  if (!hasProforma(order)) return null;
  const busy = feedback?.busy === true;
  const canMarkPaid = order.status === "PENDING_PAYMENT" || order.status === "CANCELED";
  const canCancel = order.status === "PENDING_PAYMENT";
  if (!canMarkPaid && !canCancel) return null;

  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {canMarkPaid && (
          <button
            type="button"
            onClick={() => setMarkPaidOpen((open) => !open)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
          >
            Oznacz jako opłacone
          </button>
        )}
        {canCancel && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Anulować zamówienie z proformą? Proforma w Fakturowni pozostaje bez zmian.")) {
                void onAction(order.id, { action: "cancel" });
              }
            }}
            disabled={busy}
            className={secondaryButtonClass}
          >
            Anuluj
          </button>
        )}
      </div>
      {canMarkPaid && markPaidOpen && (
        <MarkPaidForm
          order={order}
          busy={busy}
          onSubmit={async (paidDate, note) => {
            const trimmed = note.trim();
            const body: PaymentActionBody = trimmed ? { action: "markPaid", paidDate, note: trimmed } : { action: "markPaid", paidDate };
            if (await onAction(order.id, body)) setMarkPaidOpen(false);
          }}
        />
      )}
    </div>
  );
}

function InvoiceActions({
  order,
  fakturowniaConfigured,
  feedback,
  onAction,
}: {
  order: AdminOrderRow;
  fakturowniaConfigured: boolean;
  feedback: RowFeedback | undefined;
  onAction: (orderId: string, body: ActionBody) => Promise<boolean>;
}) {
  const [manualOpen, setManualOpen] = useState(false);
  const [manualNumber, setManualNumber] = useState("");
  const busy = feedback?.busy === true;
  const resolvable = isResolvable(order);
  const canRefreshKsef = order.invoiceStatus === "ISSUED" && order.fakturowniaInvoiceId !== null;
  const canMarkEmailed = order.invoiceStatus === "ISSUED" && order.invoiceEmailedAt === null;
  const notConfiguredTitle = fakturowniaConfigured ? undefined : "Fakturownia nie jest skonfigurowana.";

  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {resolvable && (
          <button
            type="button"
            onClick={() => onAction(order.id, { action: "retry" })}
            disabled={busy || !fakturowniaConfigured}
            title={notConfiguredTitle}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
            Ponów fakturę
          </button>
        )}
        {resolvable && (
          <button type="button" onClick={() => setManualOpen((open) => !open)} disabled={busy} className={secondaryButtonClass}>
            Oznacz jako wystawioną ręcznie
          </button>
        )}
        {canRefreshKsef && (
          <button
            type="button"
            onClick={() => onAction(order.id, { action: "refreshKsef" })}
            disabled={busy || !fakturowniaConfigured}
            title={notConfiguredTitle}
            className={secondaryButtonClass}
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Odśwież KSeF
          </button>
        )}
        {canMarkEmailed && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Potwierdź, że faktura została wysłana klientowi ręcznie z Fakturowni.")) {
                void onAction(order.id, { action: "markEmailed" });
              }
            }}
            disabled={busy}
            className={secondaryButtonClass}
          >
            Oznacz e-mail jako wysłany
          </button>
        )}
      </div>

      {resolvable && manualOpen && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await onAction(order.id, { action: "markManual", invoiceNumber: manualNumber })) {
              setManualOpen(false);
              setManualNumber("");
            }
          }}
        >
          <input
            aria-label="Numer faktury"
            value={manualNumber}
            onChange={(e) => setManualNumber(e.target.value)}
            maxLength={64}
            placeholder="Numer faktury"
            className={`${inputClass} w-44`}
          />
          <button
            type="submit"
            disabled={busy || manualNumber.trim() === ""}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
          >
            Zapisz
          </button>
        </form>
      )}
    </div>
  );
}

function RowMessage({ feedback }: { feedback: RowFeedback | undefined }) {
  if (!feedback?.message) return null;
  return (
    <p
      role="status"
      className={`max-w-xs text-[11px] ${feedback.error ? "text-red-600 dark:text-red-400" : "text-slate-500 dark:text-slate-400"}`}
    >
      {feedback.message}
    </p>
  );
}

export default function AdminOrdersTable({
  orders,
  fakturowniaConfigured,
  onChanged,
}: {
  orders: AdminOrderRow[];
  fakturowniaConfigured: boolean;
  /** Called after an action succeeded, so the list can be reloaded. */
  onChanged: () => void;
}) {
  const [feedback, setFeedback] = useState<Record<string, RowFeedback>>({});
  const busyRef = useRef(new Set<string>());
  const now = new Date();

  const runAction = async (orderId: string, body: ActionBody): Promise<boolean> => {
    if (busyRef.current.has(orderId)) return false;
    busyRef.current.add(orderId);
    setFeedback((prev) => ({ ...prev, [orderId]: { busy: true } }));
    try {
      const endpoint = body.action === "markPaid" || body.action === "cancel" ? "payment" : "invoice";
      const res = await fetch(`/api/admin/orders/${encodeURIComponent(orderId)}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = typeof json?.error === "string" && json.error ? json.error : "Nie udało się wykonać akcji.";
        setFeedback((prev) => ({ ...prev, [orderId]: { busy: false, error: true, message } }));
        return false;
      }
      const message =
        body.action === "retry"
          ? "Ponowiono — faktura jest wystawiana."
          : body.action === "markManual"
            ? "Oznaczono jako wystawioną ręcznie."
            : body.action === "markPaid"
              ? "Oznaczono jako opłacone. Faktura jest wystawiana."
              : body.action === "cancel"
                ? "Zamówienie anulowane."
                : body.action === "markEmailed"
                  ? "Oznaczono e-mail z fakturą jako wysłany."
                  : json?.result === "SKIPPED"
                    ? "Status KSeF jest już ostateczny."
                    : "Status KSeF odświeżony.";
      setFeedback((prev) => ({ ...prev, [orderId]: { busy: false, message } }));
      onChanged();
      return true;
    } catch {
      setFeedback((prev) => ({
        ...prev,
        [orderId]: { busy: false, error: true, message: "Wystąpił błąd sieciowy. Spróbuj ponownie." },
      }));
      return false;
    } finally {
      busyRef.current.delete(orderId);
    }
  };

  return (
    <table className="w-full text-left text-xs">
      <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 uppercase tracking-wider dark:border-slate-800 dark:bg-slate-950/80 dark:text-slate-400">
        <tr>
          <th className="px-5 py-3.5 font-semibold">Data</th>
          <th className="px-5 py-3.5 font-semibold">Organizacja</th>
          <th className="px-5 py-3.5 font-semibold">Zamawiający</th>
          <th className="px-5 py-3.5 font-semibold">Pozycje</th>
          <th className="px-5 py-3.5 font-semibold">Brutto</th>
          <th className="px-5 py-3.5 font-semibold">Status</th>
          <th className="px-5 py-3.5 font-semibold">Płatność</th>
          <th className="px-5 py-3.5 font-semibold">Faktura</th>
          <th className="px-5 py-3.5 font-semibold">KSeF</th>
          <th className="px-5 py-3.5 font-semibold">Akcje</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 text-slate-700 dark:divide-slate-800/60 dark:text-slate-300">
        {orders.length === 0 ? (
          <tr>
            <td colSpan={10} className="px-5 py-8 text-center text-slate-500">
              Brak zamówień.
            </td>
          </tr>
        ) : (
          orders.map((order) => (
            <tr key={order.id} className="align-top hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
              <td className="px-5 py-4 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                {new Date(order.createdAt).toLocaleString("pl-PL")}
              </td>
              <td className="px-5 py-4 font-medium text-slate-900 dark:text-white">{order.organization.name}</td>
              <td className="px-5 py-4">
                <div>{order.user.name}</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">{order.user.email}</div>
              </td>
              <td className="px-5 py-4">{order.items.map(formatOrderItem).join(", ")}</td>
              <td className="px-5 py-4 font-bold text-slate-900 dark:text-white whitespace-nowrap">
                {formatGrosze(order.totalGrossGrosze)}
              </td>
              <td className="px-5 py-4">
                <div className="flex flex-col items-start gap-1.5">
                  <span
                    className={`inline-block rounded-full px-2.5 py-1 text-[11px] font-bold whitespace-nowrap ${ORDER_STATUS_CLASSES[order.status]}`}
                  >
                    {ORDER_STATUS_LABELS[order.status]}
                  </span>
                  {order.payuSandbox && (
                    <span className="inline-block rounded-full bg-violet-500/10 px-2.5 py-1 text-[11px] font-bold text-violet-700 dark:text-violet-400">
                      sandbox
                    </span>
                  )}
                </div>
              </td>
              <td className="px-5 py-4">
                <PaymentCell order={order} now={now} />
              </td>
              <td className="px-5 py-4">
                <InvoiceCell order={order} />
              </td>
              <td className="px-5 py-4">
                <KsefCell order={order} />
              </td>
              <td className="px-5 py-4">
                <div className="flex flex-col items-start gap-1.5">
                  <PaymentActions order={order} feedback={feedback[order.id]} onAction={runAction} />
                  <InvoiceActions
                    order={order}
                    fakturowniaConfigured={fakturowniaConfigured}
                    feedback={feedback[order.id]}
                    onAction={runAction}
                  />
                  <RowMessage feedback={feedback[order.id]} />
                </div>
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
