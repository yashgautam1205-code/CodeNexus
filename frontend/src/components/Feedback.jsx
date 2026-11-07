import { AlertCircle, CheckCircle2, LoaderCircle } from "lucide-react";

export function Loading({ label = "Loading..." }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-sm text-slate-400">
      <LoaderCircle className="animate-spin text-blue-500" size={20} />
      <span>{label}</span>
    </div>
  );
}

export function ErrorNotice({ children }) {
  if (!children) return null;
  return (
    <div role="alert" className="mb-5 flex items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-950/40 px-4 py-3 text-sm text-rose-300 shadow-sm backdrop-blur-sm">
      <AlertCircle size={18} className="mt-0.5 shrink-0 text-rose-400" />
      <div className="flex-1">{children}</div>
    </div>
  );
}

export function SuccessNotice({ children }) {
  if (!children) return null;
  return (
    <div role="status" className="mb-5 flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-300 shadow-sm backdrop-blur-sm">
      <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-400" />
      <div className="flex-1">{children}</div>
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, icon: Icon, action }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3.5">
        {Icon && (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30 shadow-inner">
            <Icon size={22} />
          </div>
        )}
        <div>
          {eyebrow && <p className="text-xs font-semibold uppercase tracking-wider text-blue-400">{eyebrow}</p>}
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-2xl">{title}</h1>
          {description && <p className="mt-0.5 text-xs text-slate-400">{description}</p>}
        </div>
      </div>
      {action && <div className="flex items-center gap-3">{action}</div>}
    </div>
  );
}

export function StatusBadge({ children, tone = "slate" }) {
  const tones = {
    slate: "bg-slate-800/80 text-slate-300 border-slate-700/60",
    green: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    amber: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    red: "bg-rose-500/15 text-rose-400 border-rose-500/30",
    blue: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    purple: "bg-purple-500/15 text-purple-400 border-purple-500/30",
    cyan: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  };
  const label = typeof children === "string" ? children.replaceAll("_", " ") : children;
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize border ${tones[tone] || tones.slate}`}>
      {label}
    </span>
  );
}

export function EmptyState({ title, description, action }) {
  return (
    <div className="rounded-2xl border border-dashed border-navy-700/80 bg-navy-850/50 px-6 py-10 text-center">
      <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-slate-400">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Card({ children, className = "" }) {
  return (
    <section className={`rounded-2xl border border-navy-700/60 bg-navy-850 p-5 shadow-lg shadow-black/20 ${className}`}>
      {children}
    </section>
  );
}

export function Button({ children, className = "", variant = "primary", ...props }) {
  const styles =
    variant === "secondary"
      ? "border border-navy-700 bg-navy-800 hover:bg-navy-750 text-slate-200 hover:border-navy-600"
      : variant === "danger"
      ? "bg-rose-600 hover:bg-rose-500 text-white shadow-md shadow-rose-950/40"
      : variant === "gradient"
      ? "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-md shadow-indigo-900/40"
      : variant === "outline"
      ? "border border-navy-600/90 bg-navy-800/60 hover:bg-navy-750 text-slate-300 hover:text-white"
      : "bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-950/40";

  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
