import { useEffect, useState, useMemo } from "react";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Filter,
  History,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  User,
  XCircle,
} from "lucide-react";
import { EmptyState, ErrorNotice, Loading } from "../components/Feedback";
import { api, getErrorMessage } from "../services/api";

export default function AuditHistoryPage() {
  const [activities, setActivities] = useState([]);
  const [timeRange, setTimeRange] = useState("90");
  const [searchTerm, setSearchTerm] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [expandedRowId, setExpandedRowId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadAuditLog() {
    setLoading(true);
    setError("");
    try {
      // 1. Fetch dashboard overview which contains recent_activities
      const [overviewRes, contentRes] = await Promise.all([
        api.get("/api/dashboard/overview", { params: { days: timeRange } }),
        api.get("/api/content").catch(() => ({ data: [] })),
      ]);

      const recentActs = overviewRes.data?.recent_activities || [];
      const contents = contentRes.data || [];
      const contentMap = new Map(contents.map((c) => [c.id, c.filename]));

      // 2. Fetch detailed review histories for submissions to build comprehensive audit logs
      const reviewHistoriesPromises = contents.slice(0, 20).map(async (content) => {
        try {
          const res = await api.get(`/api/reviews/${content.id}/history`);
          return (res.data || []).map((review) => ({
            id: `review-${review.id}`,
            created_at: review.created_at,
            action: review.decision === "approve"
              ? "Approved"
              : review.decision === "reject"
              ? "Rejected"
              : review.decision === "request_revision"
              ? "Requested Revision"
              : review.decision,
            actor_name: review.reviewer_id || "Reviewer",
            details: content.filename,
            entity_type: "content_review",
            status: review.new_status || review.decision,
            comment: review.comment,
          }));
        } catch {
          return [];
        }
      });

      const reviewHistoriesResults = await Promise.all(reviewHistoriesPromises);
      const flattenedReviews = reviewHistoriesResults.flat();

      // Convert overview recent_activities into unified audit logs
      const convertedActs = recentActs.map((act) => {
        let actionLabel = act.action.replaceAll(".", " ").replaceAll("_", " ");
        let statusLabel = "Logged";
        if (actionLabel.toLowerCase().includes("approve")) {
          actionLabel = "Approved";
          statusLabel = "Approved";
        } else if (actionLabel.toLowerCase().includes("reject")) {
          actionLabel = "Rejected";
          statusLabel = "Rejected";
        } else if (actionLabel.toLowerCase().includes("revision")) {
          actionLabel = "Requested Revision";
          statusLabel = "Revision";
        } else if (actionLabel.toLowerCase().includes("upload")) {
          actionLabel = "Uploaded";
          statusLabel = "Pending";
        } else if (actionLabel.toLowerCase().includes("analy")) {
          actionLabel = "Analyzed";
          statusLabel = "Analyzed";
        }

        const detailsText = contentMap.get(act.entity_id) || `${act.entity_type}: ${act.entity_id.slice(0, 8)}…`;

        return {
          id: `act-${act.id}`,
          created_at: act.created_at,
          action: actionLabel,
          actor_name: act.actor_name || "System User",
          details: detailsText,
          entity_type: act.entity_type || "activity",
          status: statusLabel,
        };
      });

      // Combine and deduplicate
      const combined = [...flattenedReviews, ...convertedActs];
      // Sort newest first
      combined.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      setActivities(combined);
    } catch (err) {
      setError(getErrorMessage(err, "Audit history could not be loaded."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAuditLog();
  }, [timeRange]);

  const filtered = useMemo(() => {
    return activities.filter((item) => {
      if (actionFilter !== "all") {
        if (!item.action.toLowerCase().includes(actionFilter.toLowerCase())) return false;
      }
      if (searchTerm) {
        const query = searchTerm.toLowerCase();
        const matchesUser = item.actor_name?.toLowerCase().includes(query);
        const matchesDetails = item.details?.toLowerCase().includes(query);
        const matchesAction = item.action?.toLowerCase().includes(query);
        if (!matchesUser && !matchesDetails && !matchesAction) return false;
      }
      return true;
    });
  }, [activities, actionFilter, searchTerm]);

  // Summary stats
  const stats = useMemo(() => {
    const total = activities.length;
    const approvals = activities.filter((a) => a.action.toLowerCase().includes("approve")).length;
    const revisions = activities.filter((a) => a.action.toLowerCase().includes("revision")).length;
    const rejections = activities.filter((a) => a.action.toLowerCase().includes("reject")).length;
    return { total, approvals, revisions, rejections };
  }, [activities]);

  function getActionIcon(action) {
    const act = action.toLowerCase();
    if (act.includes("approved")) {
      return (
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
          <CheckCircle2 size={15} />
        </div>
      );
    }
    if (act.includes("revision")) {
      return (
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/30">
          <AlertCircle size={15} />
        </div>
      );
    }
    if (act.includes("rejected")) {
      return (
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-500/15 text-rose-400 border border-rose-500/30">
          <XCircle size={15} />
        </div>
      );
    }
    return (
      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
        <Clock size={15} />
      </div>
    );
  }

  function getActionColor(action) {
    const act = action.toLowerCase();
    if (act.includes("approved")) return "text-emerald-400";
    if (act.includes("revision")) return "text-amber-400";
    if (act.includes("rejected")) return "text-rose-400";
    if (act.includes("uploaded")) return "text-indigo-400";
    return "text-slate-300";
  }

  function getStatusBadge(status) {
    const st = (status || "").toLowerCase();
    if (st.includes("approve")) {
      return (
        <span className="inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
          Approved
        </span>
      );
    }
    if (st.includes("revision")) {
      return (
        <span className="inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
          Revision
        </span>
      );
    }
    if (st.includes("reject")) {
      return (
        <span className="inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30">
          Rejected
        </span>
      );
    }
    return (
      <span className="inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
        {status}
      </span>
    );
  }

  function formatDate(isoString) {
    if (!isoString) return "-";
    const d = new Date(isoString);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 shadow-inner">
            <Clock size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Audit History</h1>
            <p className="text-xs text-slate-400">Comprehensive immutable audit trail of review decisions and brand actions</p>
          </div>
        </div>

        {/* Date Dropdown & Refresh */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <select
              aria-label="Filter audit history by time range"
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
              className="rounded-xl border border-navy-700 bg-navy-850 px-3.5 py-2 text-xs font-medium text-slate-200 outline-none hover:border-navy-600 cursor-pointer shadow-sm transition focus:border-indigo-400"
            >
              <option value="30">Last 30 Days</option>
              <option value="90">Last 3 Months</option>
              <option value="180">Last 6 Months</option>
              <option value="365">Last 1 Year</option>
            </select>
          </div>
          <button
            type="button"
            onClick={loadAuditLog}
            title="Refresh logs"
            aria-label="Refresh audit history"
            className="rounded-xl border border-navy-700 bg-navy-850 p-2 text-slate-400 hover:text-white hover:border-navy-600 transition shadow-sm"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <ErrorNotice>{error}</ErrorNotice>

      {/* Metric Cards Row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-navy-700/60 bg-navy-850 p-4 shadow-sm">
          <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Total Events</p>
          <p className="mt-1 text-2xl font-bold text-white">{stats.total}</p>
        </div>
        <div className="rounded-xl border border-navy-700/60 bg-navy-850 p-4 shadow-sm">
          <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Approvals</p>
          <p className="mt-1 text-2xl font-bold text-emerald-400">{stats.approvals}</p>
        </div>
        <div className="rounded-xl border border-navy-700/60 bg-navy-850 p-4 shadow-sm">
          <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Revisions</p>
          <p className="mt-1 text-2xl font-bold text-amber-400">{stats.revisions}</p>
        </div>
        <div className="rounded-xl border border-navy-700/60 bg-navy-850 p-4 shadow-sm">
          <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Rejections</p>
          <p className="mt-1 text-2xl font-bold text-rose-400">{stats.rejections}</p>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-navy-700/60 bg-navy-850 p-3 shadow-md">
        <div className="relative flex-1 min-w-[240px]">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search by user, document, or action..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-xl border border-navy-700/80 bg-navy-900 py-1.5 pl-9 pr-3 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-indigo-400 transition"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-slate-400" />
          <select
            aria-label="Filter audit history by action"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="rounded-xl border border-navy-700 bg-navy-900 px-3 py-1.5 text-xs text-slate-300 outline-none cursor-pointer focus:border-indigo-400 transition"
          >
            <option value="all">All Actions</option>
            <option value="approved">Approved</option>
            <option value="revision">Requested Revision</option>
            <option value="rejected">Rejected</option>
            <option value="upload">Uploads</option>
          </select>
        </div>
      </div>

      {/* Audit History Table */}
      <div className="rounded-2xl border border-navy-700/60 bg-navy-850 shadow-xl overflow-hidden">
        {loading ? (
          <div className="p-8">
            <Loading label="Loading audit history records..." />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12">
            <EmptyState
              title="No audit events recorded"
              description="Actions such as review decisions, content uploads, and rule modifications will appear here."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-navy-750 bg-navy-900/60 text-slate-400">
                <tr>
                  <th className="py-3.5 pl-5 pr-4 font-semibold uppercase tracking-wider text-[11px]">Action</th>
                  <th className="py-3.5 px-4 font-semibold uppercase tracking-wider text-[11px]">Date & Time</th>
                  <th className="py-3.5 px-4 font-semibold uppercase tracking-wider text-[11px]">User / Actor</th>
                  <th className="py-3.5 px-4 font-semibold uppercase tracking-wider text-[11px]">Details / Target</th>
                  <th className="py-3.5 pl-4 pr-5 font-semibold uppercase tracking-wider text-[11px] text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-750 text-slate-200">
                {filtered.map((item) => {
                  const isExpanded = expandedRowId === item.id;
                  return (
                    <tr
                      key={item.id}
                      onClick={() => setExpandedRowId(isExpanded ? null : item.id)}
                      className="hover:bg-navy-800/40 cursor-pointer transition-colors"
                    >
                      <td className="py-3.5 pl-5 pr-4 whitespace-nowrap">
                        <div className="flex items-center gap-2.5">
                          {getActionIcon(item.action)}
                          <span className={`font-semibold ${getActionColor(item.action)}`}>
                            {item.action}
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-slate-400 font-medium whitespace-nowrap">
                        {formatDate(item.created_at)}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-2 text-slate-200">
                          <User size={13} className="text-slate-500" />
                          <span className="font-medium">{item.actor_name}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-slate-300 max-w-sm">
                        <span className="truncate block font-medium" title={item.details}>
                          {item.details}
                        </span>
                        {item.comment && (
                          <p className="mt-0.5 text-[11px] text-slate-400 truncate italic">
                            "{item.comment}"
                          </p>
                        )}
                        {isExpanded && item.comment && (
                          <div className="mt-2 rounded-lg bg-navy-950 p-2.5 border border-navy-800 text-slate-300 whitespace-pre-wrap font-mono text-[11px]">
                            {item.comment}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 pl-4 pr-5 text-right whitespace-nowrap">
                        {getStatusBadge(item.status)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
