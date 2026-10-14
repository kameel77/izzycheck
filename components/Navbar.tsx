"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Car, FileText, History, ShieldAlert, LogOut, CheckCircle2, AlertTriangle, Building2, Users } from "lucide-react";
import { useEffect, useState } from "react";

import { ThemeToggle } from "@/components/ThemeToggle";

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isMockEnv, setIsMockEnv] = useState<boolean>(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated) {
          setCurrentUser(data.user);
        }
      })
      .catch(() => {});

    fetch("/api/config")
      .then((res) => res.json())
      .then((data) => {
        if (data && typeof data.isMockMode === "boolean") {
          setIsMockEnv(data.isMockMode);
        }
      })
      .catch(() => {});
  }, [pathname]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };

  if (pathname === "/login") return null;

  return (
    <>
      {isMockEnv && (
        <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-1.5 text-center text-xs font-bold text-amber-700 dark:text-amber-300 flex items-center justify-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500 dark:text-amber-400" />
          <span>ŚRODOWISKO TESTOWE / MOCK — Raporty wykorzystują zanonimizowane próbki Audatex. Domyślny tryb produkcyjny jest wyłączony.</span>
        </div>
      )}

      <header className="sticky top-0 z-50 w-full border-b border-slate-200 bg-white/90 dark:border-slate-800 dark:bg-slate-900/90 backdrop-blur-md transition-colors">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-8">
            <Link href="/dashboard" className="flex items-center gap-3 group">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-600 to-cyan-500 text-white shadow-md shadow-blue-500/20 group-hover:scale-105 transition-transform">
                <Car className="h-6 w-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">Izzy<span className="text-blue-500">Check</span></span>
                  <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold text-blue-600 dark:text-blue-400 border border-blue-500/20">B2B MVP</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Audatex VIN Verification</p>
              </div>
            </Link>

            <nav className="hidden md:flex items-center gap-1">
              <Link
                href="/dashboard"
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  pathname === "/dashboard"
                    ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200"
                }`}
              >
                <CheckCircle2 className="h-4 w-4" />
                Pulpit
              </Link>

              <Link
                href="/reports/new"
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  pathname === "/reports/new"
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200"
                }`}
              >
                <FileText className="h-4 w-4" />
                Nowy Raport VIN
              </Link>

              <Link
                href="/history"
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  pathname === "/history"
                    ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200"
                }`}
              >
                <History className="h-4 w-4" />
                Historia Raportów
              </Link>

              {currentUser?.role === "ADMIN" && (
                <Link
                  href="/admin/organizations"
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    pathname.startsWith("/admin/organizations")
                      ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200"
                  }`}
                >
                  <Building2 className="h-4 w-4" />
                  Organizacje (Admin)
                </Link>
              )}

              {(currentUser?.role === "MANAGER" || currentUser?.role === "ADMIN") && (
                <Link
                  href="/team"
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    pathname === "/team"
                      ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200"
                  }`}
                >
                  <Users className="h-4 w-4" />
                  Mój Zespół (Manager)
                </Link>
              )}

              {currentUser?.role === "ADMIN" && (
                <Link
                  href="/audit"
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    pathname === "/audit"
                      ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200"
                  }`}
                >
                  <ShieldAlert className="h-4 w-4" />
                  Log Audytowy (Admin)
                </Link>
              )}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            {currentUser && (
              <>
                <ThemeToggle />
                <div className="flex items-center gap-3 pl-3 border-l border-slate-200 dark:border-slate-800">
                  <div className="hidden sm:block text-right">
                    <p className="text-xs font-semibold text-slate-900 dark:text-white">{currentUser.name}</p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">
                      {currentUser.email} ({currentUser.role})
                      {currentUser.organization?.name ? ` • ${currentUser.organization.name}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleLogout}
                    title="Wyloguj się"
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white transition-colors"
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>
    </>
  );
}
