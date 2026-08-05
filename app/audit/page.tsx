"use client";

import { useEffect, useState } from "react";
import { ShieldAlert, User, Lock, AlertCircle } from "lucide-react";

export default function AuditPage() {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/audit")
      .then((res) => {
        if (res.status === 403) {
          setForbidden(true);
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (data && data.auditEvents) setEvents(data.auditEvents);
        else if (data && data.error) setError(data.error);
      })
      .catch(() => setError("Błąd pobierania logów audytowych."))
      .finally(() => setLoading(false));
  }, []);

  if (forbidden) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center space-y-4">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
          <Lock className="h-8 w-8" />
        </div>
        <h1 className="text-xl font-bold text-white">Dostęp Zastrzeżony (RBAC)</h1>
        <p className="text-sm text-slate-400">
          Rejestr zdarzeń audytowych i RODO jest dostępny wyłącznie dla zalogowanych użytkowników z rolą **ADMINISTRATORA**.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-3">
          <ShieldAlert className="h-6 w-6 text-purple-400" /> Rejestr Zdarzeń Audytowych i Compliance (RODO)
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Dostępny wyłącznie dla Administratorów. Niezmienny log zdarzeń operacyjnych i generowania raportów.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-xs font-medium text-red-400 flex items-center gap-2">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      <div className="rounded-2xl border border-slate-800 bg-slate-900/80 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs text-slate-500">Pobieranie rejestru zdarzeń...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 bg-slate-950/80 text-slate-400 uppercase tracking-wider">
                <tr>
                  <th className="px-5 py-3.5 font-semibold">Data i Czas</th>
                  <th className="px-5 py-3.5 font-semibold">Operator / Email</th>
                  <th className="px-5 py-3.5 font-semibold">Akcja Operacyjna</th>
                  <th className="px-5 py-3.5 font-semibold">Zasób</th>
                  <th className="px-5 py-3.5 font-semibold">Metadane Zdarzenia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {events.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-slate-500">
                      Brak zarejestrowanych zdarzeń audytowych.
                    </td>
                  </tr>
                ) : (
                  events.map((e) => (
                    <tr key={e.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="px-5 py-4 whitespace-nowrap text-slate-400 font-mono text-[11px]">
                        {new Date(e.createdAt).toLocaleString("pl-PL")}
                      </td>
                      <td className="px-5 py-4 font-semibold text-white">
                        <div className="flex items-center gap-2">
                          <User className="h-3.5 w-3.5 text-slate-500" />
                          <span>{e.userEmail}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                            e.action === "CREATE_REPORT"
                              ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                              : "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                          }`}
                        >
                          {e.action}
                        </span>
                      </td>
                      <td className="px-5 py-4 font-mono text-slate-300">{e.resource}</td>
                      <td className="px-5 py-4 font-mono text-[11px] text-slate-400 max-w-xs truncate">
                        {e.metadataJson || "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
