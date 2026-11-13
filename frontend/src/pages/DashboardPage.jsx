import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import {
  Bell,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileCheck2,
  FileText,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Upload,
  RefreshCw,
  Activity,
  Users,
  BarChart3,
  AlertTriangle,
  X,
} from "lucide-react";
import {
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Area,
  AreaChart,
} from "recharts";
import { Link } from "react-router-dom";
import { Card, EmptyState, ErrorNotice, Loading } from "../components/Feedback";
import { useAuth } from "../context/AuthContext";
import { api, getErrorMessage } from "../services/api";

/* ─── Design tokens ───────────────────────────────────────────────── */
const TOKEN = {
  bgPrimary:   "#050B18",
  bgCard:      "#101D33",
  bgElevated:  "#14243D",
  accentPrimary:   "#2563EB",
  accentSecondary: "#22D3EE",
  success: "#22C55E",
  warning: "#FBBF24",
};

const severityColors = {
  critical: "#ef4444",
  high:     "#f97316",
  medium:   "#eab308",
  low:      "#7857FF",
};

/* ─── Helpers ─────────────────────────────────────────────────────── */
function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function formatTimeAgo(isoString) {
  if (!isoString) return "just now";
  const seconds = Math.floor((Date.now() - new Date(isoString)) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function getActivityIcon(action = "") {
  const a = action.toLowerCase();
  if (a.includes("approv")) return { icon: CheckCircle2, color: TOKEN.success };
  if (a.includes("reject") || a.includes("violat")) return { icon: ShieldAlert, color: "#ef4444" };
  if (a.includes("submit") || a.includes("upload")) return { icon: Upload, color: TOKEN.accentSecondary };
  if (a.includes("review") || a.includes("assign")) return { icon: FileCheck2, color: TOKEN.warning };
  return { icon: Activity, color: TOKEN.accentPrimary };
}

/* ─── Animated counter hook ───────────────────────────────────────── */
function useCountUp(target, duration = 800) {
  const [value, setValue] = useState(0);
  const rafRef = useRef(null);

  useEffect(() => {
    if (target == null) return;
    const start = performance.now();
    const startVal = 0;
    const diff = Number(target) - startVal;

    function step(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(startVal + diff * eased));
      if (progress < 1) rafRef.current = requestAnimationFrame(step);
    }

    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return value;
}

/* ─── Skeleton Loading Layout ─────────────────────────────────────── */
function DashboardSkeleton() {
  const shimmer = { background: `linear-gradient(90deg, #151E32 25%, #1A2540 50%, #151E32 75%)`, backgroundSize: "200% 100%", animation: "skeleton 1.5s ease-in-out infinite" };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header skeleton */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="h-8 w-56 rounded-lg" style={shimmer} />
          <div className="h-4 w-72 rounded" style={shimmer} />
        </div>
        <div className="flex gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-9 w-28 rounded-xl" style={shimmer} />
          ))}
          <div className="h-9 w-9 rounded-xl" style={shimmer} />
        </div>
      </div>

      {/* KPI cards skeleton */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-2xl p-5 space-y-3" style={{ background: TOKEN.bgCard, border: "1px solid rgba(129,140,248,0.08)" }}>
            <div className="flex items-center justify-between">
              <div className="h-12 w-12 rounded-xl" style={shimmer} />
              <div className="h-5 w-16 rounded-full" style={shimmer} />
            </div>
            <div className="h-3 w-28 rounded" style={shimmer} />
            <div className="h-8 w-20 rounded" style={shimmer} />
          </div>
        ))}
      </div>

      {/* Compliance hero skeleton */}
      <div className="rounded-2xl p-6" style={{ background: TOKEN.bgCard, border: "1px solid rgba(129,140,248,0.08)" }}>
        <div className="flex flex-col items-center gap-4">
          <div className="h-40 w-40 rounded-full" style={shimmer} />
          <div className="h-5 w-48 rounded" style={shimmer} />
          <div className="h-4 w-64 rounded" style={shimmer} />
        </div>
      </div>

      {/* Charts skeleton */}
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="rounded-2xl p-5" style={{ background: TOKEN.bgCard, border: "1px solid rgba(129,140,248,0.08)" }}>
          <div className="h-5 w-36 rounded mb-4" style={shimmer} />
          <div className="h-64 w-full rounded-xl" style={shimmer} />
        </div>
        <div className="rounded-2xl p-5" style={{ background: TOKEN.bgCard, border: "1px solid rgba(129,140,248,0.08)" }}>
          <div className="h-5 w-36 rounded mb-4" style={shimmer} />
          <div className="h-64 w-full rounded-xl" style={shimmer} />
        </div>
      </div>
    </div>
  );
}

