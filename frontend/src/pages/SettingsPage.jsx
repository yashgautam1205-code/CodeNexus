import { useEffect, useState } from "react";
import { KeyRound, Shield, ShieldCheck, UserRound, UserPlus } from "lucide-react";
import { Button, Card, ErrorNotice, PageHeader, SuccessNotice } from "../components/Feedback";
import { useAuth } from "../context/AuthContext";
import { api, getErrorMessage } from "../services/api";

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const [team, setTeam] = useState([]);
  const [form, setForm] = useState({ full_name: "", email: "", password: "", role: "content_creator" });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadTeam() {
    try {
      const { data } = await api.get("/api/auth/users");
      setTeam(data);
    } catch (requestError) {
      setError(getErrorMessage(requestError, "User management is unavailable."));
    }
  }

  useEffect(() => {
    if (user?.role === "admin") loadTeam();
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

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Account & Workspace"
        title="Settings"
        description="Account details and active governance permissions for this session."
      />
      <ErrorNotice>{error}</ErrorNotice>
      <SuccessNotice>{success}</SuccessNotice>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30">
              <UserRound size={19} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">User Profile</h2>
              <p className="text-xs text-slate-400">Authenticated account information</p>
            </div>
          </div>
          <dl className="mt-6 space-y-4">
            <Detail label="Full Name" value={user?.full_name} />
            <Detail label="Email Address" value={user?.email} />
            <Detail label="Workspace Role" value={user?.role?.replaceAll("_", " ")} />
            <Detail label="Organisation" value={user?.organization_name} />
          </dl>
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30">
              <ShieldCheck size={19} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Governance Safeguards</h2>
              <p className="text-xs text-slate-400">Active enterprise controls</p>
            </div>
          </div>
          <ul className="mt-5 space-y-4 text-xs text-slate-300">
            <li className="flex gap-3">
              <KeyRound className="mt-0.5 shrink-0 text-blue-400" size={16} />
              Requests use a signed bearer token; organisation data is strictly isolated on the backend.
            </li>
            <li className="flex gap-3">
              <ShieldCheck className="mt-0.5 shrink-0 text-emerald-400" size={16} />
              Only explicitly approved rules are authoritative retrieval sources.
            </li>
            <li className="flex gap-3">
              <UserRound className="mt-0.5 shrink-0 text-cyan-400" size={16} />
              Human reviewers control accept/reject decisions. No automatic publishing without human review.
            </li>
          </ul>
          <Button
            className="mt-6"
            variant="secondary"
            onClick={() => {
              logout();
              window.location.assign("/login");
            }}
          >
            Sign out
          </Button>
        </Card>
      </div>

      {user?.role === "admin" && (
        <Card>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30">
              <UserPlus size={19} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Organisation Team Members</h2>
              <p className="text-xs text-slate-400">
                Create team accounts within this organisation and assign their governance role.
              </p>
            </div>
          </div>

          <form className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={addUser}>
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
            <div className="sm:col-span-2 lg:col-span-4 mt-2">
              <Button type="submit" disabled={busy}>
                {busy ? "Adding…" : "Add organisation user"}
              </Button>
            </div>
          </form>

          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-navy-750 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="pb-3 pr-4">Name</th>
                  <th className="pb-3 pr-4">Email</th>
                  <th className="pb-3">Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-750 text-slate-200">
                {team.map((member) => (
                  <tr key={member.id} className="hover:bg-navy-800/40 transition">
                    <td className="py-3 pr-4 font-medium text-white">{member.full_name}</td>
                    <td className="py-3 pr-4 text-slate-400">{member.email}</td>
                    <td className="py-3 capitalize text-slate-300">{member.role.replaceAll("_", " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
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
