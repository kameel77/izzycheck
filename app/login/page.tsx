"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Car, Lock, Mail, ArrowRight, ShieldCheck } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("operator@izzylease.pl");
  const [password, setPassword] = useState("OperatorIzzy2026!");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Błąd logowania.");
      } else {
        router.push("/dashboard");
      }
    } catch (err: any) {
      setError("Wystąpił błąd podczas logowania.");
    } finally {
      setLoading(false);
    }
  };

  const handleQuickFill = (type: "operator" | "admin") => {
    if (type === "operator") {
      setEmail("operator@izzylease.pl");
      setPassword("OperatorIzzy2026!");
    } else {
      setEmail("admin@izzylease.pl");
      setPassword("AdminIzzy2026!");
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4 sm:p-6 lg:p-8">
      <div className="w-full max-w-md space-y-8 rounded-2xl border border-slate-800 bg-slate-900/80 p-8 backdrop-blur-xl shadow-2xl shadow-blue-500/5">
        <div className="text-center space-y-3">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-blue-600 to-cyan-500 text-white shadow-lg shadow-blue-500/25">
            <Car className="h-8 w-8" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Izzy<span className="text-blue-500">Check</span></h1>
            <p className="text-xs text-slate-400 mt-1">System Weryfikacji Pojazdów B2B — Izzy Lease</p>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-xs font-medium text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300">Adres e-mail operatora</label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-3 h-4 w-4 text-slate-500" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-slate-800 bg-slate-950/70 py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="operator@izzylease.pl"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300">Hasło</label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-3 h-4 w-4 text-slate-500" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-800 bg-slate-950/70 py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="••••••••"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/30 hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 transition-all"
          >
            {loading ? (
              <span>Logowanie...</span>
            ) : (
              <>
                Zaloguj do IzzyCheck <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </form>

        <div className="pt-4 border-t border-slate-800/80">
          <p className="text-[11px] font-semibold text-slate-400 mb-3 text-center uppercase tracking-wider">
            Szybkie zalogowanie dla testów demo:
          </p>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => handleQuickFill("operator")}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-700/60 bg-slate-800/50 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
            >
              <ShieldCheck className="h-3.5 w-3.5 text-blue-400" /> Operator B2B
            </button>
            <button
              type="button"
              onClick={() => handleQuickFill("admin")}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-700/60 bg-slate-800/50 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
            >
              <ShieldCheck className="h-3.5 w-3.5 text-purple-400" /> Admin B2B
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