/* ─── Error State ─────────────────────────────────────────────────── */
function DashboardError({ message, onRetry }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-5 rounded-2xl p-16 text-center animate-fade-in"
      style={{ background: TOKEN.bgCard, border: "1px solid rgba(239,68,68,0.25)" }}
    >
      <div
        className="flex h-16 w-16 items-center justify-center rounded-2xl"
        style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)" }}
      >
        <ShieldAlert size={32} style={{ color: "#ef4444" }} />
      </div>
      <div>
        <h2 className="text-lg font-bold text-white">Could not load dashboard</h2>
        <p className="mt-1 text-sm text-slate-400 max-w-md mx-auto">{message || "Something went wrong while fetching your data."}</p>
      </div>
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all"
        style={{ background: "linear-gradient(135deg, #818CF8 0%, #38BDF8 100%)" }}
      >
        <RefreshCw size={16} />
        Try Again
      </button>
    </div>
  );
}

/* ─── KPI Card ────────────────────────────────────────────────────── */
function KpiCard({ icon: Icon, label, value, displayValue, accentColor, borderColor, description }) {
  const displayVal = useCountUp(value);

  return (
    <div
      className="group flex flex-col gap-4 rounded-2xl p-5 shadow-xl transition-all duration-300 cursor-default"
      style={{
        background: TOKEN.bgCard,
        border: `1px solid ${borderColor ?? "rgba(129,140,248,0.12)"}`,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-3px)";
        e.currentTarget.style.boxShadow = `0 20px 40px -12px ${accentColor}30, 0 0 0 1px ${borderColor ?? "rgba(129,140,248,0.2)"}`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "";
      }}
    >
      <div className="flex items-center justify-between">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
          style={{ background: `${accentColor}18`, border: `1px solid ${accentColor}35`, color: accentColor }}
        >
          <Icon size={20} />
        </div>
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-slate-400">{label}</p>
        <p
          className="mt-1 text-3xl font-bold text-white tracking-tight"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {displayValue ?? displayVal.toLocaleString()}
        </p>
        {description && <p className="mt-1 text-xs text-slate-500">{description}</p>}
      </div>
    </div>
  );
}

/* ─── Custom Tooltip ─────────────────────────────────────────────── */
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-xl px-3 py-2.5 text-xs shadow-2xl"
      style={{ background: TOKEN.bgPrimary, border: "1px solid rgba(129,140,248,0.2)", color: "#f8fafc" }}
    >
      <p className="font-semibold text-slate-300 mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} style={{ color: p.stroke || p.fill }}>
          {p.name ?? p.dataKey}: <span className="font-bold text-white">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

