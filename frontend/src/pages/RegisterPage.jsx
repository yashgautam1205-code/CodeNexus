import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button, ErrorNotice } from "../components/Feedback";
import { useAuth } from "../context/AuthContext";
import { getErrorMessage } from "../services/api";
import { AuthShell } from "./LoginPage";

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [values, setValues] = useState({ organization_name: "", full_name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await register(values);
      navigate("/", { replace: true });
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Registration failed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Get Started"
      title="Create Organisation Workspace"
      description="Your first account will be registered as the organisation administrator."
    >
      <ErrorNotice>{error}</ErrorNotice>
      <form className="space-y-3.5" onSubmit={submit}>
        <div>
          <label className="form-label">Organisation Name</label>
          <input
            className="form-input text-xs"
            minLength={2}
            maxLength={160}
            required
            placeholder="Acme Corp"
            value={values.organization_name}
            onChange={(e) => setValues({ ...values, organization_name: e.target.value })}
          />
        </div>
        <div>
          <label className="form-label">Your Full Name</label>
          <input
            className="form-input text-xs"
            autoComplete="name"
            minLength={2}
            maxLength={160}
            required
            placeholder="Sarah Johnson"
            value={values.full_name}
            onChange={(e) => setValues({ ...values, full_name: e.target.value })}
          />
        </div>
        <div>
          <label className="form-label">Work Email</label>
          <input
            className="form-input text-xs"
            type="email"
            autoComplete="email"
            required
            placeholder="sarah@acme.com"
            value={values.email}
            onChange={(e) => setValues({ ...values, email: e.target.value })}
          />
        </div>
        <div>
          <label className="form-label">Password</label>
          <input
            className="form-input text-xs"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
            placeholder="At least 12 characters"
            value={values.password}
            onChange={(e) => setValues({ ...values, password: e.target.value })}
          />
          <span className="mt-1 block text-[10px] text-slate-400">Must be at least 12 characters.</span>
        </div>
        <div className="pt-2">
          <Button className="w-full py-2.5 font-bold shadow-lg shadow-blue-900/40" type="submit" disabled={busy}>
            {busy ? "Creating workspace..." : "Create Account"} <ArrowRight size={15} />
          </Button>
        </div>
      </form>
      <p className="mt-5 text-center text-xs text-slate-400">
        Already have an account?{" "}
        <Link className="font-semibold text-blue-400 hover:text-blue-300" to="/login">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
