"use client";

import { useEffect, useState } from "react";
import {
  Building2,
  Users,
  Plus,
  Edit2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  KeyRound,
  Shield,
  FileText,
  Search,
  RefreshCw,
  Loader2,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface Organization {
  id: string;
  name: string;
  nip: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  billingEmail: string;
  isActive: boolean;
  createdAt: string;
  _count: {
    users: number;
    reports: number;
  };
  users: Array<{
    id: string;
    name: string;
    email: string;
    isActive: boolean;
  }>;
}

interface UserDetail {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "MANAGER" | "USER" | "OPERATOR";
  organizationId: string | null;
  organization?: {
    id: string;
    name: string;
    nip: string;
  } | null;
  canGenerateValuation: boolean;
  canGenerateClaimCheck: boolean;
  canGenerateClaimDetails: boolean;
  canViewOrgReports: boolean;
  isActive: boolean;
  createdAt: string;
}

export default function AdminOrganizationsPage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedOrgId, setExpandedOrgId] = useState<string | null>(null);
  const [orgUsers, setOrgUsers] = useState<Record<string, UserDetail[]>>({});
  const [loadingUsers, setLoadingUsers] = useState<Record<string, boolean>>({});

  // Modals state
  const [showOrgModal, setShowOrgModal] = useState(false);
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null);
  const [showUserModal, setShowUserModal] = useState(false);
  const [userModalOrgId, setUserModalOrgId] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<UserDetail | null>(null);

  // Form states
  const [orgForm, setOrgForm] = useState({
    name: "",
    nip: "",
    street: "",
    postalCode: "",
    city: "",
    country: "PL",
    billingEmail: "",
    isActive: true,
  });

  const [userForm, setUserForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "USER" as "MANAGER" | "USER",
    canGenerateValuation: false,
    canGenerateClaimCheck: false,
    canGenerateClaimDetails: false,
    canViewOrgReports: false,
    isActive: true,
  });

  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState("");

  const fetchOrganizations = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/organizations");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Nie udało się pobrać listy organizacji.");
      } else {
        setOrganizations(data.organizations || []);
      }
    } catch (e: any) {
      setError("Wystąpił błąd sieciowy podczas pobierania danych.");
    } finally {
      setLoading(false);
    }
  };

  const fetchUsersForOrg = async (orgId: string) => {
    setLoadingUsers((prev) => ({ ...prev, [orgId]: true }));
    try {
      const res = await fetch(`/api/admin/users?organizationId=${orgId}`);
      const data = await res.json();
      if (res.ok) {
        setOrgUsers((prev) => ({ ...prev, [orgId]: data.users || [] }));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingUsers((prev) => ({ ...prev, [orgId]: false }));
    }
  };

  useEffect(() => {
    fetchOrganizations();
  }, []);

  const toggleExpandOrg = (orgId: string) => {
    if (expandedOrgId === orgId) {
      setExpandedOrgId(null);
    } else {
      setExpandedOrgId(orgId);
      if (!orgUsers[orgId]) {
        fetchUsersForOrg(orgId);
      }
    }
  };

  const generateRandomPassword = () => {
    const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$%&*";
    let pass = "";
    for (let i = 0; i < 12; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setUserForm((prev) => ({ ...prev, password: pass }));
  };

  const handleOpenAddOrg = () => {
    setEditingOrg(null);
    setOrgForm({
      name: "",
      nip: "",
      street: "",
      postalCode: "",
      city: "",
      country: "PL",
      billingEmail: "",
      isActive: true,
    });
    setModalError("");
    setShowOrgModal(true);
  };

  const handleOpenEditOrg = (org: Organization) => {
    setEditingOrg(org);
    setOrgForm({
      name: org.name,
      nip: org.nip,
      street: org.street,
      postalCode: org.postalCode,
      city: org.city,
      country: org.country,
      billingEmail: org.billingEmail,
      isActive: org.isActive,
    });
    setModalError("");
    setShowOrgModal(true);
  };

  const handleSaveOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalLoading(true);
    setModalError("");

    try {
      const url = editingOrg
        ? `/api/admin/organizations/${editingOrg.id}`
        : "/api/admin/organizations";
      const method = editingOrg ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(orgForm),
      });

      const data = await res.json();
      if (!res.ok) {
        setModalError(data.error || "Wystąpił błąd zapisu organizacji.");
      } else {
        setShowOrgModal(false);
        fetchOrganizations();
      }
    } catch (err: any) {
      setModalError("Błąd sieciowy podczas zapisywania organizacji.");
    } finally {
      setModalLoading(false);
    }
  };

  const handleOpenAddUser = (orgId: string) => {
    setUserModalOrgId(orgId);
    setEditingUser(null);
    setUserForm({
      name: "",
      email: "",
      password: "",
      role: "USER",
      canGenerateValuation: false,
      canGenerateClaimCheck: false,
      canGenerateClaimDetails: false,
      canViewOrgReports: false,
      isActive: true,
    });
    generateRandomPassword();
    setModalError("");
    setShowUserModal(true);
  };

  const handleOpenEditUser = (user: UserDetail) => {
    setUserModalOrgId(user.organizationId);
    setEditingUser(user);
    setUserForm({
      name: user.name,
      email: user.email,
      password: "", // empty means keep existing
      role: user.role === "MANAGER" ? "MANAGER" : "USER",
      canGenerateValuation: user.canGenerateValuation,
      canGenerateClaimCheck: user.canGenerateClaimCheck,
      canGenerateClaimDetails: user.canGenerateClaimDetails,
      canViewOrgReports: user.canViewOrgReports,
      isActive: user.isActive,
    });
    setModalError("");
    setShowUserModal(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalLoading(true);
    setModalError("");

    try {
      const url = editingUser
        ? `/api/admin/users/${editingUser.id}`
        : "/api/admin/users";
      const method = editingUser ? "PATCH" : "POST";

      const payload: any = {
        name: userForm.name,
        email: userForm.email,
        role: userForm.role,
        canGenerateValuation: userForm.canGenerateValuation,
        canGenerateClaimCheck: userForm.canGenerateClaimCheck,
        canGenerateClaimDetails: userForm.canGenerateClaimDetails,
        canViewOrgReports: userForm.canViewOrgReports,
        isActive: userForm.isActive,
      };

      if (!editingUser) {
        payload.organizationId = userModalOrgId;
        payload.password = userForm.password;
      } else if (userForm.password) {
        payload.password = userForm.password;
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        setModalError(data.error || "Wystąpił błąd zapisu użytkownika.");
      } else {
        setShowUserModal(false);
        if (userModalOrgId) {
          fetchUsersForOrg(userModalOrgId);
        }
        fetchOrganizations();
      }
    } catch (err: any) {
      setModalError("Błąd sieciowy podczas zapisywania użytkownika.");
    } finally {
      setModalLoading(false);
    }
  };

  const handleToggleUserActive = async (user: UserDetail) => {
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !user.isActive }),
      });
      if (res.ok && user.organizationId) {
        fetchUsersForOrg(user.organizationId);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const filteredOrgs = organizations.filter(
    (o) =>
      o.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      o.nip.includes(searchQuery) ||
      o.city.toLowerCase().includes(searchQuery.toLowerCase()) ||
      o.billingEmail.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-3">
            <Building2 className="h-7 w-7 text-blue-600 dark:text-blue-400" />
            Zarządzanie Organizacjami & Użytkownikami
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Panel Administratora IzzyCheck: dane fakturowe firm, przypisanie managerów i granularne uprawnienia pracowników.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchOrganizations}
            title="Odśwież"
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors shadow-sm"
          >
            <RefreshCw className="h-4 w-4" />
            Odśwież
          </button>
          <button
            onClick={handleOpenAddOrg}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 shadow-sm shadow-blue-500/20 transition-all"
          >
            <Plus className="h-4 w-4" />
            Nowa Organizacja
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-xs font-medium text-red-600 dark:text-red-400">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Liczba Firm</p>
          <p className="text-2xl font-bold text-slate-900 dark:text-white mt-2">{organizations.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Aktywne Organizacje</p>
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-2">
            {organizations.filter((o) => o.isActive).length}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Łączna Liczba Kont B2B</p>
          <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-2">
            {organizations.reduce((acc, o) => acc + (o._count?.users || 0), 0)}
          </p>
        </div>
      </div>

      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Szukaj po nazwie firmy, NIP, mieście lub adresie e-mail..."
          className="w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 py-2.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white dark:focus:border-blue-400 shadow-sm"
        />
      </div>

      {/* Organizations List */}
      <div className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center p-12 text-slate-500 text-xs">
            <Loader2 className="h-6 w-6 animate-spin text-blue-500 mr-2" />
            Ładowanie listy organizacji...
          </div>
        ) : filteredOrgs.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            Nie odnaleziono organizacji spełniających kryteria.
          </div>
        ) : (
          filteredOrgs.map((org) => {
            const isExpanded = expandedOrgId === org.id;
            const users = orgUsers[org.id] || [];
            const isUsersLoading = loadingUsers[org.id];

            return (
              <div
                key={org.id}
                className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 overflow-hidden transition-all"
              >
                {/* Org Summary Card Header */}
                <div className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-3">
                      <span className="text-base font-bold text-slate-900 dark:text-white">{org.name}</span>
                      <span className="rounded-full bg-blue-500/10 px-2.5 py-0.5 text-[11px] font-mono font-semibold text-blue-600 dark:text-blue-400 border border-blue-500/20">
                        NIP: {org.nip}
                      </span>
                      {org.isActive ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="h-3 w-3" /> Aktywna
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-600 dark:text-red-400">
                          <XCircle className="h-3 w-3" /> Zablokowana
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {org.street}, {org.postalCode} {org.city} • E-mail do faktur: <span className="font-medium text-slate-700 dark:text-slate-300">{org.billingEmail}</span>
                    </p>
                  </div>

                  <div className="flex items-center gap-2 self-start md:self-auto">
                    <button
                      onClick={() => handleOpenEditOrg(org)}
                      title="Edytuj dane fakturowe"
                      className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                      Dane fakturowe
                    </button>
                    <button
                      onClick={() => handleOpenAddUser(org.id)}
                      className="flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50 transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Dodaj konto
                    </button>
                    <button
                      onClick={() => toggleExpandOrg(org.id)}
                      className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 transition-colors"
                    >
                      <Users className="h-3.5 w-3.5" />
                      <span>{org._count?.users || 0} pracowników</span>
                      {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Expanded Users Panel */}
                {isExpanded && (
                  <div className="border-t border-slate-100 bg-slate-50/50 p-5 dark:border-slate-800/60 dark:bg-slate-950/40 space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Pracownicy & Uprawnienia ({org.name})
                      </h3>
                      <button
                        onClick={() => fetchUsersForOrg(org.id)}
                        className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Odśwież pracowników
                      </button>
                    </div>

                    {isUsersLoading ? (
                      <div className="flex items-center justify-center p-6 text-xs text-slate-500">
                        <Loader2 className="h-4 w-4 animate-spin mr-2 text-blue-500" />
                        Ładowanie pracowników...
                      </div>
                    ) : users.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-500">
                        Brak utworzonych kont użytkowników w tej firmie.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                              <th className="py-2.5 px-3">Użytkownik</th>
                              <th className="py-2.5 px-3">Rola</th>
                              <th className="py-2.5 px-3 text-center">Wycena</th>
                              <th className="py-2.5 px-3 text-center">Szkody (Sprawdzenie)</th>
                              <th className="py-2.5 px-3 text-center">Szkody (Detale)</th>
                              <th className="py-2.5 px-3 text-center">Raporty Firmy</th>
                              <th className="py-2.5 px-3">Status</th>
                              <th className="py-2.5 px-3 text-right">Akcje</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                            {users.map((u) => {
                              const isManagerOrAdmin = u.role === "ADMIN" || u.role === "MANAGER";
                              return (
                                <tr key={u.id} className="hover:bg-slate-100/50 dark:hover:bg-slate-800/30">
                                  <td className="py-3 px-3">
                                    <div className="font-semibold text-slate-900 dark:text-white">{u.name}</div>
                                    <div className="text-[11px] text-slate-500 dark:text-slate-400">{u.email}</div>
                                  </td>
                                  <td className="py-3 px-3">
                                    <span
                                      className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                                        u.role === "MANAGER"
                                          ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20"
                                          : u.role === "ADMIN"
                                          ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                                          : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                                      }`}
                                    >
                                      {u.role}
                                    </span>
                                  </td>
                                  <td className="py-3 px-3 text-center">
                                    {isManagerOrAdmin || u.canGenerateValuation ? (
                                      <CheckCircle2 className="h-4 w-4 text-emerald-500 mx-auto" />
                                    ) : (
                                      <XCircle className="h-4 w-4 text-slate-300 dark:text-slate-700 mx-auto" />
                                    )}
                                  </td>
                                  <td className="py-3 px-3 text-center">
                                    {isManagerOrAdmin || u.canGenerateClaimCheck ? (
                                      <CheckCircle2 className="h-4 w-4 text-emerald-500 mx-auto" />
                                    ) : (
                                      <XCircle className="h-4 w-4 text-slate-300 dark:text-slate-700 mx-auto" />
                                    )}
                                  </td>
                                  <td className="py-3 px-3 text-center">
                                    {isManagerOrAdmin || u.canGenerateClaimDetails ? (
                                      <CheckCircle2 className="h-4 w-4 text-emerald-500 mx-auto" />
                                    ) : (
                                      <XCircle className="h-4 w-4 text-slate-300 dark:text-slate-700 mx-auto" />
                                    )}
                                  </td>
                                  <td className="py-3 px-3 text-center">
                                    {isManagerOrAdmin || u.canViewOrgReports ? (
                                      <CheckCircle2 className="h-4 w-4 text-emerald-500 mx-auto" />
                                    ) : (
                                      <XCircle className="h-4 w-4 text-slate-300 dark:text-slate-700 mx-auto" />
                                    )}
                                  </td>
                                  <td className="py-3 px-3">
                                    <button
                                      onClick={() => handleToggleUserActive(u)}
                                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold cursor-pointer transition-colors ${
                                        u.isActive
                                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20"
                                          : "bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20"
                                      }`}
                                    >
                                      {u.isActive ? "Aktywny" : "Zablokowany"}
                                    </button>
                                  </td>
                                  <td className="py-3 px-3 text-right">
                                    <button
                                      onClick={() => handleOpenEditUser(u)}
                                      className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-700 transition-colors"
                                      title="Edytuj uprawnienia i dane"
                                    >
                                      <Edit2 className="h-4 w-4" />
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Organization Modal (Add / Edit) */}
      {showOrgModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Building2 className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                {editingOrg ? "Edycja Danych Fakturowych Firmy" : "Nowa Organizacja / Firma"}
              </h2>
              <button
                onClick={() => setShowOrgModal(false)}
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

            <form onSubmit={handleSaveOrg} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Pełna nazwa firmy</label>
                <input
                  type="text"
                  required
                  value={orgForm.name}
                  onChange={(e) => setOrgForm({ ...orgForm, name: e.target.value })}
                  placeholder="np. Moto-Flota Sp. z o.o."
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">NIP</label>
                  <input
                    type="text"
                    required
                    value={orgForm.nip}
                    onChange={(e) => setOrgForm({ ...orgForm, nip: e.target.value })}
                    placeholder="10 cyfr"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Kraj</label>
                  <input
                    type="text"
                    required
                    value={orgForm.country}
                    onChange={(e) => setOrgForm({ ...orgForm, country: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Ulica i numer</label>
                <input
                  type="text"
                  required
                  value={orgForm.street}
                  onChange={(e) => setOrgForm({ ...orgForm, street: e.target.value })}
                  placeholder="np. ul. Prosta 12/4"
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Kod pocztowy</label>
                  <input
                    type="text"
                    required
                    value={orgForm.postalCode}
                    onChange={(e) => setOrgForm({ ...orgForm, postalCode: e.target.value })}
                    placeholder="XX-XXX"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Miejscowość</label>
                  <input
                    type="text"
                    required
                    value={orgForm.city}
                    onChange={(e) => setOrgForm({ ...orgForm, city: e.target.value })}
                    placeholder="np. Warszawa"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Adres e-mail do faktur</label>
                <input
                  type="email"
                  required
                  value={orgForm.billingEmail}
                  onChange={(e) => setOrgForm({ ...orgForm, billingEmail: e.target.value })}
                  placeholder="faktury@firma.pl"
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="orgActive"
                  checked={orgForm.isActive}
                  onChange={(e) => setOrgForm({ ...orgForm, isActive: e.target.checked })}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="orgActive" className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Organizacja aktywna (możliwość logowania pracowników)
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowOrgModal(false)}
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
                  {editingOrg ? "Zapisz zmiany" : "Utwórz organizację"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* User Modal (Add / Edit) */}
      {showUserModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                {editingUser ? "Edycja Użytkownika / Uprawnień" : "Nowe Konto w Organizacji"}
              </h2>
              <button
                onClick={() => setShowUserModal(false)}
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
                    value={userForm.name}
                    onChange={(e) => setUserForm({ ...userForm, name: e.target.value })}
                    placeholder="np. Jan Kowalski"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Adres e-mail</label>
                  <input
                    type="email"
                    required
                    value={userForm.email}
                    onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                    placeholder="jan@firma.pl"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Rola konta</label>
                <select
                  value={userForm.role}
                  onChange={(e) => setUserForm({ ...userForm, role: e.target.value as any })}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                >
                  <option value="USER">Pracownik (USER) — uprawnienia nadawane flagami</option>
                  <option value="MANAGER">Manager Firmy (MANAGER) — pełne prawa generowania i zarządzania zespołem</option>
                </select>
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
                  value={userForm.password}
                  onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                  placeholder={editingUser ? "Wpisz nowe hasło lub pozostaw puste" : "Minimum 8 znaków"}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                />
              </div>

              {/* Permissions switches (for USER role) */}
              {userForm.role === "USER" && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950 space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                    Granularne Uprawnienia Modułów
                  </h4>

                  <label className="flex items-center gap-3 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={userForm.canGenerateValuation}
                      onChange={(e) => setUserForm({ ...userForm, canGenerateValuation: e.target.checked })}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      Generowanie Wyceny Wartości Rynkowej (VALUATION)
                    </span>
                  </label>

                  <label className="flex items-center gap-3 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={userForm.canGenerateClaimCheck}
                      onChange={(e) => setUserForm({ ...userForm, canGenerateClaimCheck: e.target.checked })}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      Weryfikacja Obecności Szkód (CLAIM_CHECK)
                    </span>
                  </label>

                  <label className="flex items-center gap-3 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={userForm.canGenerateClaimDetails}
                      onChange={(e) => setUserForm({ ...userForm, canGenerateClaimDetails: e.target.checked })}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      Szczegóły Szkód & Kosztorysy (CLAIM_DETAILS)
                    </span>
                  </label>

                  <label className="flex items-center gap-3 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={userForm.canViewOrgReports}
                      onChange={(e) => setUserForm({ ...userForm, canViewOrgReports: e.target.checked })}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      Przegląd Raportów Całej Firmy (Wspólna Historia)
                    </span>
                  </label>
                </div>
              )}

              {userForm.role === "MANAGER" && (
                <div className="rounded-xl border border-purple-500/30 bg-purple-500/10 p-3 text-xs text-purple-700 dark:text-purple-300">
                  Manager posiada w systemie domyślnie aktywne wszystkie uprawnienia generowania raportów oraz wgląd w historię całego zespołu.
                </div>
              )}

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="userActive"
                  checked={userForm.isActive}
                  onChange={(e) => setUserForm({ ...userForm, isActive: e.target.checked })}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="userActive" className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Konto aktywne (zezwolenie na logowanie)
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowUserModal(false)}
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
                  {editingUser ? "Zapisz uprawnienia" : "Utwórz konto"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