/* ─── Filter Select ──────────────────────────────────────────────── */
function FilterSelect({ label, value, onChange, children }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={onChange}
      className="rounded-xl px-3.5 py-2 text-xs font-semibold text-slate-200 outline-none cursor-pointer transition-all duration-150"
      style={{
        background: TOKEN.bgCard,
        border: "1px solid rgba(129,140,248,0.2)",
        color: "#e2e8f0",
      }}
      onFocus={(e) => { e.target.style.borderColor = TOKEN.accentPrimary; e.target.style.boxShadow = `0 0 0 2px ${TOKEN.accentPrimary}20`; }}
      onBlur={(e) => { e.target.style.borderColor = "rgba(129,140,248,0.2)"; e.target.style.boxShadow = ""; }}
    >
      {children}
    </select>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN COMPONENT
════════════════════════════════════════════════════════════════════ */
export default function DashboardPage() {
  const { user } = useAuth();
  const [overview, setOverview] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [filters, setFilters] = useState({
    days: "30",
    granularity: "daily",
    review_status: "",
    severity: "",
    category: "",
    reviewer_id: "",
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showNotifications, setShowNotifications] = useState(false);
  const notifRef = useRef(null);
  const [dataKey, setDataKey] = useState(0); // used to trigger re-mount/animation

  /* — Close notification popover on outside click — */
  useEffect(() => {
    function handleClick(e) {
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setShowNotifications(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  /* — Data fetch — */
  useEffect(() => {
    let active = true;
    const params = { days: filters.days, granularity: filters.granularity };
    if (filters.review_status) params.review_status = filters.review_status;
    if (filters.severity) params.severity = filters.severity;
    if (filters.category) params.category = filters.category;
    if (filters.reviewer_id) params.reviewer_id = filters.reviewer_id;
    setLoading(true);
    setError("");

    Promise.all([
      api.get("/api/dashboard/overview", { params }),
      api.get("/api/dashboard/analytics", { params }),
    ])
      .then(([overviewResponse, analyticsResponse]) => {
        if (active) {
          setOverview(overviewResponse.data);
          setAnalytics(analyticsResponse.data);
          setDataKey((k) => k + 1);
        }
      })
      .catch((requestError) => {
        if (active) {
          setError(getErrorMessage(requestError, "Dashboard data could not be loaded."));
          setOverview(null);
          setAnalytics(null);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [
    filters.days,
    filters.granularity,
    filters.review_status,
    filters.severity,
    filters.category,
    filters.reviewer_id,
  ]);

  /* — Derived data — */
  const trendData = useMemo(() => {
    return (overview?.compliance_trend || []).map((item, idx) => {
      const label = item.date
        ? new Date(item.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })
        : `Pt ${idx + 1}`;
      return { label, average_score: Math.round(item.average_score || 0) };
    });
  }, [overview]);

  const { totalIssues, severityStats } = useMemo(() => {
    const raw = overview?.severity_distribution || {};
    const total = (raw.critical || 0) + (raw.high || 0) + (raw.medium || 0) + (raw.low || 0);
    const stats = [
      { label: "Critical", count: raw.critical || 0, pct: total ? Math.round(((raw.critical || 0) / total) * 100) : 0, color: severityColors.critical },
      { label: "High",     count: raw.high     || 0, pct: total ? Math.round(((raw.high     || 0) / total) * 100) : 0, color: severityColors.high },
      { label: "Medium",   count: raw.medium   || 0, pct: total ? Math.round(((raw.medium   || 0) / total) * 100) : 0, color: severityColors.medium },
      { label: "Low",      count: raw.low      || 0, pct: total ? Math.round(((raw.low      || 0) / total) * 100) : 0, color: severityColors.low },
    ];

    return { totalIssues: total, severityStats: stats };
  }, [overview]);

  const analysisCounts = useMemo(() => {
    const content = Number(overview?.analyzed_submissions || 0);
    const visual = (analytics?.visual_compliance_trends || []).reduce(
      (total, item) => total + Number(item.analyzed_assets || 0),
      0,
    );
    const claims = (analytics?.claim_verification_trends || []).reduce(
      (total, item) => total + Number(
        (item.supported || 0)
        + (item.contradicted || 0)
        + (item.insufficient_evidence || 0)
        + (item.needs_review || 0),
      ),
      0,
    );
    return { content, visual, claims, total: content + visual + claims };
  }, [overview, analytics]);

  const donutData = useMemo(() => [
    { name: "Content", value: analysisCounts.content, color: "#2563EB" },
    { name: "Visual", value: analysisCounts.visual, color: "#22D3EE" },
    { name: "Claims", value: analysisCounts.claims, color: "#7857FF" },
  ].filter((item) => item.value > 0), [analysisCounts]);

  const firstName = user?.full_name ? user.full_name.split(" ")[0] : "there";
  const pendingReviewItems =
    analytics?.review_backlog?.total_action_required ?? overview?.pending_reviews ?? 0;

  /* Only show a score calculated from completed analysis results. */
  const complianceScore = useMemo(() => {
    if (analytics?.compliance_score != null) return Math.round(analytics.compliance_score);
    if (trendData.length) return trendData[trendData.length - 1]?.average_score ?? null;
    return null;
  }, [analytics, trendData]);

  const contentDecisionCount = ["approve", "reject", "request_revision"].reduce(
    (total, decision) => total + Number(analytics?.approval_statistics?.[decision] || 0),
    0,
  );
  const visualDecisionCount = ["approve", "reject", "request_revision"].reduce(
    (total, decision) => total + Number(analytics?.visual_review_statistics?.[decision] || 0),
    0,
  );

  const setFilter = useCallback((key, val) => {
    setFilters((f) => ({ ...f, [key]: val }));
  }, []);

  /* ── Render ─────────────────────────────────────────────────────── */
  return (
    <div className="space-y-6 pb-8 animate-fade-in">

      {/* ── 1. WELCOME HEADER ──────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            {getGreeting()}, <span style={{ color: TOKEN.accentPrimary }}>{firstName}</span>!
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Here's your brand governance overview
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Days filter */}
          <FilterSelect
            label="Filter overview by date range"
            value={filters.days}
            onChange={(e) => setFilter("days", e.target.value)}
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </FilterSelect>

          {/* Granularity */}
          <FilterSelect
            label="Trend interval"
            value={filters.granularity}
            onChange={(e) => setFilter("granularity", e.target.value)}
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </FilterSelect>

          {/* Review status */}
          <FilterSelect
            label="Filter by review status"
            value={filters.review_status}
            onChange={(e) => setFilter("review_status", e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="revision_requested">Revision requested</option>
          </FilterSelect>

          {/* Severity */}
          <FilterSelect
            label="Filter by severity"
            value={filters.severity}
            onChange={(e) => setFilter("severity", e.target.value)}
          >
            <option value="">All severities</option>
            {["critical", "high", "medium", "low"].map((v) => (
              <option key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</option>
            ))}
          </FilterSelect>

          {/* Category — hidden when no analytics options */}
          {(analytics?.issue_categories && Object.keys(analytics.issue_categories).length > 0) && (
            <FilterSelect
              label="Filter by violation category"
              value={filters.category}
              onChange={(e) => setFilter("category", e.target.value)}
            >
              <option value="">All categories</option>
              {filters.category && !analytics?.issue_categories?.[filters.category] && (
                <option value={filters.category}>{filters.category.replaceAll("_", " ")}</option>
              )}
              {Object.keys(analytics.issue_categories).map((cat) => (
                <option key={cat} value={cat}>{cat.replaceAll("_", " ")}</option>
              ))}
            </FilterSelect>
          )}

          {/* Reviewer */}
          {analytics?.reviewers?.length > 0 && (
            <FilterSelect
              label="Filter by reviewer"
              value={filters.reviewer_id}
              onChange={(e) => setFilter("reviewer_id", e.target.value)}
            >
              <option value="">All reviewers</option>
              {analytics.reviewers.map((r) => (
                <option key={r.reviewer_id} value={r.reviewer_id}>{r.reviewer_name}</option>
              ))}
            </FilterSelect>
          )}

          {/* Notification Bell */}
          <div className="relative" ref={notifRef}>
            <button
              type="button"
              onClick={() => setShowNotifications(!showNotifications)}
              title="Notifications"
              aria-label="Toggle notifications popover"
              className="relative flex items-center justify-center rounded-xl p-2.5 transition-all duration-150"
              style={{
                background: showNotifications ? `${TOKEN.accentPrimary}20` : TOKEN.bgCard,
                border: `1px solid ${showNotifications ? TOKEN.accentPrimary : "rgba(129,140,248,0.2)"}`,
                color: showNotifications ? TOKEN.accentPrimary : "#94a3b8",
              }}
            >
              <Bell size={18} />
              {overview?.recent_activities?.length > 0 && (
                <span
                  className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white"
                  style={{ background: TOKEN.accentPrimary }}
                >
                  {Math.min(overview.recent_activities.length, 9)}
                </span>
              )}
            </button>

            {/* Notification Popover */}
            {showNotifications && (
              <div
                className="absolute right-0 mt-2 z-50 w-80 rounded-2xl p-4 shadow-2xl animate-fade-in"
                style={{
                  background: TOKEN.bgCard,
                  border: "1px solid rgba(129,140,248,0.2)",
                  backdropFilter: "blur(16px)",
                }}
              >
                <div className="flex items-center justify-between pb-2 mb-3" style={{ borderBottom: "1px solid rgba(129,140,248,0.1)" }}>
                  <span className="text-xs font-bold text-white uppercase tracking-wider">Alerts &amp; Activity</span>
                  <span className="text-[11px] font-medium" style={{ color: TOKEN.accentSecondary }}>Live Feed</span>
                </div>
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {overview?.recent_activities?.length ? (
                    overview.recent_activities.slice(0, 5).map((act) => {
                      const { icon: Icon, color } = getActivityIcon(act.action);
                      return (
                        <div
                          key={act.id}
                          className="flex items-start gap-2.5 rounded-xl p-2.5 text-xs transition-colors"
                          style={{ background: TOKEN.bgElevated }}
                        >
                          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: `${color}18`, color }}>
                            <Icon size={14} />
                          </div>
                          <div>
                            <p className="font-medium text-slate-200 capitalize leading-snug">
                              {act.action.replaceAll(".", " ").replaceAll("_", " ")}
                            </p>
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              {act.actor_name} · {formatTimeAgo(act.created_at)}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-xs text-slate-400 py-4 text-center">No recent activity to show.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Error */}
      {error && !loading && (
        <DashboardError message={error} onRetry={() => setFilters({ ...filters })} />
      )}

      {/* ── LOADING STATE ──────────────────────────────────────────── */}
      {loading && <DashboardSkeleton />}

      {/* ── DATA LOADED ───────────────────────────────────────────── */}
      {!loading && !error && overview && (
        <div key={dataKey} className="space-y-6 animate-fade-in">

          {/* ── 2. KPI CARDS ─────────────────────────────────────── */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              icon={FileText}
              label="Total Analyses"
              value={analysisCounts.total}
              accentColor={TOKEN.accentSecondary}
              borderColor="rgba(34,211,238,0.15)"
              description={`${analysisCounts.content} content · ${analysisCounts.visual} visual · ${analysisCounts.claims} claims`}
            />
            <KpiCard
              icon={ShieldCheck}
              label="Compliance Score"
              value={complianceScore ?? 0}
              displayValue={complianceScore == null ? "—" : `${complianceScore}%`}
              accentColor={TOKEN.accentPrimary}
              borderColor="rgba(37,99,235,0.22)"
              description={complianceScore == null ? "No scored analyses in period" : "Latest analysis average"}
            />
            <KpiCard
              icon={Clock}
              label="Pending Reviews"
              value={pendingReviewItems}
              accentColor="#F59E0B"
              borderColor="rgba(245,158,11,0.18)"
              description="Review, evidence or revision needed"
            />
            <KpiCard
              icon={CheckCircle2}
              label="Approved Content"
              value={overview.approved_content}
              accentColor={TOKEN.success}
              borderColor="rgba(34,197,94,0.15)"
              description={`Approved in the last ${filters.days} days`}
            />
          </div>

          {/* ── 4. CHARTS ROW ─────────────────────────────────────── */}
          <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">

            {/* LEFT — Compliance Trend Chart */}
            <div
              className="rounded-2xl p-5 shadow-xl"
              style={{ background: TOKEN.bgCard, border: "1px solid rgba(129,140,248,0.12)" }}
            >
              <div className="flex items-center justify-between pb-4" style={{ borderBottom: "1px solid rgba(129,140,248,0.08)" }}>
                <div>
                  <h2 className="text-sm font-bold text-white tracking-wide">Compliance Trend</h2>
                  <p className="text-xs text-slate-500 mt-0.5">Average compliance score over time</p>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  <span className="h-2 w-2 rounded-full" style={{ background: TOKEN.accentSecondary, boxShadow: `0 0 6px ${TOKEN.accentSecondary}` }} />
                  Average score
                </div>
              </div>

              <div className="h-64 w-full mt-4">
                {trendData.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"   stopColor={TOKEN.accentSecondary} stopOpacity={0.3} />
                          <stop offset="95%"  stopColor={TOKEN.accentSecondary} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis
                        dataKey="label"
                        stroke="transparent"
                        tick={{ fill: "#64748b", fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        domain={[0, 100]}
                        ticks={[0, 25, 50, 75, 100]}
                        stroke="transparent"
                        tick={{ fill: "#64748b", fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <Area
                        type="monotone"
                        dataKey="average_score"
                        name="Average score"
                        stroke={TOKEN.accentSecondary}
                        strokeWidth={2.5}
                        fill="url(#trendGradient)"
                        dot={{ r: 3.5, fill: TOKEN.accentSecondary, stroke: TOKEN.bgPrimary, strokeWidth: 2 }}
                        activeDot={{ r: 6, fill: TOKEN.accentSecondary, stroke: TOKEN.bgPrimary, strokeWidth: 2 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2">
                    <BarChart3 size={28} className="text-slate-600" />
                    <p className="text-xs text-slate-500">No compliance analysis data for this period.</p>
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT — Severity Distribution Donut */}
            <div
              className="rounded-2xl p-5 shadow-xl flex flex-col"
              style={{ background: TOKEN.bgCard, border: "1px solid rgba(129,140,248,0.12)" }}
            >
              <div className="pb-4" style={{ borderBottom: "1px solid rgba(129,140,248,0.08)" }}>
                <h2 className="text-sm font-bold text-white tracking-wide">Analysis Breakdown</h2>
                <p className="text-xs text-slate-500 mt-0.5">Content, visual and claim checks</p>
              </div>

              <div className="flex flex-1 flex-col items-center justify-center gap-5 py-4">
                {donutData.length > 0 ? (
                  <>
                    {/* Donut Chart */}
                    <div className="relative h-44 w-44 shrink-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={donutData}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={52}
                            outerRadius={74}
                            paddingAngle={3}
                            stroke={TOKEN.bgCard}
                            strokeWidth={3}
                          >
                            {donutData.map((entry) => (
                              <Cell
                                key={entry.name}
                                fill={entry.color}
                                style={{ filter: `drop-shadow(0 0 4px ${entry.color}80)` }}
                              />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{
                              background: TOKEN.bgPrimary,
                              border: "1px solid rgba(129,140,248,0.2)",
                              borderRadius: "10px",
                              fontSize: "11px",
                              color: "#fff",
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      {/* Center label */}
                      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <span className="text-2xl font-bold text-white leading-tight">
                          {analysisCounts.total.toLocaleString()}
                        </span>
                        <span className="text-[10px] text-slate-400 font-medium uppercase tracking-widest mt-0.5">
                          analyses
                        </span>
                      </div>
                    </div>

                    {/* Legend */}
                    <div className="w-full space-y-2 text-xs">
                      {donutData.map((item) => {
                        const pct = analysisCounts.total ? Math.round((item.value / analysisCounts.total) * 100) : 0;
                        return (
                          <div key={item.name} className="flex items-center justify-between gap-3 text-slate-300">
                            <div className="flex items-center gap-2">
                              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: item.color, boxShadow: `0 0 5px ${item.color}80` }} />
                              <span className="font-medium text-slate-300">{item.name}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-16 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
                                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: item.color }} />
                              </div>
                              <span className="w-6 text-right font-semibold text-slate-200">{item.value.toLocaleString()}</span>
                              <span className="w-9 text-right text-slate-500">({pct}%)</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {totalIssues > 0 && (
                      <div className="w-full border-t border-blue-100/[0.07] pt-3">
                        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Violations by severity</p>
                        <div className="grid grid-cols-2 gap-2">
                          {severityStats.filter((item) => item.count > 0).map((item) => (
                            <div key={item.label} className="flex items-center justify-between rounded-lg bg-[#0B182C]/70 px-2.5 py-1.5 text-[10px]">
                              <span className="flex items-center gap-1.5 text-slate-400"><span className="h-1.5 w-1.5 rounded-full" style={{ background: item.color }} />{item.label}</span>
                              <span className="font-semibold text-slate-200">{item.count.toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-2 py-8">
                    <BarChart3 size={30} className="text-slate-600" />
                    <p className="text-sm font-medium text-white">No analyses recorded</p>
                    <p className="text-center text-xs text-slate-500">Analysis counts will appear here once content, creative or claim checks are run.</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── 5. ANALYTICS GRID ─────────────────────────────────── */}
          {analytics && (
            <div className="grid gap-5 md:grid-cols-3">

              {/* a) Recurring Issues */}
              <div
                className="rounded-2xl p-5 shadow-xl"
                style={{ background: TOKEN.bgCard, border: "1px solid rgba(129,140,248,0.12)" }}
              >
                <div className="flex items-center gap-2.5 pb-4 mb-4" style={{ borderBottom: "1px solid rgba(129,140,248,0.08)" }}>
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: "rgba(239,68,68,0.12)", color: "#ef4444" }}>
                    <AlertTriangle size={16} />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-white">Recurring Issues</h2>
                    <p className="text-[11px] text-slate-500">Most frequent violation patterns</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {analytics.recurring_violations?.length ? (
                    analytics.recurring_violations.slice(0, 5).map((issue, idx) => (
                      <div key={issue.category} className="flex items-center gap-3">
                        <span className="text-xs font-bold text-slate-600 w-4 shrink-0">{idx + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 text-xs mb-1">
                            <span className="capitalize truncate text-slate-300">{issue.category.replaceAll("_", " ")}</span>
                            <span
                              className="rounded-full px-2 py-0.5 text-[10px] font-bold shrink-0"
                              style={{ background: "rgba(239,68,68,0.12)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}
                            >
                              {issue.count}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-slate-500 py-2">No recurring issue patterns detected.</p>
                  )}
                </div>
              </div>

              {/* b) Reviewer Workload */}
              <div
                className="rounded-2xl p-5 shadow-xl"
                style={{ background: TOKEN.bgCard, border: "1px solid rgba(129,140,248,0.12)" }}
              >
                <div className="flex items-center gap-2.5 pb-4 mb-4" style={{ borderBottom: "1px solid rgba(129,140,248,0.08)" }}>
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: "rgba(129,140,248,0.12)", color: TOKEN.accentPrimary }}>
                    <Users size={16} />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-white">Reviewer Workload</h2>
                    <p className="text-[11px] text-slate-500">Team assignment overview</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {analytics.reviewer_workload?.length ? (
                    analytics.reviewer_workload.slice(0, 4).map((reviewer) => (
                      <div key={reviewer.reviewer_id} className="text-xs">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-slate-300 font-medium truncate">{reviewer.reviewer_name}</span>
                          <span className="shrink-0 text-slate-400">
                            <span style={{ color: TOKEN.warning }}>{reviewer.pending_assignments || 0}</span> pending
                          </span>
                        </div>
                        <div className="h-1 w-full rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.min(((reviewer.pending_assignments || 0) / 20) * 100, 100)}%`,
                              background: `linear-gradient(90deg, ${TOKEN.accentPrimary}80, ${TOKEN.accentPrimary})`,
                            }}
                          />
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-slate-500 py-2">No review activity recorded.</p>
                  )}
                </div>
                {/* Backlog summary */}
                <div
                  className="mt-4 rounded-xl p-3 text-xs space-y-1"
                  style={{ background: TOKEN.bgElevated }}
                >
                  <div className="flex justify-between text-slate-400">
                    <span>Assignments</span>
                    <span>
                      <span className="text-white">{analytics.review_assignment_statistics?.pending || 0}</span> pending ·{" "}
                      <span className="text-white">{analytics.review_assignment_statistics?.completed || 0}</span> done
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>Backlog</span>
                    <span>
                      {analytics.review_backlog?.pending_content || 0} content ·{" "}
                      {analytics.review_backlog?.pending_claims || 0} claims ·{" "}
                      {analytics.review_backlog?.pending_visual_analyses || 0} visuals
                    </span>
                  </div>
                </div>
              </div>

              {/* c) Approval Statistics */}
              <div
                className="rounded-2xl p-5 shadow-xl"
                style={{ background: TOKEN.bgCard, border: "1px solid rgba(129,140,248,0.12)" }}
              >
                <div className="flex items-center gap-2.5 pb-4 mb-4" style={{ borderBottom: "1px solid rgba(129,140,248,0.08)" }}>
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: "rgba(34,197,94,0.12)", color: TOKEN.success }}>
                    <BarChart3 size={16} />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-white">Approval Statistics</h2>
                    <p className="text-[11px] text-slate-500">Review decision summary</p>
                  </div>
                </div>

                <div className="space-y-3 text-xs text-slate-300">
                  {[
                    { label: "Content approval rate", value: contentDecisionCount && analytics.approval_statistics?.approval_rate != null ? `${analytics.approval_statistics.approval_rate}%` : "—", color: TOKEN.success },
                    {
                      label: "Content decisions",
                      value: ((analytics.approval_statistics?.approve || 0) + (analytics.approval_statistics?.reject || 0) + (analytics.approval_statistics?.request_revision || 0)).toLocaleString(),
                      color: TOKEN.accentSecondary,
                    },
                    { label: "Visual approval rate", value: visualDecisionCount && analytics.visual_review_statistics?.approval_rate != null ? `${analytics.visual_review_statistics.approval_rate}%` : "—", color: TOKEN.success },
                    {
                      label: "Visual decisions",
                      value: ((analytics.visual_review_statistics?.approve || 0) + (analytics.visual_review_statistics?.reject || 0) + (analytics.visual_review_statistics?.request_revision || 0)).toLocaleString(),
                      color: TOKEN.accentSecondary,
                    },
                    { label: "Claim decisions", value: (analytics.review_decision_statistics?.claim_decisions || 0).toLocaleString(), color: TOKEN.accentPrimary },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="flex items-center justify-between gap-3">
                      <span className="text-slate-400">{label}</span>
                      <span className="font-semibold" style={{ color }}>{value}</span>
                    </div>
                  ))}
                  <div
                    className="flex items-center justify-between gap-3 pt-2"
                    style={{ borderTop: "1px solid rgba(129,140,248,0.08)" }}
                  >
                    <span className="text-slate-400">All completed decisions</span>
                    <span className="font-semibold text-white">
                      {(analytics.review_decision_statistics?.total_completed_decisions || 0).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-400">Avg review time</span>
                    <span className="font-semibold" style={{ color: TOKEN.warning }}>
                      {contentDecisionCount && analytics.average_review_time_hours != null ? `${analytics.average_review_time_hours}h` : "—"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── 6. RECENT ACTIVITY ────────────────────────────────── */}
          <div
            className="rounded-2xl p-5 shadow-xl"
            style={{ background: TOKEN.bgCard, border: "1px solid rgba(129,140,248,0.12)" }}
          >
            <div className="flex items-center justify-between pb-4 mb-4" style={{ borderBottom: "1px solid rgba(129,140,248,0.08)" }}>
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: "rgba(129,140,248,0.12)", color: TOKEN.accentPrimary }}>
                  <Activity size={16} />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white">Recent Activity</h2>
                  <p className="text-[11px] text-slate-500">Latest organisation events</p>
                </div>
              </div>
              <Link
                to="/audit"
                className="inline-flex items-center gap-1 text-xs font-semibold transition-colors"
                style={{ color: TOKEN.accentPrimary }}
                onMouseEnter={(e) => { e.currentTarget.style.color = TOKEN.accentSecondary; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = TOKEN.accentPrimary; }}
              >
                View all <ExternalLink size={12} />
              </Link>
            </div>

            <div className="space-y-2.5">
              {overview.recent_activities?.length ? (
                overview.recent_activities.slice(0, 5).map((activity) => {
                  const { icon: Icon, color } = getActivityIcon(activity.action);
                  return (
                    <div
                      key={activity.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl p-3.5 transition-all duration-150"
                      style={{ background: TOKEN.bgElevated, border: "1px solid transparent" }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(129,140,248,0.15)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "transparent"; }}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                          style={{ background: `${color}18`, border: `1px solid ${color}30`, color }}
                        >
                          <Icon size={16} />
                        </div>
                        <div>
                          <p className="text-xs font-medium text-slate-200 capitalize">
                            {activity.action.replaceAll(".", " ").replaceAll("_", " ")}
                          </p>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            {activity.actor_name}
                            {activity.entity_type && (
                              <span className="text-slate-500"> · {activity.entity_type.replaceAll("_", " ")}</span>
                            )}
                          </p>
                        </div>
                      </div>
                      <span className="text-[11px] font-medium text-slate-500">
                        {formatTimeAgo(activity.created_at)}
                      </span>
                    </div>
                  );
                })
              ) : (
                <div className="flex flex-col items-center justify-center gap-3 py-10">
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-2xl"
                    style={{ background: "rgba(129,140,248,0.08)", border: "1px solid rgba(129,140,248,0.15)" }}
                  >
                    <Activity size={22} style={{ color: TOKEN.accentPrimary }} />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-slate-300">No recent activity</p>
                    <p className="text-xs text-slate-500 mt-0.5">Organisation events will appear here.</p>
                  </div>
                </div>
              )}
            </div>
          </div>

        </div>
      )}

      {/* Empty / null overview without error */}
      {!loading && !error && !overview && (
        <div
          className="flex flex-col items-center justify-center gap-4 rounded-2xl p-16 text-center"
          style={{ background: TOKEN.bgCard, border: "1px solid rgba(129,140,248,0.12)" }}
        >
          <Sparkles size={36} style={{ color: TOKEN.accentPrimary }} />
          <div>
            <h2 className="text-base font-bold text-white">No data available</h2>
            <p className="mt-1 text-sm text-slate-400">Try adjusting your filters to see governance data.</p>
          </div>
        </div>
      )}
    </div>
  );
}
