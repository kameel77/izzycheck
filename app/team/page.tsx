"use client";

import { useEffect, useState } from "react";
import {
  Users,
  Building2,
  Plus,
  Edit2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  KeyRound,
  RefreshCw,
  Loader2,
  FileText,
  ShieldCheck,
  Lock,
} from "lucide-react";

interface OrganizationData {
  id: string;
  name: string;
  nip: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  billingEmail: string;
  isActive: boolean;
  users: Array<{
    id: string;
    name: string;
    email: string;
    role: "MANAGER" | "USER" | "ADMIN" | "OPERATOR";
    isActive: boolean;
    canGenerateValuation: boolean;
    canGenerateClaimCheck: boolean;
    canGenerateClaimDetails: boolean;
    canViewOrgReports: boolean;
    createdAt: string;
    _count: {
      reports: number;
    };
  }>;
}

export default function TeamManagementPage() {
  const [orgData, setOrgData] = useState<OrganizationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);

  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    canGenerateValuation: false,
    canGenerateClaimCheck: false,
    canGenerateClaimDetails: false,
    canViewOrgReports: false,
    isActive: true,
  });

  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState("");

  const fetchTeam = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/organization/team");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Nie udało się pobrać danych zespołu.");
      } else {
        setOrgData(data.organization);
      }
    } catch (e: any) {
      setError("Wystąpił błąd sieciowy.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTeam();
  }, []);

  const generateRandomPassword = () => {
    const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$%&*";
    let pass = "";
    for (let i = 0; i < 12; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setForm((prev) => ({ ...prev, password: pass }));
  };

  const handleOpenAdd = () => {
    setEditingUser(null);
    setForm({
      name: "",
      email: "",
      password: "",
      canGenerateValuation: false,
      canGenerateClaimCheck: false,
      canGenerateClaimDetails: false,
      canViewOrgReports: false,
      isActive: true,
    });
    generateRandomPassword();
    setModalError("");
    setShowAddModal(true);
  };

  const handleOpenEdit = (user: any) => {
    setEditingUser(user);
    setForm({
      name: user.name,
      email: user.email,
      password: "",
      canGenerateValuation: user.canGenerateValuation,
      canGenerateClaimCheck: user.canGenerateClaimCheck,
      canGenerateClaimDetails: user.canGenerateClaimDetails,
      canViewOrgReports: user.canViewOrgReports,
      isActive: user.isActive,
    });
    setModalError("");
    setShowAddModal(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalLoading(true);
    setModalError("");

    try {
      const url = editingUser
        ? `/api/organization/team/${editingUser.id}`
        : "/api/organization/team";
      const method = editingUser ? "PATCH" : "POST";

      const payload: any = {
        name: form.name,
        canGenerateValuation: form.canGenerateValuation,
        canGenerateClaimCheck: form.canGenerateClaimCheck,
        canGenerateClaimDetails: form.canGenerateClaimDetails,
        canViewOrgReports: form.canViewOrgReports,
        isActive: form.isActive,
      };

      if (!editingUser) {
        payload.email = form.email;
        payload.password = form.password;
      } else if (form.password) {
        payload.password = form.password;
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        setModalError(data.error || "Wystąpił błąd podczas zapisywania pracownika.");
      } else {
        setShowAddModal(false);
        fetchTeam();
      }
    } catch (err: any) {
      setModalError("Błąd sieciowy.");
    } finally {
      setModalLoading(false);
    }
  };

  const handleQuickPermissionToggle = async (userId: string, field: string, currentValue: boolean) => {
    try {
      const res = await fetch(`/api/organization/team/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: !currentValue }),
      });
      if (res.ok) {
        fetchTeam();
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-3">
            <Users className="h-7 w-7 text-blue-600 dark:text-blue-400" />
            Zarządzanie Zespołem & Uprawnieniami
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Panel Managera: tworzenie kont pracowników, przydzielanie modułów wyceny i szkód oraz kontrola dostępu.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchTeam}
            title="Odśwież"
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors shadow-sm"
          >
            <RefreshCw className="h-4 w-4" />
            Odśwież
          </button>
          <button
            onClick={handleOpenAdd}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 shadow-sm shadow-blue-500/20 transition-all"
          >
            <Plus className="h-4 w-4" />
            Dodaj pracownika
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-xs font-medium text-red-600 dark:text-red-400">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Organization Read-Only Details Card */}
      {orgData && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">{orgData.name}</h2>
                  <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[11px] font-mono font-semibold text-blue-600 dark:text-blue-400 border border-blue-500/20">
                    NIP: {orgData.nip}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {orgData.street}, {orgData.postalCode} {orgData.city} • Faktury: {orgData.billingEmail}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-1.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400 self-start sm:self-auto">
              <Lock className="h-3.5 w-3.5 text-slate-400" />
              <span>Dane bilingowe firmy (tylko do odczytu)</span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 text-center">
            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Pracownicy w Zespole</p>
              <p className="text-xl font-bold text-slate-900 dark:text-white mt-1">{orgData.users.length}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Aktywne Konta</p>
              <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                {orgData.users.filter((u) => u.isActive).length}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Z Uprawnieniem Wyceny</p>
              <p className="text-xl font-bold text-blue-600 dark:text-blue-400 mt-1">
                {orgData.users.filter((u) => u.role === "MANAGER" || u.canGenerateValuation).length}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Z Uprawnieniem Szkód</p>
              <p className="text-xl font-bold text-purple-600 dark:text-purple-400 mt-1">
                {orgData.users.filter((u) => u.role === "MANAGER" || u.canGenerateClaimCheck || u.canGenerateClaimDetails).length}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Team Members Table */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">
            Lista Pracowników & Flagi Uprawnień
          </h2>
          <span className="text-xs text-slate-500">Kliknij przełącznik, aby błyskawicznie zmienić uprawnienie</span>
        </div>

        {loading ? (
          <div className="p-12 text-center text-xs text-slate-500 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin mr-2 text-blue-500" />
            Ładowanie listy pracowników...
          </div>
        ) : !orgData || orgData.users.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-500">Brak pracowników w Twojej organizacji.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-4">Pracownik</th>
                  <th className="py-3 px-3">Rola</th>
                  <th className="py-3 px-3 text-center">Wycena (VALUATION)</th>
                  <th className="py-3 px-3 text-center">Szkody (Weryfikacja Y/N)</th>
                  <th className="py-3 px-3 text-center">Szkody (Detale & Kosztorys)</th>
                  <th className="py-3 px-3 text-center">Raporty Organizacji</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-4 text-right">Akcje</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {orgData.users.map((u) => {
                  const isManager = u.role === "MANAGER" || u.role === "ADMIN";

                  return (
                    <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900 dark:text-white">{u.name}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">{u.email}</div>
                      </td>
                      <td className="py-3.5 px-3">
                        <span
                          className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                            isManager
                              ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20"
                              : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                          }`}
                        >
                          {u.role}
                        </span>
                      </td>

                      {/* Valuation Switch */}
                      <td className="py-3.5 px-3 text-center">
                        {isManager ? (
                          <span title="Manager ma to uprawnienie zawsze aktywne">
                            <CheckCircle2 className="h-4 w-4 text-purple-500 mx-auto" />
                          </span>
                        ) : (
                          <button
                            onClick={() => handleQuickPermissionToggle(u.id, "canGenerateValuation", u.canGenerateValuation)}
                            className={`rounded-full p-1 transition-colors ${
                              u.canGenerateValuation
                                ? "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20"
                                : "bg-slate-100 text-slate-400 hover:bg-slate-200 dark:bg-slate-800"
                            }`}
                            title="Przełącz uprawnienie wyceny"
                          >
                            {u.canGenerateValuation ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                          </button>
                        )}
                      </td>

                      {/* Claim Check Switch */}
                      <td className="py-3.5 px-3 text-center">
                        {isManager ? (
                          <span title="Manager ma to uprawnienie zawsze aktywne">
                            <CheckCircle2 className="h-4 w-4 text-purple-500 mx-auto" />
                          </span>
                        ) : (
                          <button
                            onClick={() => handleQuickPermissionToggle(u.id, "canGenerateClaimCheck", u.canGenerateClaimCheck)}
                            className={`rounded-full p-1 transition-colors ${
                              u.canGenerateClaimCheck
                                ? "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20"
                                : "bg-slate-100 text-slate-400 hover:bg-slate-200 dark:bg-slate-800"
                            }`}
                            title="Przełącz uprawnienie kontroli szkód"
                          >
                            {u.canGenerateClaimCheck ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                          </button>
                        )}
                      </td>

                      {/* Claim Details Switch */}
                      <td className="py-3.5 px-3 text-center">
                        {isManager ? (
                          <span title="Manager ma to uprawnienie zawsze aktywne">
                            <CheckCircle2 className="h-4 w-4 text-purple-500 mx-auto" />
                          </span>
                        ) : (
                          <button
                            onClick={() => handleQuickPermissionToggle(u.id, "canGenerateClaimDetails", u.canGenerateClaimDetails)}
                            className={`rounded-full p-1 transition-colors ${
                              u.canGenerateClaimDetails
                                ? "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20"
                                : "bg-slate-100 text-slate-400 hover:bg-slate-200 dark:bg-slate-800"
                            }`}
                            title="Przełącz uprawnienie szczegółów szkód"
                          >
                            {u.canGenerateClaimDetails ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                          </button>
                        )}
                      </td>

                      {/* View Org Reports Switch */}
                      <td className="py-3.5 px-3 text-center">
                        {isManager ? (
                          <span title="Manager ma to uprawnienie zawsze aktywne">
                            <CheckCircle2 className="h-4 w-4 text-purple-500 mx-auto" />
                          </span>
                        ) : (
                          <button
                            onClick={() => handleQuickPermissionToggle(u.id, "canViewOrgReports", u.canViewOrgReports)}
                            className={`rounded-full p-1 transition-colors ${
                              u.canViewOrgReports
                                ? "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20"
                                : "bg-slate-100 text-slate-400 hover:bg-slate-200 dark:bg-slate-800"
                            }`}
                            title="Przełącz uprawnienie przeglądu firmy"
                          >
                            {u.canViewOrgReports ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                          </button>
                        )}
                      </td>

                      {/* Active Status */}
                      <td className="py-3.5 px-3">
                        {isManager ? (
                          <span className="inline-flex rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">
                            Aktywny
                          </span>
                        ) : (
                          <button
                            onClick={() => handleQuickPermissionToggle(u.id, "isActive", u.isActive)}
                            className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold cursor-pointer ${
                              u.isActive
                                ? "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20"
                                : "bg-red-500/10 text-red-600 hover:bg-red-500/20"
                            }`}
                          >
                            {u.isActive ? "Aktywny" : "Zablokowany"}
                          </button>
                        )}
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        {!isManager && (
                          <button
                            onClick={() => handleOpenEdit(u)}
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 transition-colors"
                            title="Edytuj dane i hasło"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Add / Edit Employee */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                {editingUser ? "Edycja Pracownika & Uprawnień" : "Nowy Pracownik Zespołu"}
              </h2>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            {modalError && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleSaveUser} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Imię i nazwisko</label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="np. Piotr Nowak"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Adres e-mail</label>
                  <input
                    type="email"
                    required
                    disabled={Boolean(editingUser)}
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="piotr@firma.pl"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white disabled:opacity-50"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {editingUser ? "Nowe hasło (pozostaw puste, aby nie zmieniać)" : "Hasło startowe"}
                  </label>
                  <button
                    type="button"
                    onClick={generateRandomPassword}
                    className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Wygeneruj bezpieczne hasło
                  </button>
                </div>
                <input
                  type="text"
                  required={!editingUser}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder={editingUser ? "Pozostaw puste, aby nie zmieniać" : "Minimum 8 znaków"}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                />
              </div>

              {/* Granular permissions */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950 space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                  Nadaj Uprawnienia dla Pracownika
                </h4>

                <label className="flex items-center gap-3 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.canGenerateValuation}
                    onChange={(e) => setForm({ ...form, canGenerateValuation: e.target.checked })}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <div>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">Generowanie Wyceny Rynkowej</span>
                    <p className="text-[11px] text-slate-500">Pozwala na tworzenie raportów wyceny pojazdu (wraz z automatyczną kontrolą szkód)</p>
                  </div>
                </label>

                <label className="flex items-center gap-3 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.canGenerateClaimCheck}
                    onChange={(e) => setForm({ ...form, canGenerateClaimCheck: e.target.checked })}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <div>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">Weryfikacja Obecności Szkód</span>
                    <p className="text-[11px] text-slate-500">Pozwala na uruchomienie podstawowego sprawdzenia obecności wpisów szkód (Y/N)</p>
                  </div>
                </label>

                <label className="flex items-center gap-3 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.canGenerateClaimDetails}
                    onChange={(e) => setForm({ ...form, canGenerateClaimDetails: e.target.checked })}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <div>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">Szczegóły Szkód & Kosztorysy</span>
                    <p className="text-[11px] text-slate-500">Pozwala na pobranie szczegółowych kosztorysów, stref uszkodzeń i kwot</p>
                  </div>
                </label>

                <label className="flex items-center gap-3 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.canViewOrgReports}
                    onChange={(e) => setForm({ ...form, canViewOrgReports: e.target.checked })}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <div>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">Przegląd Raportów Całej Firmy</span>
                    <p className="text-[11px] text-slate-500">Dostęp do historii i pobierania raportów wygenerowanych przez innych członków zespołu</p>
                  </div>
                </label>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="employeeActive"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="employeeActive" className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Konto aktywne
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors"
                >
                  Anuluj
                </button>
                <button
                  type="submit"
                  disabled={modalLoading}
                  className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition-colors shadow-sm disabled:opacity-50"
                >
                  {modalLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {editingUser ? "Zapisz zmiany" : "Utwórz konto pracownika"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
