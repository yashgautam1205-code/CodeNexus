import { useEffect, useState, useMemo } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Eye,
  FileCode,
  FileSpreadsheet,
  FileText,
  History,
  ListChecks,
  RefreshCw,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Button, Card, EmptyState, ErrorNotice, Loading, SuccessNotice } from "../components/Feedback";
import { useAuth } from "../context/AuthContext";
import { api, getErrorMessage } from "../services/api";

const reviewableRoles = ["admin", "brand_manager", "reviewer"];

export default function ReviewsPage() {
  const { user } = useAuth();
  const [submissions, setSubmissions] = useState([]);
  const [analyses, setAnalyses] = useState([]);
  const [comments, setComments] = useState({});
  const [history, setHistory] = useState({});
  const [expandedId, setExpandedId] = useState(null);
  const [reviewingSubmission, setReviewingSubmission] = useState(null); // Active submission in review modal
  const [severityFilter, setSeverityFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState("newest");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const canReview = reviewableRoles.includes(user?.role);

  async function load() {
    setLoading(true);
    try {
      const [submissionResponse, analysisResponse] = await Promise.all([
        api.get("/api/content"),
        api.get("/api/analysis"),
      ]);
      setSubmissions(submissionResponse.data);
      setAnalyses(analysisResponse.data);
      setError("");
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Review queue could not be loaded."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const latestAnalysis = useMemo(() => {
    const map = new Map();
    for (const analysis of analyses) {
      if (!map.has(analysis.submission_id)) {
        map.set(analysis.submission_id, analysis);
      }
    }
    return map;
  }, [analyses]);

  // Determine highest severity for a submission
  function getSubmissionSeverity(submissionId) {
    const analysis = latestAnalysis.get(submissionId);
    if (!analysis || !analysis.findings || analysis.findings.length === 0) return "none";
    const severities = analysis.findings.map((f) => f.severity);
    if (severities.includes("critical")) return "critical";
    if (severities.includes("high")) return "high";
    if (severities.includes("medium")) return "medium";
    if (severities.includes("low")) return "low";
    return "none";
  }

  async function decide(submissionId, action) {
    setBusyId(submissionId);
    setError("");
    setSuccess("");
    const comment = comments[submissionId] || "";
    try {
      const { data } = await api.post(`/api/reviews/${submissionId}/${action}`, { comment });
      setSuccess(`Decision recorded: ${data.decision.replaceAll("_", " ")}.`);
      setReviewingSubmission(null);
      await load();
      await loadHistory(submissionId);
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Review decision could not be saved."));
    } finally {
      setBusyId("");
    }
  }

  async function loadHistory(submissionId) {
    try {
      const { data } = await api.get(`/api/reviews/${submissionId}/history`);
      setHistory((current) => ({ ...current, [submissionId]: data }));
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Review history could not be loaded."));
    }
  }

  // Filter and sort
  const filteredSubmissions = useMemo(() => {
    let result = [...submissions];

    if (severityFilter !== "all") {
      result = result.filter((s) => getSubmissionSeverity(s.id) === severityFilter);
    }

    result.sort((a, b) => {
      const dateA = new Date(a.created_at);
      const dateB = new Date(b.created_at);
      return sortOrder === "newest" ? dateB - dateA : dateA - dateB;
    });

    return result;
  }, [submissions, severityFilter, sortOrder, latestAnalysis]);

  function getFileIcon(filename) {
    const ext = filename?.split(".").pop()?.toLowerCase();
    if (ext === "pdf") {
      return (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 text-blue-400 border border-blue-500/30">
          <FileText size={20} />
        </div>
      );
    }
    if (ext === "docx" || ext === "doc") {
      return (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 text-blue-400 border border-blue-500/30">
          <FileSpreadsheet size={20} />
        </div>
      );
    }
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 text-blue-400 border border-blue-500/30">
        <FileCode size={20} />
      </div>
    );
  }

  function formatDate(isoString) {
    if (!isoString) return "-";
    const d = new Date(isoString);
    const datePart = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const timePart = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
    return `${datePart} - ${timePart}`;
  }

  function getSeverityBadge(severity) {
    if (severity === "critical") {
      return <span className="inline-flex rounded-full px-3 py-0.5 text-xs font-semibold bg-rose-600 text-white">Critical</span>;
    }
    if (severity === "high") {
      return <span className="inline-flex rounded-full px-3 py-0.5 text-xs font-semibold bg-amber-600 text-white">High</span>;
    }
    if (severity === "medium") {
      return <span className="inline-flex rounded-full px-3 py-0.5 text-xs font-semibold bg-yellow-600 text-white">Medium</span>;
    }
    if (severity === "low") {
      return <span className="inline-flex rounded-full px-3 py-0.5 text-xs font-semibold bg-blue-600 text-white">Low</span>;
    }
    return <span className="inline-flex rounded-full px-3 py-0.5 text-xs font-semibold bg-slate-800 text-slate-400 border border-navy-700">None</span>;
  }

  function getStatusBadge(status) {
    const s = (status || "").toLowerCase();
    if (s === "approved") {
      return <span className="inline-flex rounded-full px-3 py-0.5 text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">Approved</span>;
    }
    if (s === "rejected") {
      return <span className="inline-flex rounded-full px-3 py-0.5 text-xs font-semibold bg-rose-500/20 text-rose-400 border border-rose-500/30">Rejected</span>;
    }
    if (s.includes("revision")) {
      return <span className="inline-flex rounded-full px-3 py-0.5 text-xs font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30">Revision</span>;
    }
    return <span className="inline-flex rounded-full px-3 py-0.5 text-xs font-semibold bg-blue-500/20 text-blue-400 border border-blue-500/30">Pending Review</span>;
  }

  return (
    <div className="space-y-6">
      {/* Top Header matching Reference Image Screen 5 */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30 shadow-inner">
            <ListChecks size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Review Queue</h1>
            <p className="text-xs text-slate-400">
              Review and approve analysis findings
            </p>
          </div>
        </div>
      </div>

      <ErrorNotice>{error}</ErrorNotice>
      <SuccessNotice>{success}</SuccessNotice>

      {/* Filter Toolbar matching Reference Image Screen 5 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-navy-700/60 bg-navy-850 p-3 shadow-md">
        <div className="flex flex-wrap items-center gap-3">
          {/* Severity Dropdown */}
          <div className="relative">
            <select
              aria-label="Filter submissions by severity"
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="rounded-xl border border-navy-700 bg-navy-900 px-3.5 py-1.5 text-xs font-medium text-slate-200 outline-none hover:border-navy-600 cursor-pointer shadow-sm transition"
            >
              <option value="all">All Severities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>

          {/* Sort Dropdown */}
          <div className="relative">
            <select
              aria-label="Sort submissions order"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              className="rounded-xl border border-navy-700 bg-navy-900 px-3.5 py-1.5 text-xs font-medium text-slate-200 outline-none hover:border-navy-600 cursor-pointer shadow-sm transition"
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
            </select>
          </div>
        </div>

        {/* Refresh Button */}
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-1.5 rounded-xl border border-navy-700 bg-navy-900 hover:bg-navy-800 px-3.5 py-1.5 text-xs font-semibold text-slate-300 hover:text-white transition shadow-sm"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {/* Queue List / Table matching Reference Image Screen 5 */}
      <div className="rounded-2xl border border-navy-700/60 bg-navy-850 p-5 shadow-xl">
        <div className="space-y-3">
          {loading ? (
            <Loading label="Loading review queue..." />
          ) : filteredSubmissions.length === 0 ? (
            <div className="py-12">
              <EmptyState
                title="No submissions match criteria"
                description="Submitted marketing copy will appear here for human governance review."
              />
            </div>
          ) : (
            filteredSubmissions.map((submission) => {
              const analysis = latestAnalysis.get(submission.id);
              const findingsCount = analysis?.findings?.length || 0;
              const highestSeverity = getSubmissionSeverity(submission.id);
              const isPending = !submission.review_status || submission.review_status === "pending";
              const isExpanded = expandedId === submission.id;

              return (
                <div
                  key={submission.id}
                  className="rounded-xl border border-navy-750 bg-navy-900/60 p-4 transition hover:border-navy-700 shadow-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    {/* Submission Name and Date */}
                    <div className="flex items-center gap-3.5 min-w-[200px]">
                      {getFileIcon(submission.filename)}
                      <div className="min-w-0">
                        <h3 className="truncate font-semibold text-white text-xs" title={submission.filename}>
                          {submission.filename}
                        </h3>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {formatDate(submission.created_at)}
                        </p>
                      </div>
                    </div>

                    {/* Findings count */}
                    <div className="text-xs text-slate-300 font-medium">
                      {findingsCount} {findingsCount === 1 ? "finding" : "findings"}
                    </div>

                    {/* Severity pill */}
                    <div>
                      {getSeverityBadge(highestSeverity)}
                    </div>

                    {/* Status pill */}
                    <div>
                      {getStatusBadge(submission.review_status)}
                    </div>

                    {/* Action buttons matching screenshot */}
                    <div className="flex items-center gap-2">
                      {isPending && canReview ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setReviewingSubmission(submission)}
                            className="rounded-lg bg-blue-600 hover:bg-blue-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition"
                          >
                            Review
                          </button>
                          <button
                            type="button"
                            onClick={() => setExpandedId(isExpanded ? null : submission.id)}
                            className="rounded-lg border border-navy-700 bg-navy-800 hover:bg-navy-750 px-3 py-1.5 text-xs font-semibold text-slate-300 transition"
                          >
                            Details
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => setExpandedId(isExpanded ? null : submission.id)}
                            className="rounded-lg border border-navy-700 bg-navy-800 hover:bg-navy-750 px-3 py-1.5 text-xs font-semibold text-slate-300 transition"
                          >
                            View
                          </button>
                          {canReview && (
                            <button
                              type="button"
                              onClick={() => setReviewingSubmission(submission)}
                              className="rounded-lg border border-navy-700 bg-navy-800 hover:bg-navy-750 px-3 py-1.5 text-xs font-semibold text-blue-400 transition"
                            >
                              Update Decision
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Expanded Findings and Details */}
                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-navy-800 space-y-3">
                      {analysis ? (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs pb-1">
                            <span className="font-semibold text-slate-300">
                              Analysis Findings ({analysis.findings.length})
                            </span>
                            <Link
                              to={`/analysis/${analysis.id}`}
                              className="text-blue-400 hover:underline inline-flex items-center gap-1 font-medium"
                            >
                              Open Full Analysis Report <ArrowRight size={13} />
                            </Link>
                          </div>

                          {analysis.findings.map((finding) => (
                            <div key={finding.id} className="rounded-xl border border-navy-800 bg-navy-950/70 p-3 text-xs">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-bold text-white capitalize">{finding.category.replaceAll("_", " ")}</span>
                                <span className="text-[10px] text-slate-400">· {finding.severity} severity</span>
                              </div>
                              <p className="text-slate-300">{finding.explanation}</p>
                              {finding.evidence_text && (
                                <p className="mt-1 text-[11px] text-blue-300 italic">
                                  Guideline: "{finding.evidence_text}"
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-amber-400">No automated analysis found for this file.</p>
                      )}

                      {/* Content text preview */}
                      <details className="text-xs text-slate-400">
                        <summary className="cursor-pointer font-medium text-slate-300 hover:text-white">
                          View extracted source text
                        </summary>
                        <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl border border-navy-800 bg-navy-950 p-3 text-[11px] font-mono text-slate-300">
                          {submission.extracted_text}
                        </pre>
                      </details>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Review Decision Modal */}
      {reviewingSubmission && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-navy-700 bg-navy-850 p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-navy-750">
              <div>
                <h3 className="text-base font-bold text-white">Review Submission</h3>
                <p className="text-xs text-slate-400 mt-0.5">{reviewingSubmission.filename}</p>
              </div>
              <button
                type="button"
                onClick={() => setReviewingSubmission(null)}
                className="rounded-lg p-1 text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label className="form-label">Reviewer Feedback & Comment</label>
                <textarea
                  rows={3}
                  className="form-input text-xs"
                  placeholder="Required for Reject or Revision; optional for Approve..."
                  value={comments[reviewingSubmission.id] || ""}
                  onChange={(e) =>
                    setComments({ ...comments, [reviewingSubmission.id]: e.target.value })
                  }
                />
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2.5 pt-3 border-t border-navy-750">
                <button
                  type="button"
                  onClick={() => setReviewingSubmission(null)}
                  className="rounded-xl border border-navy-700 bg-navy-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-navy-750 transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busyId === reviewingSubmission.id || !(comments[reviewingSubmission.id] || "").trim()}
                  onClick={() => decide(reviewingSubmission.id, "reject")}
                  className="rounded-xl bg-rose-600 hover:bg-rose-500 px-4 py-2 text-xs font-semibold text-white shadow-sm transition disabled:opacity-50"
                >
                  Reject
                </button>
                <button
                  type="button"
                  disabled={busyId === reviewingSubmission.id || !(comments[reviewingSubmission.id] || "").trim()}
                  onClick={() => decide(reviewingSubmission.id, "request-revision")}
                  className="rounded-xl border border-amber-600/50 bg-amber-600/20 text-amber-300 hover:bg-amber-600/30 px-4 py-2 text-xs font-semibold transition disabled:opacity-50"
                >
                  Request Revision
                </button>
                <button
                  type="button"
                  disabled={busyId === reviewingSubmission.id}
                  onClick={() => decide(reviewingSubmission.id, "approve")}
                  className="rounded-xl bg-emerald-600 hover:bg-emerald-500 px-4 py-2 text-xs font-semibold text-white shadow-sm transition disabled:opacity-50"
                >
                  Approve Content
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
