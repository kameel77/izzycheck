"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FileText, History, ShieldAlert, LogOut, CheckCircle2, AlertTriangle, Building2, Users, Menu, X, Coins, Tags } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ThemeToggle } from "@/components/ThemeToggle";

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isMockEnv, setIsMockEnv] = useState<boolean>(false);
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsMenuOpen(false);

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

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMenuOpen]);

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
          <Link href="/dashboard" className="flex items-center group">
            <img
              src="/izzycheck-logo.svg"
              alt="IzzyCheck"
              className="h-9 sm:h-10 w-auto transition-transform group-hover:scale-[1.02] dark:bg-white/95 dark:px-2.5 dark:py-1 dark:rounded-lg"
            />
          </Link>

          <div className="flex items-center gap-3">
            {currentUser && (
              <>
                <ThemeToggle />
                <div className="flex items-center gap-3 pl-3 border-l border-slate-200 dark:border-slate-800">
                  <span className="hidden sm:inline-block text-sm font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                    {currentUser.name}
                  </span>
                  <button
                    type="button"
                    onClick={handleLogout}
                    title="Wyloguj się"
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white transition-colors"
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                </div>

                <div className="relative" ref={menuRef}>
                  <button
                    type="button"
                    onClick={() => setIsMenuOpen((prev) => !prev)}
                    aria-label="Menu nawigacji"
                    aria-expanded={isMenuOpen}
                    title="Menu nawigacji"
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white transition-colors"
                  >
                    {isMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                  </button>

                  {isMenuOpen && (
                    <nav className="absolute right-0 top-full mt-2 w-64 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-800 dark:bg-slate-900 flex flex-col gap-1 z-50">
                      <div className="sm:hidden px-3 py-2 border-b border-slate-100 dark:border-slate-800 mb-1">
                        <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">{currentUser.name}</p>
                      </div>

                      <Link
                        href="/dashboard"
                        onClick={() => setIsMenuOpen(false)}
                        className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                          pathname === "/dashboard"
                            ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white"
                            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200"
                        }`}
                      >
                        <CheckCircle2 className="h-4 w-4 shrink-0" />
                        Pulpit
                      </Link>

                      <Link
                        href="/reports/new"
                        onClick={() => setIsMenuOpen(false)}
                        className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                          pathname === "/reports/new"
                            ? "bg-blue-600 text-white shadow-sm"
                            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200"
                        }`}
                      >
                        <FileText className="h-4 w-4 shrink-0" />
                        Nowy Raport VIN
                      </Link>

                      <Link
                        href="/history"
                        onClick={() => setIsMenuOpen(false)}
                        className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                          pathname === "/history"
                            ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white"
                            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200"
                        }`}
                      >
                        <History className="h-4 w-4 shrink-0" />
                        Historia Raportów
                      </Link>

                      {currentUser?.organizationId && (
                        <Link
                          href="/credits"
                          onClick={() => setIsMenuOpen(false)}
                          className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                            pathname === "/credits"
                              ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white"
                              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200"
                          }`}
                        >
                          <Coins className="h-4 w-4 shrink-0" />
                          Kredyty
                        </Link>
                      )}

                      {currentUser?.role === "ADMIN" && (
                        <Link
                          href="/admin/organizations"
                          onClick={() => setIsMenuOpen(false)}
                          className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                            pathname.startsWith("/admin/organizations")
                              ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white"
                              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200"
                          }`}
                        >
                          <Building2 className="h-4 w-4 shrink-0" />
                          Organizacje (Admin)
                        </Link>
                      )}

                      {currentUser?.role === "ADMIN" && (
                        <Link
                          href="/admin/credit-packages"
                          onClick={() => setIsMenuOpen(false)}
                          className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                            pathname.startsWith("/admin/credit-packages")
                              ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white"
                              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200"
                          }`}
                        >
                          <Tags className="h-4 w-4 shrink-0" />
                          Cennik kredytów
                        </Link>
                      )}

                      {(currentUser?.role === "MANAGER" || currentUser?.role === "ADMIN") && (
                        <Link
                          href="/team"
                          onClick={() => setIsMenuOpen(false)}
                          className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                            pathname === "/team"
                              ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white"
                              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200"
                          }`}
                        >
                          <Users className="h-4 w-4 shrink-0" />
                          Mój Zespół (Manager)
                        </Link>
                      )}

                      {currentUser?.role === "ADMIN" && (
                        <Link
                          href="/audit"
                          onClick={() => setIsMenuOpen(false)}
                          className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                            pathname === "/audit"
                              ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white"
                              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200"
                          }`}
                        >
                          <ShieldAlert className="h-4 w-4 shrink-0" />
                          Log Audytowy (Admin)
                        </Link>
                      )}
                    </nav>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </header>
    </>
  );
}
