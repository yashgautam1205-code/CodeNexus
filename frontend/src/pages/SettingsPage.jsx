import { useEffect, useState } from "react";
import {
  Building2,
  CheckCircle2,
  Globe,
  KeyRound,
  LogOut,
  Mail,
  Plus,
  Shield,
  ShieldCheck,
  User,
  UserPlus,
  UserRound,
  Users,
} from "lucide-react";
import { Button, Card, ErrorNotice, PageHeader, SuccessNotice } from "../components/Feedback";
import { useAuth } from "../context/AuthContext";
import { api, getErrorMessage } from "../services/api";

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState("profile");
  const [team, setTeam] = useState([]);
  const [form, setForm] = useState({ full_name: "", email: "", password: "", role: "content_creator" });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  const isAdmin = user?.role === "admin";

  async function loadTeam() {
    try {
      const { data } = await api.get("/api/auth/users");
      setTeam(data);
    } catch (requestError) {
      setError(getErrorMessage(requestError, "User management is unavailable."));
    }
  }

  useEffect(() => {
    if (isAdmin) loadTeam();
  }, [user?.role]);

  async function addUser(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await api.post("/api/auth/users", form);
      setForm({ full_name: "", email: "", password: "", role: "content_creator" });
      setSuccess("Team member added to this organisation.");
      await loadTeam();
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Team member could not be added."));
    } finally {
      setBusy(false);
    }
  }

  function getRoleBadge(role) {
    const r = (role || "").toLowerCase();
    if (r === "admin") {
      return (
        <span className="inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30">
          Admin
        </span>
      );
    }
    if (r === "brand_manager") {
      return (
        <span className="inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
          Brand Manager
        </span>
      );
    }
    if (r === "reviewer") {
      return (
        <span className="inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold bg-sky-500/15 text-sky-400 border border-sky-500/30">
          Reviewer
        </span>
      );
    }
    return (
      <span className="inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold bg-slate-700/60 text-slate-300 border border-navy-700">
        Content Creator
      </span>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 shadow-inner">
            <UserRound size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Settings</h1>
            <p className="text-xs text-slate-400">Account details, enterprise governance safeguards, and team management</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            logout();
            window.location.assign("/login");
          }}
          className="inline-flex items-center gap-2 rounded-xl border border-navy-700 bg-navy-850 px-3.5 py-2 text-xs font-semibold text-slate-300 hover:text-rose-400 hover:border-rose-900/40 hover:bg-rose-950/20 transition shadow-sm"
        >
          <LogOut size={14} /> Sign out
        </button>
      </div>

      <ErrorNotice>{error}</ErrorNotice>
      <SuccessNotice>{success}</SuccessNotice>

      {/* Settings Navigation Tabs */}
      <div className="flex border-b border-navy-750 gap-2">
        <button
          type="button"
          onClick={() => setActiveTab("profile")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition -mb-px ${
            activeTab === "profile"
              ? "border-indigo-400 text-white"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <User size={15} /> Profile & Organisation
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("governance")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition -mb-px ${
            activeTab === "governance"
              ? "border-indigo-400 text-white"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <ShieldCheck size={15} /> Governance Safeguards
        </button>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setActiveTab("team")}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition -mb-px ${
              activeTab === "team"
                ? "border-indigo-400 text-white"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Users size={15} /> Team Members ({team.length})
          </button>
        )}
      </div>

      {/* Tab 1: Profile & Organisation */}
      {activeTab === "profile" && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* User Profile */}
          <div className="rounded-2xl border border-navy-700/60 bg-navy-850 p-6 shadow-xl">
            <div className="flex items-center gap-3 pb-4 border-b border-navy-750">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
                <UserRound size={19} />
              </div>
              <div>
                <h2 className="text-sm font-bold text-white">User Account</h2>
                <p className="text-xs text-slate-400">Authenticated session details</p>
              </div>
            </div>
            <dl className="mt-5 space-y-4">
              <Detail label="Full Name" value={user?.full_name} />
              <Detail label="Email Address" value={user?.email} />
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Workspace Role</dt>
                <dd className="mt-1">{getRoleBadge(user?.role)}</dd>
              </div>
            </dl>
          </div>

          {/* Organisation Card */}
          <div className="rounded-2xl border border-navy-700/60 bg-navy-850 p-6 shadow-xl">
            <div className="flex items-center gap-3 pb-4 border-b border-navy-750">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-600/20 text-sky-400 border border-sky-500/30">
                <Building2 size={19} />
              </div>
              <div>
                <h2 className="text-sm font-bold text-white">Organisation Workspace</h2>
                <p className="text-xs text-slate-400">Tenant environment & data isolation</p>
              </div>
            </div>
            <dl className="mt-5 space-y-4">
              <Detail label="Organisation Name" value={user?.organization_name} />
              <Detail label="Tenant Security Level" value="Enterprise Tier (Row-Level Security)" />
              <Detail label="Data Residency" value="Isolated Multi-Tenant Storage" />
            </dl>
          </div>
        </div>
      )}

      {/* Tab 2: Governance Safeguards */}
      {activeTab === "governance" && (
        <div className="rounded-2xl border border-navy-700/60 bg-navy-850 p-6 shadow-xl">
          <div className="flex items-center gap-3 pb-4 border-b border-navy-750">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600/20 text-emerald-400 border border-emerald-500/30">
              <ShieldCheck size={20} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Enterprise Governance Safeguards</h2>
              <p className="text-xs text-slate-400">Active automated compliance and audit policies enforced by BrandGuard AI</p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-navy-750 bg-navy-900/60 p-5">
              <div className="flex items-center gap-2.5 text-indigo-400 mb-3">
                <KeyRound size={18} />
                <h3 className="text-xs font-bold text-white">Strict Isolation</h3>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Requests utilize signed cryptographic tokens with organization UUID scoping. Cross-tenant leakage is strictly blocked at the database engine level.
              </p>
            </div>

            <div className="rounded-xl border border-navy-750 bg-navy-900/60 p-5">
              <div className="flex items-center gap-2.5 text-emerald-400 mb-3">
                <ShieldCheck size={18} />
                <h3 className="text-xs font-bold text-white">Authoritative Index</h3>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Only explicitly approved brand rules are synchronized with the enterprise vector retrieval index. Draft suggestions remain sequestered.
              </p>
            </div>

            <div className="rounded-xl border border-navy-750 bg-navy-900/60 p-5">
              <div className="flex items-center gap-2.5 text-sky-400 mb-3">
                <UserRound size={18} />
                <h3 className="text-xs font-bold text-white">Human In The Loop</h3>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Automated analyses produce recommendations, but human reviewers make final accept, revision, or reject decisions. No unreviewed publishing.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Team Management (admin only or tab click) */}
      {(activeTab === "team" || (isAdmin && activeTab === "profile")) && isAdmin && (
        <div className="rounded-2xl border border-navy-700/60 bg-navy-850 p-6 shadow-xl">
          <div className="flex items-center gap-3 pb-4 border-b border-navy-750">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
              <UserPlus size={19} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Organisation Team Members</h2>
              <p className="text-xs text-slate-400">
                Create user accounts within this organisation and assign governance permissions.
              </p>
            </div>
          </div>

          <form className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" onSubmit={addUser}>
            <div>
              <label className="form-label">Full Name</label>
              <input
                className="form-input text-xs"
                required
                minLength={2}
                maxLength={160}
                placeholder="Jane Doe"
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              />
            </div>
            <div>
              <label className="form-label">Email</label>
              <input
                className="form-input text-xs"
                type="email"
                required
                placeholder="user@example.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div>
              <label className="form-label">Temporary Password</label>
              <input
                className="form-input text-xs"
                type="password"
                minLength={12}
                required
                placeholder="Min 12 chars"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
            <div>
              <label className="form-label">Role</label>
              <select
                className="form-input text-xs"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
              >
                <option value="brand_manager">Brand manager</option>
                <option value="content_creator">Content creator</option>
                <option value="reviewer">Reviewer</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="sm:col-span-2 lg:col-span-4">
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-sky-600 hover:from-indigo-500 hover:to-sky-500 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-indigo-900/30 transition disabled:opacity-50"
              >
                <Plus size={14} />
                {busy ? "Adding…" : "Add organisation user"}
              </button>
            </div>
          </form>

          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-navy-750 bg-navy-900/60 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3 px-4">Name</th>
                  <th className="py-3 px-4">Email</th>
                  <th className="py-3 px-4">Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-750 text-slate-200">
                {team.map((member) => (
                  <tr key={member.id} className="hover:bg-navy-800/40 transition">
                    <td className="py-3 px-4 font-medium text-white">{member.full_name}</td>
                    <td className="py-3 px-4 text-slate-400">{member.email}</td>
                    <td className="py-3 px-4">{getRoleBadge(member.role)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-xs font-medium text-white">{value || "—"}</dd>
    </div>
  );
}
