import { useState } from "react";
import { ArrowRight, Shield, Sparkles } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Button, ErrorNotice } from "../components/Feedback";
import { getErrorMessage } from "../services/api";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [values, setValues] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(values);
      navigate("/", { replace: true });
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Sign in failed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Welcome Back"
      title="Sign in to BrandGuard AI"
      description="Review brand governance guidelines and keep content approvals moving."
    >
      <ErrorNotice>{error}</ErrorNotice>
      <form className="space-y-4" onSubmit={submit}>
        <div>
          <label className="form-label">Work Email</label>
          <input
            className="form-input text-xs"
            type="email"
            autoComplete="email"
            required
            placeholder="sarah@company.com"
            value={values.email}
            onChange={(e) => setValues({ ...values, email: e.target.value })}
          />
        </div>
        <div>
          <label className="form-label">Password</label>
          <input
            className="form-input text-xs"
            type="password"
            autoComplete="current-password"
            required
            placeholder="••••••••••••"
            value={values.password}
            onChange={(e) => setValues({ ...values, password: e.target.value })}
          />
        </div>
        <div className="pt-2">
          {busy && (
            <p role="status" className="mb-3 text-center text-xs text-slate-400">
              Connecting to server... This may take up to a minute on the first request.
            </p>
          )}
          <Button className="w-full py-2.5 font-bold shadow-lg shadow-blue-900/40" type="submit" disabled={busy}>
            {busy ? "Signing in..." : "Sign in to Workspace"} <ArrowRight size={15} />
          </Button>
        </div>
      </form>
      <p className="mt-6 text-center text-xs text-slate-400">
        New to BrandGuard?{" "}
        <Link className="font-semibold text-blue-400 hover:text-blue-300" to="/register">
          Create an organisation account
        </Link>
      </p>
    </AuthShell>
  );
}

export function AuthShell({ eyebrow, title, description, children }) {
  return (
    <div className="grid min-h-screen bg-navy-900 lg:grid-cols-[1.1fr_.9fr]">
      {/* Left hero banner */}
      <div className="hidden flex-col justify-between bg-navy-950 p-12 text-white border-r border-navy-800/80 lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-900/30">
            <div className="relative">
              <Shield size={22} className="fill-blue-500/30 stroke-white stroke-[2.2]" />
              <Sparkles size={11} className="absolute inset-0 m-auto text-cyan-300" />
            </div>
          </div>
          <div className="font-bold text-lg tracking-tight">BrandGuard <span className="text-blue-400">AI</span></div>
        </div>

        <div className="max-w-md pb-8">
          <p className="text-xs font-bold uppercase tracking-wider text-blue-400">Enterprise Brand Governance</p>
          <h1 className="mt-3 text-3xl font-extrabold leading-tight tracking-tight text-white">
            Ground every brand review in verified evidence.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-slate-300">
            Automatic compliance analysis, citation retrieval, and human review workflows across marketing documents and assets.
          </p>
        </div>

        <p className="text-xs text-slate-500">
          Private Organisation Workspace · Evidence Grounded · Human in the Loop
        </p>
      </div>

      {/* Right form card */}
      <div className="grid place-items-center px-5 py-10">
        <div className="w-full max-w-md rounded-2xl border border-navy-700/80 bg-navy-850 p-7 shadow-2xl sm:p-9">
          <div className="mb-6 lg:hidden flex items-center gap-2.5 font-bold text-white text-base">
            <Shield className="text-blue-400" size={20} />
            <span>BrandGuard AI</span>
          </div>

          <div className="mb-6">
            {eyebrow && <p className="text-xs font-bold uppercase tracking-wider text-blue-400">{eyebrow}</p>}
            <h2 className="mt-1 text-xl font-bold tracking-tight text-white">{title}</h2>
            {description && <p className="mt-1 text-xs text-slate-400">{description}</p>}
          </div>

          {children}
        </div>
      </div>
    </div>
  );
}
