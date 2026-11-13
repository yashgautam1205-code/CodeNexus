import { useEffect, useState, useMemo } from "react";
import {
  Bell,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileCheck2,
  FileText,
  ShieldAlert,
  Sparkles,
  Upload,
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
} from "recharts";
import { Link } from "react-router-dom";
import { Card, EmptyState, ErrorNotice, Loading } from "../components/Feedback";
import { useAuth } from "../context/AuthContext";
import { api, getErrorMessage } from "../services/api";

const severityColors = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#3b82f6",
};

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

    return () => {
      active = false;
    };
  }, [
    filters.days,
    filters.granularity,
    filters.review_status,
    filters.severity,
    filters.category,
    filters.reviewer_id,
  ]);

  // Transform trend data from API
  const trendData = useMemo(() => {
    return (overview?.compliance_trend || []).map((item, idx) => {
      const label = item.date
        ? new Date(item.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })
        : `Pt ${idx + 1}`;
      return {
        label,
        average_score: Math.round(item.average_score || 0),
      };
    });
  }, [overview]);

  // Transform severity distribution data for Donut Chart
  const { donutData, totalIssues, severityStats } = useMemo(() => {
    const raw = overview?.severity_distribution || {};

    const total = (raw.critical || 0) + (raw.high || 0) + (raw.medium || 0) + (raw.low || 0);
    const data = [
      { name: "Critical", key: "critical", value: raw.critical || 0, color: severityColors.critical },
      { name: "High", key: "high", value: raw.high || 0, color: severityColors.high },
      { name: "Medium", key: "medium", value: raw.medium || 0, color: severityColors.medium },
      { name: "Low", key: "low", value: raw.low || 0, color: severityColors.low },
    ].filter((item) => item.value > 0);

    const stats = [
      { label: "Critical", count: raw.critical || 0, pct: total ? Math.round(((raw.critical || 0) / total) * 100) : 0, color: severityColors.critical },
      { label: "High", count: raw.high || 0, pct: total ? Math.round(((raw.high || 0) / total) * 100) : 0, color: severityColors.high },
      { label: "Medium", count: raw.medium || 0, pct: total ? Math.round(((raw.medium || 0) / total) * 100) : 0, color: severityColors.medium },
      { label: "Low", count: raw.low || 0, pct: total ? Math.round(((raw.low || 0) / total) * 100) : 0, color: severityColors.low },
    ];

    return { donutData: data, totalIssues: total, severityStats: stats };
  }, [overview]);

  const firstName = user?.full_name ? user.full_name.split(" ")[0] : "Sarah";
  const pendingReviewItems =
    analytics?.review_backlog?.total_action_required ?? overview?.pending_reviews ?? 0;

  function formatTimeAgo(isoString) {
    if (!isoString) return "just now";
    const seconds = Math.floor((new Date() - new Date(isoString)) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  return (
    <div className="space-y-6">
      {/* Top Header matching Reference Image Screen 1 */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Welcome back, {firstName}!
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-slate-400">
            Here's your brand governance overview
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Days Filter Dropdown */}
          <div className="relative">
            <select
              aria-label="Trend interval"
              value={filters.granularity}
              onChange={(e) => setFilters({ ...filters, granularity: e.target.value })}
              className="rounded-xl border border-navy-700 bg-navy-850 px-3.5 py-2 text-xs font-semibold text-slate-200 outline-none focus:border-blue-500"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
            <select
              aria-label="Filter overview by date range"
              value={filters.days}
              onChange={(e) => setFilters({ ...filters, days: e.target.value })}
              className="rounded-xl border border-navy-700 bg-navy-850 px-3.5 py-2 text-xs font-semibold text-slate-200 outline-none hover:border-navy-600 focus:border-blue-500 cursor-pointer shadow-sm transition"
            >
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
          </div>
          <select
            aria-label="Filter by review status"
            value={filters.review_status}
            onChange={(e) => setFilters({ ...filters, review_status: e.target.value })}
            className="rounded-xl border border-navy-700 bg-navy-850 px-3.5 py-2 text-xs font-semibold text-slate-200 outline-none focus:border-blue-500"
          >
            <option value="">All review statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="revision_requested">Revision requested</option>
          </select>
          <select
            aria-label="Filter by severity"
            value={filters.severity}
            onChange={(e) => setFilters({ ...filters, severity: e.target.value })}
            className="rounded-xl border border-navy-700 bg-navy-850 px-3.5 py-2 text-xs font-semibold text-slate-200 outline-none focus:border-blue-500"
          >
            <option value="">All severities</option>
            {["critical", "high", "medium", "low"].map((value) => (
              <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>
            ))}
          </select>
          <select
            aria-label="Filter by violation category"
            value={filters.category}
            onChange={(e) => setFilters({ ...filters, category: e.target.value })}
            className="rounded-xl border border-navy-700 bg-navy-850 px-3.5 py-2 text-xs font-semibold text-slate-200 outline-none focus:border-blue-500"
          >
            <option value="">All categories</option>
            {filters.category && !analytics?.issue_categories?.[filters.category] && (
              <option value={filters.category}>{filters.category.replaceAll("_", " ")}</option>
            )}
            {Object.keys(analytics?.issue_categories || {}).map((category) => (
              <option key={category} value={category}>{category.replaceAll("_", " ")}</option>
            ))}
          </select>
          <select
            aria-label="Filter by reviewer"
            value={filters.reviewer_id}
            onChange={(e) => setFilters({ ...filters, reviewer_id: e.target.value })}
            className="rounded-xl border border-navy-700 bg-navy-850 px-3.5 py-2 text-xs font-semibold text-slate-200 outline-none focus:border-blue-500"
          >
            <option value="">All reviewers</option>
            {analytics?.reviewers?.map((reviewer) => (
              <option key={reviewer.reviewer_id} value={reviewer.reviewer_id}>{reviewer.reviewer_name}</option>
            ))}
          </select>

          {/* Notification Bell */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowNotifications(!showNotifications)}
              title="Notifications"
              aria-label="Toggle notifications popover"
              className="relative rounded-xl border border-navy-700 bg-navy-850 p-2 text-slate-300 hover:border-navy-600 hover:text-white transition shadow-sm"
            >
              <Bell size={18} />
            </button>

            {/* Notification Popover */}
            {showNotifications && (
              <div className="absolute right-0 mt-2 z-50 w-80 rounded-2xl border border-navy-700 bg-navy-850 p-4 shadow-2xl backdrop-blur-md">
                <div className="flex items-center justify-between pb-2 border-b border-navy-750">
                  <span className="text-xs font-bold text-white uppercase tracking-wider">Alerts & Activity</span>
                  <span className="text-[11px] text-blue-400 font-medium">Live Feed</span>
                </div>
                <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
                  {overview?.recent_activities?.length ? (
                    overview.recent_activities.slice(0, 5).map((act) => (
                      <div key={act.id} className="rounded-xl bg-navy-900/80 p-2.5 text-xs">
                        <p className="font-medium text-slate-200 capitalize">
                          {act.action.replaceAll(".", " ").replaceAll("_", " ")}
                        </p>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          {act.actor_name} · {formatTimeAgo(act.created_at)}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-slate-400 py-3 text-center">No recent activity to show.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <ErrorNotice>{error}</ErrorNotice>

      {loading ? (
        <Loading label="Loading organisation governance metrics…" />
      ) : overview ? (
        <>
          {/* Top 4 Metric Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Card 1: Total Submissions */}
            <div className="flex items-center gap-4 rounded-2xl border border-navy-700/60 bg-navy-850 p-4 shadow-lg transition-transform hover:-translate-y-0.5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 text-blue-400 border border-blue-500/30">
                <FileText size={22} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-400">Total Submissions</p>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-white tracking-tight">
                    {overview.total_submissions}
                  </span>
                </div>
              </div>
            </div>

            {/* Card 2: Compliant Content */}
            <div className="flex items-center gap-4 rounded-2xl border border-navy-700/60 bg-navy-850 p-4 shadow-lg transition-transform hover:-translate-y-0.5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                <CheckCircle2 size={22} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-400">Compliant Content</p>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-white tracking-tight">
                    {overview.approved_content}
                  </span>
                </div>
              </div>
            </div>

            {/* Card 3: Violations Detected */}
            <div className="flex items-center gap-4 rounded-2xl border border-navy-700/60 bg-navy-850 p-4 shadow-lg transition-transform hover:-translate-y-0.5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 text-rose-400 border border-rose-500/30">
                <ShieldAlert size={22} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-400">Violations Detected</p>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-white tracking-tight">
                    {overview.total_violations}
                  </span>
                </div>
              </div>
            </div>

            {/* Card 4: Pending Reviews */}
            <div className="flex items-center gap-4 rounded-2xl border border-navy-700/60 bg-navy-850 p-4 shadow-lg transition-transform hover:-translate-y-0.5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30">
                <Clock size={22} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-400">Items needing review</p>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-white tracking-tight">
                    {pendingReviewItems}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Charts Row: Submission Trends & Severity Distribution */}
          <div className="grid gap-6 lg:grid-cols-[1.6fr_1.1fr]">
            {/* Left Chart: Submission Trends */}
            <div className="rounded-2xl border border-navy-700/60 bg-navy-850 p-5 shadow-xl">
              <div className="flex items-center justify-between pb-3">
                <h2 className="text-sm font-bold text-white tracking-wide">Compliance Trend</h2>
                <div className="flex items-center gap-4 text-xs">
                  <div className="flex items-center gap-1.5 text-slate-300">
                    <span className="h-2.5 w-2.5 rounded-full bg-cyan-400 shadow-sm shadow-cyan-400/50" />
                    <span>Average score</span>
                  </div>
                </div>
              </div>

              <div className="h-64 w-full mt-2">
                {trendData.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData} margin={{ top: 15, right: 15, left: -20, bottom: 5 }}>
                      <XAxis
                        dataKey="label"
                        stroke="#475569"
                        tick={{ fill: "#94a3b8", fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        domain={[0, 100]}
                        ticks={[0, 25, 50, 75, 100]}
                        stroke="#475569"
                        tick={{ fill: "#94a3b8", fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#0c1322",
                          borderColor: "#1e2c47",
                          borderRadius: "12px",
                          boxShadow: "0 10px 25px -5px rgba(0,0,0,0.5)",
                          fontSize: "12px",
                          color: "#f8fafc",
                        }}
                        itemStyle={{ color: "#e2e8f0" }}
                      />
                      <Line
                        type="monotone"
                        dataKey="average_score"
                        stroke="#38bdf8"
                        strokeWidth={2.8}
                        dot={{ r: 4, fill: "#38bdf8", stroke: "#0c1322", strokeWidth: 2 }}
                        activeDot={{ r: 6, fill: "#38bdf8" }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-slate-400">
                    No compliance analysis data for this period.
                  </div>
                )}
              </div>
            </div>

            {/* Right Chart: Severity Distribution Donut */}
            <div className="rounded-2xl border border-navy-700/60 bg-navy-850 p-5 shadow-xl flex flex-col justify-between">
              <h2 className="text-sm font-bold text-white tracking-wide">Severity Distribution</h2>

              <div className="flex flex-col sm:flex-row items-center justify-around gap-4 my-auto py-2">
                {/* Donut Chart with Center Text */}
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
                        stroke="#10182b"
                        strokeWidth={2}
                      >
                        {donutData.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#0c1322",
                          borderColor: "#1e2c47",
                          borderRadius: "10px",
                          fontSize: "11px",
                          color: "#fff",
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-2xl font-bold text-white leading-tight">
                      {overview.total_violations}
                    </span>
                    <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">
                      issues
                    </span>
                  </div>
                </div>

                {/* Right Legend List matching screenshot */}
                <div className="space-y-2.5 w-full sm:w-auto text-xs min-w-[130px]">
                  {severityStats.map((item) => (
                    <div key={item.label} className="flex items-center justify-between gap-3 text-slate-300">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
                        <span className="text-slate-300 font-medium">{item.label}</span>
                      </div>
                      <span className="font-semibold text-slate-200">
                        {item.count} <span className="text-slate-400 font-normal">({item.pct}%)</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {analytics && (
            <div className="grid gap-6 xl:grid-cols-5">
              <div className="rounded-2xl border border-navy-700/60 bg-navy-850 p-5 shadow-xl">
                <h2 className="text-sm font-bold text-white tracking-wide">Recurring issues</h2>
                <div className="mt-4 space-y-3">
                    {analytics.recurring_violations?.length ? analytics.recurring_violations.slice(0, 4).map((issue) => (
                    <div key={issue.category} className="flex items-center justify-between text-xs text-slate-300">
                      <span className="capitalize">{issue.category.replaceAll("_", " ")}</span>
                      <span className="rounded-full bg-navy-900 px-2 py-0.5 text-slate-100">{issue.count}</span>
                    </div>
                    )) : <p className="text-xs text-slate-400">No recurring issue patterns detected.</p>}
                </div>
              </div>

              <div className="rounded-2xl border border-navy-700/60 bg-navy-850 p-5 shadow-xl">
                <h2 className="text-sm font-bold text-white tracking-wide">Reviewer workload</h2>
                <div className="mt-4 space-y-3">
                  {analytics.reviewer_workload?.length ? analytics.reviewer_workload.slice(0, 4).map((reviewer) => (
                    <div key={reviewer.reviewer_id} className="flex items-center justify-between text-xs text-slate-300">
                      <span>{reviewer.reviewer_name}</span>
                      <span>{reviewer.pending_assignments || 0} pending · {reviewer.decision_count} decisions</span>
                    </div>
                  )) : <p className="text-xs text-slate-400">No review activity recorded.</p>}
                  <div className="border-t border-navy-700 pt-2 text-xs text-slate-400">
                    Assignments: {analytics.review_assignment_statistics?.pending || 0} pending · {analytics.review_assignment_statistics?.completed || 0} completed · {analytics.review_assignment_statistics?.cancelled || 0} cancelled
                  </div>
                  <div className="text-[10px] text-slate-500">
                    Backlog: {analytics.review_backlog?.pending_content || 0} content · {analytics.review_backlog?.pending_claims || 0} claims · {analytics.review_backlog?.pending_visual_analyses || 0} visuals
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-navy-700/60 bg-navy-850 p-5 shadow-xl">
                <h2 className="text-sm font-bold text-white tracking-wide">Approval statistics</h2>
                <div className="mt-4 space-y-3 text-xs text-slate-300">
                  <div className="flex items-center justify-between">
                    <span>Content approval rate</span>
                    <span>{analytics.approval_statistics?.approval_rate || 0}%</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Content decisions</span>
                    <span>
                      {(analytics.approval_statistics?.approve || 0)
                        + (analytics.approval_statistics?.reject || 0)
                        + (analytics.approval_statistics?.request_revision || 0)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Visual approval rate</span>
                    <span>{analytics.visual_review_statistics?.approval_rate || 0}%</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Visual decisions</span>
                    <span>
                      {(analytics.visual_review_statistics?.approve || 0)
                        + (analytics.visual_review_statistics?.reject || 0)
                        + (analytics.visual_review_statistics?.request_revision || 0)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Claim decisions</span>
                    <span>{analytics.review_decision_statistics?.claim_decisions || 0}</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-navy-700 pt-2">
                    <span>All completed decisions</span>
                    <span>{analytics.review_decision_statistics?.total_completed_decisions || 0}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Average review time</span>
                    <span>{analytics.average_review_time_hours || 0} hours</span>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-navy-700/60 bg-navy-850 p-5 shadow-xl">
                <h2 className="text-sm font-bold text-white tracking-wide">Claim verification</h2>
                <div className="mt-4 space-y-3 text-xs text-slate-300">
                  <div className="flex items-center justify-between"><span>Supported</span><span>{analytics.claim_verification_trends?.reduce((sum, item) => sum + (item.supported || 0), 0) || 0}</span></div>
                  <div className="flex items-center justify-between"><span>Contradicted</span><span>{analytics.claim_verification_trends?.reduce((sum, item) => sum + (item.contradicted || 0), 0) || 0}</span></div>
                  <div className="flex items-center justify-between"><span>Insufficient evidence</span><span>{analytics.claim_verification_trends?.reduce((sum, item) => sum + (item.insufficient_evidence || 0), 0) || 0}</span></div>
                  <div className="flex items-center justify-between"><span>Needs review</span><span>{analytics.claim_verification_trends?.reduce((sum, item) => sum + (item.needs_review || 0), 0) || 0}</span></div>
                </div>
              </div>

              <div className="rounded-2xl border border-navy-700/60 bg-navy-850 p-5 shadow-xl">
                <h2 className="text-sm font-bold text-white tracking-wide">Visual compliance</h2>
                <div className="mt-4 space-y-3 text-xs text-slate-300">
                  <div className="flex items-center justify-between">
                    <span>Analyzed assets</span>
                    <span>{analytics.visual_compliance_trends?.reduce((sum, item) => sum + (item.analyzed_assets || 0), 0) || 0}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Potential findings</span>
                    <span>{analytics.visual_compliance_trends?.reduce((sum, item) => sum + (item.potential_findings || 0), 0) || 0}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Needs verification</span>
                    <span>{analytics.visual_compliance_trends?.reduce((sum, item) => sum + (item.needs_verification || 0), 0) || 0}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Bottom Section: Recent Activity matching Reference Image Screen 1 */}
          <div className="rounded-2xl border border-navy-700/60 bg-navy-850 p-5 shadow-xl">
            <div className="flex items-center justify-between pb-4 border-b border-navy-750">
              <h2 className="text-sm font-bold text-white tracking-wide">Recent Activity</h2>
              <Link
                to="/audit"
                className="text-xs font-semibold text-blue-400 hover:text-blue-300 transition flex items-center gap-1"
              >
                View all →
              </Link>
            </div>

            <div className="mt-4 space-y-3">
              {overview.recent_activities?.length ? (
                overview.recent_activities.slice(0, 3).map((activity) => (
                  <div
                    key={activity.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-navy-750 bg-navy-900/60 p-3.5 hover:border-navy-700 transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                        <CheckCircle2 size={16} />
                      </div>
                      <div>
                        <p className="text-xs font-medium text-slate-200">
                          {activity.action.replaceAll(".", " ").replaceAll("_", " ")}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {activity.actor_name} · {activity.entity_type.replaceAll("_", " ")}
                        </p>
                      </div>
                    </div>
                    <span className="text-[11px] font-medium text-slate-400">
                      {formatTimeAgo(activity.created_at)}
                    </span>
                  </div>
                ))
              ) : (
                <p className="py-3 text-center text-xs text-slate-400">
                  No recent organisation activity.
                </p>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
