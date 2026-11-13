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
  User,
  X,
  Filter,
  SlidersHorizontal,
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
  const [assignments, setAssignments] = useState([]);
  const [reviewers, setReviewers] = useState([]);
  const [assignmentSelections, setAssignmentSelections] = useState({});
  const [expandedId, setExpandedId] = useState(null);
  const [reviewingSubmission, setReviewingSubmission] = useState(null);
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [severityFilter, setSeverityFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState("newest");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const canReview = reviewableRoles.includes(user?.role);
  const canAssign = ["admin", "brand_manager"].includes(user?.role);

  async function load() {
    setLoading(true);
    try {
      const requests = [
        api.get("/api/content"),
        api.get("/api/analysis"),
        api.get("/api/review-assignments"),
      ];
      if (canAssign) requests.push(api.get("/api/review-assignments/reviewers"));
      const responses = await Promise.all(requests);
      const [submissionResponse, analysisResponse, assignmentResponse] = responses;
      setSubmissions(submissionResponse.data);
      setAnalyses(analysisResponse.data);
      setAssignments(assignmentResponse.data);
      if (canAssign) setReviewers(responses[3].data);
      setError("");
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Review queue could not be loaded."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [canAssign]);

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
    const assignedIds = new Set(
      assignments
        .filter((assignment) => assignment.resource_type === "content" && assignment.status === "pending")
        .map((assignment) => assignment.resource_id),
    );
    if (user?.role === "reviewer" && assignedIds.size > 0) {
      result = result.filter((submission) => assignedIds.has(submission.id));
    }

    if (severityFilter !== "all") {
      result = result.filter((s) => getSubmissionSeverity(s.id) === severityFilter);
    }

    if (statusFilter !== "all") {
      result = result.filter((s) => {
        const st = (s.review_status || "pending").toLowerCase();
        return st === statusFilter;
      });
    }

    result.sort((a, b) => {
      const dateA = new Date(a.created_at);
      const dateB = new Date(b.created_at);
      return sortOrder === "newest" ? dateB - dateA : dateA - dateB;
    });

    return result;
  }, [submissions, assignments, severityFilter, sortOrder, statusFilter, latestAnalysis, user?.role]);

  // Keep selected submission updated if refreshed
  useEffect(() => {
    if (selectedSubmission) {
      const updated = submissions.find((s) => s.id === selectedSubmission.id);
      if (updated) setSelectedSubmission(updated);
    }
  }, [submissions]);

  async function assignSubmission(submissionId) {
    const reviewerId = assignmentSelections[submissionId];
    if (!reviewerId) return;
    setBusyId(submissionId);
    setError("");
    setSuccess("");
    try {
      const { data } = await api.post("/api/review-assignments", {
        resource_type: "content",
        resource_id: submissionId,
        reviewer_id: reviewerId,
      });
      setSuccess(`Assigned to ${data.reviewer_name}.`);
      await load();
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Review assignment could not be saved."));
    } finally {
      setBusyId("");
    }
  }

  function getFileIcon(filename) {
    const ext = filename?.split(".").pop()?.toLowerCase();
    if (ext === "pdf") {
      return (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 text-rose-400 border border-rose-500/30">
          <FileText size={19} />
        </div>
      );
    }
    if (ext === "docx" || ext === "doc") {
      return (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 text-blue-400 border border-blue-500/30">
          <FileSpreadsheet size={19} />
        </div>
      );
    }
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
        <FileCode size={19} />
      </div>
    );
  }

  function formatDate(isoString) {
    if (!isoString) return "-";
    const d = new Date(isoString);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function formatDateTime(isoString) {
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

  function getSeverityBadge(severity) {
    if (severity === "critical") {
      return <span className="inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold bg-rose-600 text-white tracking-wide">Critical</span>;
    }
    if (severity === "high") {
      return <span className="inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold bg-amber-600 text-white tracking-wide">High</span>;
    }
    if (severity === "medium") {
      return <span className="inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold bg-yellow-600 text-white tracking-wide">Medium</span>;
    }
    if (severity === "low") {
      return <span className="inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold bg-blue-600 text-white tracking-wide">Low</span>;
    }
    return <span className="inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold bg-slate-800 text-slate-400 border border-navy-700">None</span>;
  }

  function getStatusBadge(status) {
    const s = (status || "").toLowerCase();
    if (s === "approved") {
      return <span className="inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">Approved</span>;
    }
    if (s === "rejected") {
      return <span className="inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold bg-rose-500/20 text-rose-400 border border-rose-500/30">Rejected</span>;
    }
    if (s.includes("revision")) {
      return <span className="inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30">Revision</span>;
    }
    return <span className="inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">Pending</span>;
  }

  function getComplianceScore(analysis) {
    if (!analysis) return null;
    const findings = analysis.findings || [];
    if (findings.length === 0) return 100;
    const weights = { critical: 25, high: 15, medium: 8, low: 3 };
    const penalty = findings.reduce((acc, f) => acc + (weights[f.severity] || 3), 0);
    return Math.max(0, 100 - penalty);
  }

  const selectedAnalysis = selectedSubmission ? latestAnalysis.get(selectedSubmission.id) : null;
  const selectedHistory = selectedSubmission ? (history[selectedSubmission.id] || null) : null;
  const selectedAssignment = selectedSubmission
    ? assignments.find((a) => a.resource_type === "content" && a.resource_id === selectedSubmission.id && a.status === "pending")
    : null;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 shadow-inner">
            <ListChecks size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Review Center</h1>
            <p className="text-xs text-slate-400">Enterprise content governance & human-in-the-loop decisions</p>
          </div>
        </div>
      </div>

      <ErrorNotice>{error}</ErrorNotice>
      <SuccessNotice>{success}</SuccessNotice>

      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-navy-700/60 bg-navy-850 p-3 shadow-md">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 text-slate-400">
            <SlidersHorizontal size={14} />
          </div>
          <select
            aria-label="Filter by severity"
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="rounded-xl border border-navy-700 bg-navy-900 px-3.5 py-1.5 text-xs font-medium text-slate-200 outline-none hover:border-navy-600 cursor-pointer focus:border-indigo-400 transition"
          >
            <option value="all">All Severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          <select
            aria-label="Sort order"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            className="rounded-xl border border-navy-700 bg-navy-900 px-3.5 py-1.5 text-xs font-medium text-slate-200 outline-none hover:border-navy-600 cursor-pointer focus:border-indigo-400 transition"
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
          </select>

          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-navy-700 bg-navy-900 px-3.5 py-1.5 text-xs font-medium text-slate-200 outline-none hover:border-navy-600 cursor-pointer focus:border-indigo-400 transition"
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>

        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-1.5 rounded-xl border border-navy-700 bg-navy-900 hover:bg-navy-800 px-3.5 py-1.5 text-xs font-semibold text-slate-300 hover:text-white transition shadow-sm"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Two-Panel Layout */}
      <div className="grid gap-5 lg:grid-cols-[2fr_3fr]" style={{ minHeight: "620px" }}>
        {/* LEFT PANEL: Review Queue (40%) */}
        <div className="rounded-2xl border border-navy-700/60 bg-navy-850 shadow-xl flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-navy-750 bg-navy-900/40">
            <h2 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Review Queue</h2>
            <span className="text-xs text-slate-400 font-medium">{filteredSubmissions.length} items</span>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {loading ? (
              <Loading label="Loading review queue..." />
            ) : filteredSubmissions.length === 0 ? (
              <div className="p-8">
                <EmptyState
                  title="No submissions match criteria"
                  description="Submitted marketing copy will appear here for review."
                />
              </div>
            ) : (
              filteredSubmissions.map((submission) => {
                const analysis = latestAnalysis.get(submission.id);
                const findingsCount = analysis?.findings?.length || 0;
                const highestSeverity = getSubmissionSeverity(submission.id);
                const isPending = !submission.review_status || submission.review_status === "pending";
                const isSelected = selectedSubmission?.id === submission.id;
                const currentAssignment = assignments.find(
                  (a) => a.resource_type === "content" && a.resource_id === submission.id && a.status === "pending",
                );
                const isAssignedToMe = currentAssignment && user?.role === "reviewer";

                return (
                  <div
                    key={submission.id}
                    onClick={() => {
                      setSelectedSubmission(submission);
                      if (!history[submission.id]) loadHistory(submission.id);
                    }}
                    className={`group rounded-xl border p-3.5 cursor-pointer transition-all ${
                      isSelected
                        ? "border-indigo-500/80 bg-indigo-500/10 shadow-lg shadow-indigo-950/40 ring-1 ring-indigo-500/40"
                        : isPending
                        ? "border-navy-700/80 bg-navy-900/70 hover:border-indigo-500/40 hover:bg-navy-800/60"
                        : "border-navy-800/60 bg-navy-900/30 hover:border-navy-700 hover:bg-navy-800/40"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {getFileIcon(submission.filename)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="truncate text-xs font-semibold text-white leading-tight group-hover:text-indigo-200 transition-colors" title={submission.filename}>
                            {submission.filename}
                          </h3>
                          {getStatusBadge(submission.review_status)}
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5">{formatDate(submission.created_at)}</p>
                        <div className="flex items-center gap-2 mt-2">
                          {getSeverityBadge(highestSeverity)}
                          <span className="text-[11px] text-slate-400">
                            {findingsCount} {findingsCount === 1 ? "finding" : "findings"}
                          </span>
                          {isAssignedToMe && (
                            <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                              Assigned
                            </span>
                          )}
                        </div>

                        {/* Inline Assign for admin/brand_manager */}
                        {canAssign && isPending && (
                          <div className="flex items-center gap-1.5 mt-2.5 pt-2 border-t border-navy-800/80" onClick={(e) => e.stopPropagation()}>
                            <select
                              aria-label={`Assign ${submission.filename} to reviewer`}
                              value={assignmentSelections[submission.id] || currentAssignment?.reviewer_id || ""}
                              onChange={(event) =>
                                setAssignmentSelections({ ...assignmentSelections, [submission.id]: event.target.value })
                              }
                              className="flex-1 min-w-0 rounded-lg border border-navy-700 bg-navy-800 px-2 py-1 text-[11px] text-slate-200 outline-none"
                            >
                              <option value="">Assign reviewer...</option>
                              {reviewers.map((reviewer) => (
                                <option key={reviewer.id} value={reviewer.id}>{reviewer.full_name}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              disabled={busyId === submission.id || !(assignmentSelections[submission.id] || currentAssignment?.reviewer_id)}
                              onClick={() => assignSubmission(submission.id)}
                              className="rounded-lg border border-indigo-600/50 bg-indigo-600/20 px-2.5 py-1 text-[11px] font-semibold text-indigo-300 disabled:opacity-50 hover:bg-indigo-600/30 transition"
                            >
                              Assign
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT PANEL: Active Review Workspace (60%) */}
        <div className="rounded-2xl border border-navy-700/60 bg-navy-850 shadow-xl flex flex-col overflow-hidden">
          {selectedSubmission ? (
            <div className="flex flex-col h-full">
              {/* Workspace header */}
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-navy-750 bg-navy-900/50">
                <div className="flex items-center gap-3 min-w-0">
                  {getFileIcon(selectedSubmission.filename)}
                  <div className="min-w-0">
                    <h2 className="font-bold text-white text-sm truncate" title={selectedSubmission.filename}>
                      {selectedSubmission.filename}
                    </h2>
                    <p className="text-[11px] text-slate-400">{formatDateTime(selectedSubmission.created_at)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {getStatusBadge(selectedSubmission.review_status)}
                  <button
                    type="button"
                    onClick={() => setSelectedSubmission(null)}
                    className="rounded-lg p-1.5 text-slate-500 hover:text-white hover:bg-navy-800 transition"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>

              {/* Workspace body */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {/* AI Findings Summary & Score */}
                {selectedAnalysis ? (
                  <div className="rounded-xl border border-navy-700/60 bg-navy-900/60 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Sparkles size={15} className="text-indigo-400" />
                        <h3 className="text-xs font-bold text-white tracking-wide">AI Findings & Compliance Score</h3>
                      </div>
                      <Link
                        to={`/analysis/${selectedAnalysis.id}`}
                        className="text-[11px] text-indigo-400 hover:text-indigo-300 hover:underline inline-flex items-center gap-1 font-semibold transition"
                      >
                        Open Full Analysis <ArrowRight size={12} />
                      </Link>
                    </div>

                    {/* Score Bar */}
                    {(() => {
                      const score = getComplianceScore(selectedAnalysis);
                      const scoreColor = score >= 80 ? "text-emerald-400" : score >= 60 ? "text-amber-400" : "text-rose-400";
                      const barColor = score >= 80 ? "bg-emerald-500" : score >= 60 ? "bg-amber-500" : "bg-rose-500";
                      return (
                        <div className="mb-4 flex items-center gap-3 rounded-lg bg-navy-950/60 p-3 border border-navy-800">
                          <div className={`text-2xl font-black ${scoreColor}`}>{score}%</div>
                          <div className="flex-1">
                            <div className="text-[11px] text-slate-400 mb-1 flex justify-between font-medium">
                              <span>Brand Compliance</span>
                              <span>{selectedAnalysis.findings?.length || 0} findings detected</span>
                            </div>
                            <div className="h-2 w-full rounded-full bg-navy-800 overflow-hidden">
                              <div className={`h-2 rounded-full ${barColor} transition-all duration-500`} style={{ width: `${score}%` }} />
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Findings List */}
                    {selectedAnalysis.findings && selectedAnalysis.findings.length > 0 ? (
                      <div className="space-y-2">
                        {selectedAnalysis.findings.map((finding) => (
                          <div key={finding.id} className="rounded-lg border border-navy-800 bg-navy-950/70 p-3 text-xs">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-bold text-white capitalize">{finding.category?.replaceAll("_", " ")}</span>
                              <span className="text-[10px] text-slate-500">· {finding.severity} severity</span>
                            </div>
                            <p className="text-slate-300">{finding.explanation}</p>
                            {finding.evidence_text && (
                              <p className="mt-1.5 text-[11px] text-indigo-300 italic bg-indigo-950/30 rounded px-2 py-1 border border-indigo-900/40">
                                Guideline: "{finding.evidence_text}"
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-emerald-400">All brand rules satisfied. No compliance violations detected.</p>
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-400">
                    No automated analysis found for this submission.
                  </div>
                )}

                {/* Assignment info */}
                {selectedAssignment && (
                  <div className="rounded-xl border border-navy-700/60 bg-navy-900/40 px-4 py-3 flex items-center gap-2 text-xs text-slate-400">
                    <User size={14} className="text-indigo-400 shrink-0" />
                    Assigned to <span className="text-white font-semibold">{selectedAssignment.reviewer_name || "Reviewer"}</span>
                  </div>
                )}

                {/* Extracted text preview */}
                {selectedSubmission.extracted_text && (
                  <details className="text-xs text-slate-400">
                    <summary className="cursor-pointer font-medium text-slate-300 hover:text-white transition">
                      View extracted source text
                    </summary>
                    <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl border border-navy-800 bg-navy-950 p-3 text-[11px] font-mono text-slate-300">
                      {selectedSubmission.extracted_text}
                    </pre>
                  </details>
                )}

                {/* Review Actions (for authorized roles) */}
                {canReview && (
                  <div className="rounded-xl border border-navy-700/60 bg-navy-900/60 p-4">
                    <h3 className="text-xs font-bold text-white mb-2 tracking-wide uppercase">Review Decision</h3>
                    <div className="mb-3">
                      <label className="form-label">Reviewer Feedback & Comment</label>
                      <textarea
                        rows={3}
                        className="form-input text-xs"
                        placeholder="Required for Reject or Request Revision; optional for Approve..."
                        value={comments[selectedSubmission.id] || ""}
                        onChange={(e) => setComments({ ...comments, [selectedSubmission.id]: e.target.value })}
                      />
                    </div>
                    <div className="flex flex-wrap gap-2.5">
                      <button
                        type="button"
                        disabled={busyId === selectedSubmission.id}
                        onClick={() => decide(selectedSubmission.id, "approve")}
                        className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition disabled:opacity-50 flex items-center justify-center gap-1.5"
                      >
                        <Check size={14} /> Approve Content
                      </button>
                      <button
                        type="button"
                        disabled={busyId === selectedSubmission.id || !(comments[selectedSubmission.id] || "").trim()}
                        onClick={() => decide(selectedSubmission.id, "request-revision")}
                        className="flex-1 rounded-xl border border-amber-600/40 bg-amber-600/15 text-amber-300 hover:bg-amber-600/25 px-3.5 py-2 text-xs font-semibold transition disabled:opacity-50 flex items-center justify-center gap-1.5"
                      >
                        <RotateCcw size={14} /> Request Revision
                      </button>
                      <button
                        type="button"
                        disabled={busyId === selectedSubmission.id || !(comments[selectedSubmission.id] || "").trim()}
                        onClick={() => decide(selectedSubmission.id, "reject")}
                        className="flex-1 rounded-xl bg-rose-600 hover:bg-rose-500 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition disabled:opacity-50 flex items-center justify-center gap-1.5"
                      >
                        <X size={14} /> Reject
                      </button>
                    </div>
                  </div>
                )}

                {/* Decision History */}
                <div className="rounded-xl border border-navy-700/60 bg-navy-900/40 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <History size={14} className="text-slate-400" />
                      <h3 className="text-xs font-bold text-white tracking-wide">Decision History</h3>
                    </div>
                    {!selectedHistory && (
                      <button
                        type="button"
                        onClick={() => loadHistory(selectedSubmission.id)}
                        className="text-[11px] text-indigo-400 hover:underline transition"
                      >
                        Load
                      </button>
                    )}
                  </div>
                  {selectedHistory ? (
                    selectedHistory.length === 0 ? (
                      <p className="text-[11px] text-slate-500">No review decisions yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {selectedHistory.map((entry, i) => (
                          <div key={entry.id || i} className="rounded-lg border border-navy-800 bg-navy-950/50 p-3 text-xs">
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-semibold text-slate-200 capitalize">{(entry.decision || "").replaceAll("_", " ")}</span>
                              <span className="text-[11px] text-slate-500">{formatDateTime(entry.created_at)}</span>
                            </div>
                            {entry.comment && <p className="text-slate-400 italic">"{entry.comment}"</p>}
                          </div>
                        ))}
                      </div>
                    )
                  ) : (
                    <p className="text-[11px] text-slate-500">Click Load to view historical records.</p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center px-8 py-16">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-navy-900/80 border border-navy-750 text-indigo-400 mx-auto mb-4 shadow-inner">
                  <Eye size={28} />
                </div>
                <h3 className="text-sm font-semibold text-white">Select a submission to begin review</h3>
                <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                  Choose any marketing submission from the queue on the left to inspect AI compliance findings and make decisions.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Review Modal (preserved for mobile/compact triggers) */}
      {reviewingSubmission && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <div className="w-full max-w-xl rounded-2xl border border-navy-700 bg-navy-850 p-7 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-navy-750">
              <div>
                <h3 className="text-base font-bold text-white">Review Submission</h3>
                <p className="text-xs text-slate-400 mt-0.5">{reviewingSubmission.filename}</p>
              </div>
              <button
                type="button"
                onClick={() => setReviewingSubmission(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:text-white hover:bg-navy-800 transition"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <label className="form-label">Reviewer Feedback & Comment</label>
                <textarea
                  rows={4}
                  className="form-input text-xs"
                  placeholder="Required for Reject or Revision; optional for Approve..."
                  value={comments[reviewingSubmission.id] || ""}
                  onChange={(e) =>
                    setComments({ ...comments, [reviewingSubmission.id]: e.target.value })
                  }
                />
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2.5 pt-4 border-t border-navy-750">
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
