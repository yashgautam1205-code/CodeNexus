import { useEffect, useRef, useState, useMemo } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Download,
  ExternalLink,
  FileCode,
  FileDown,
  FileText,
  Info,
  LoaderCircle,
  MessageSquareQuote,
  Pencil,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { EmptyState, ErrorNotice, Loading, SuccessNotice } from "../components/Feedback";
import { useAuth } from "../context/AuthContext";
import { AI_REQUEST_TIMEOUT_MS, api, getErrorMessage } from "../services/api";

const severityColors = {
  critical: {
    bg: "bg-rose-500/15",
    text: "text-rose-400",
    border: "border-rose-500/30",
    badge: "bg-rose-600 text-white shadow-rose-900/30",
    glow: "rgba(244, 63, 94, 0.15)",
  },
  high: {
    bg: "bg-amber-500/15",
    text: "text-amber-400",
    border: "border-amber-500/30",
    badge: "bg-amber-600 text-white shadow-amber-900/30",
    glow: "rgba(245, 158, 11, 0.15)",
  },
  medium: {
    bg: "bg-yellow-500/15",
    text: "text-yellow-400",
    border: "border-yellow-500/30",
    badge: "bg-yellow-600 text-white shadow-yellow-900/30",
    glow: "rgba(234, 179, 8, 0.15)",
  },
  low: {
    bg: "bg-blue-500/15",
    text: "text-blue-400",
    border: "border-blue-500/30",
    badge: "bg-blue-600 text-white shadow-blue-900/30",
    glow: "rgba(59, 130, 246, 0.15)",
  },
};

export default function AnalysisPage() {
  const { analysisId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [report, setReport] = useState(null);
  const [allAnalyses, setAllAnalyses] = useState([]);
  const [selectedFindingId, setSelectedFindingId] = useState(null);
  const [suggestions, setSuggestions] = useState({});
  const [editing, setEditing] = useState("");
  const [editedText, setEditedText] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [claimReviewComments, setClaimReviewComments] = useState({});
  const [claimReviewBusy, setClaimReviewBusy] = useState("");
  const actionInProgress = useRef(new Set());

  // Load all analyses if needed or specific analysis
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");

    if (analysisId) {
      api.get(`/api/analysis/${analysisId}`)
        .then(({ data }) => {
          if (active) {
            setReport(data);
            if (data.findings?.length > 0) {
              setSelectedFindingId(data.findings[0].id);
            }
          }
        })
        .catch((err) => {
          if (active) setError(getErrorMessage(err, "Analysis report could not be loaded."));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    } else {
      // No ID specified in URL, fetch list of analyses and load the latest one
      api.get("/api/analysis")
        .then(({ data }) => {
          if (!active) return;
          setAllAnalyses(data || []);
          if (data && data.length > 0) {
            const latest = data[0];
            setReport(latest);
            if (latest.findings?.length > 0) {
              setSelectedFindingId(latest.findings[0].id);
            }
          }
        })
        .catch((err) => {
          if (active) setError(getErrorMessage(err, "Analysis reports could not be loaded."));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }

    return () => {
      active = false;
    };
  }, [analysisId]);

  async function createSuggestion(finding) {
    if (actionInProgress.current.has(finding.id)) return;
    actionInProgress.current.add(finding.id);
    setBusyId(finding.id);
    setError("");
    setSuccess("");
    try {
      const { data } = await api.post(
        `/api/findings/${finding.id}/suggest`,
        undefined,
        { timeout: AI_REQUEST_TIMEOUT_MS }
      );
      setSuggestions((current) => ({ ...current, [finding.id]: data }));
      const sourceMsg =
        data.generation_source === "gemini"
          ? "Gemini generated the suggestion."
          : data.generation_source === "deterministic"
          ? "A rule-based suggestion was used."
          : "Fallback wording was used.";
      setSuccess(`Correction suggestion generated: ${sourceMsg}`);
    } catch (requestError) {
      setError(
        getErrorMessage(requestError, "Suggestion could not be generated.", {
          timeoutMessage: "AI suggestion generation is taking longer than expected. Please check back shortly.",
        })
      );
    } finally {
      actionInProgress.current.delete(finding.id);
      setBusyId("");
    }
  }

  async function decideSuggestion(findingId, suggestion, decision) {
    if (actionInProgress.current.has(findingId)) return;
    actionInProgress.current.add(findingId);
    setBusyId(findingId);
    setError("");
    try {
      const payload = { decision };
      if (decision === "edited") payload.suggested_text = editedText;
      const { data } = await api.post(`/api/suggestions/${suggestion.id}/decision`, payload);
      setSuggestions((current) => ({ ...current, [findingId]: data }));
      setEditing("");
      setSuccess(
        decision === "accepted"
          ? "Suggestion accepted."
          : decision === "rejected"
          ? "Suggestion rejected."
          : "Edited suggestion saved."
      );
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Suggestion decision could not be saved."));
    } finally {
      actionInProgress.current.delete(findingId);
      setBusyId("");
    }
  }

  async function reviewClaim(claim, decision) {
    const comment = claimReviewComments[claim.id]?.trim() || "";
    if (decision !== "approve" && !comment) {
      setError("A comment is required to reject a claim or request additional evidence.");
      return;
    }
    if (actionInProgress.current.has(claim.id)) return;
    actionInProgress.current.add(claim.id);
    setClaimReviewBusy(claim.id);
    setError("");
    setSuccess("");
    try {
      const { data } = await api.post(`/api/evidence/${claim.id}/review`, {
        decision,
        comment: comment || undefined,
      });
      setReport((current) => ({
        ...current,
        claim_verifications: current.claim_verifications.map((item) =>
          item.id === claim.id ? data : item
        ),
      }));
      setClaimReviewComments((current) => ({ ...current, [claim.id]: "" }));
      setSuccess(`Claim review saved as ${data.review_status.replaceAll("_", " ")}.`);
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Claim review decision could not be saved."));
    } finally {
      actionInProgress.current.delete(claim.id);
      setClaimReviewBusy("");
    }
  }

  async function downloadGuideline(finding) {
    if (!finding.guideline_id) return;
    setError("");
    try {
      const { data } = await api.get(`/api/guidelines/${finding.guideline_id}/file`, { responseType: "blob" });
      const objectUrl = URL.createObjectURL(data);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = finding.guideline_title || "BrandGuidelines.pdf";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Original guideline could not be downloaded."));
    }
  }

  function exportMarkdown() {
    if (!report) return;
    const lines = [
      `# BrandGuard AI Analysis Report`,
      `**Submission ID:** ${report.submission_id}`,
      `**Date:** ${new Date(report.created_at).toLocaleString()}`,
      `**Compliance Score:** ${report.compliance_score}/100`,
      `**Formula:** ${report.score_formula}`,
      `**Status:** ${report.analysis_status}`,
      ``,
      `## Key Findings (${report.findings.length})`,
      ``,
    ];

    report.findings.forEach((f, idx) => {
      lines.push(`### ${idx + 1}. [${f.severity.toUpperCase()}] ${f.category.replaceAll("_", " ")}`);
      lines.push(`- **Affected Text:** "${f.affected_text || "N/A"}"`);
      lines.push(`- **Explanation:** ${f.explanation}`);
      lines.push(`- **Confidence:** ${Math.round(f.confidence * 100)}%`);
      lines.push(`- **Evidence Status:** ${f.evidence_status}`);
      if (f.evidence_text) {
        lines.push(`- **Retrieved Guideline:** ${f.guideline_title || "Rule"}`);
        lines.push(`- **Section:** ${f.source_section || "N/A"}, Page: ${f.source_page || "N/A"}`);
        lines.push(`- **Evidence Quote:** "${f.evidence_text}"`);
      }
      lines.push(``);
    });
    if (report.claim_verifications?.length) {
      lines.push(`## Claim Verification`);
      lines.push(``);
      report.claim_verifications.forEach((claim) => {
        lines.push(`- **${claim.status.replaceAll("_", " ")}** (${Math.round(claim.confidence * 100)}%): ${claim.claim_text}`);
        lines.push(`  - ${claim.reason}`);
        if (claim.assessment_rationale && claim.assessment_source_ids?.length) {
          lines.push(`  - Gemini rationale (${claim.assessment_model || "configured model"}): ${claim.assessment_rationale}`);
        }
        claim.evidence?.forEach((source) => {
          if (source.source_url) {
            const relation = claim.assessment_source_ids?.includes(source.id)
              ? source.evidence_relation || "cited"
              : "retrieved";
            lines.push(`  - ${relation} source: ${source.title || source.source_url} — ${source.source_url}`);
          }
        });
      });
      lines.push(``);
    }
    if (report.visual_analyses?.length) {
      lines.push(`## Visual Brand Compliance`);
      lines.push(``);
      report.visual_analyses.forEach((visual) => {
        lines.push(`### ${visual.filename} — ${visual.review_status.replaceAll("_", " ")}`);
        lines.push(visual.summary);
        visual.findings?.forEach((finding) => {
          lines.push(`- **${finding.category.replaceAll("_", " ")}** (${finding.verification_status}, ${Math.round(finding.confidence * 100)}%): ${finding.description}`);
          finding.evidence?.forEach((evidence) => {
            lines.push(`  - Evidence: ${evidence.observation || evidence.method}`);
          });
        });
        lines.push(``);
      });
    }

    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Analysis-Report-${report.id.slice(0, 8)}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportPDF() {
    window.print();
  }

  // Calculate severity breakdown
  const counts = useMemo(() => {
    const res = { critical: 0, high: 0, medium: 0, low: 0 };
    if (!report?.findings) return res;
    for (const f of report.findings) {
      if (res[f.severity] !== undefined) res[f.severity]++;
    }
    return res;
  }, [report]);

  // Selected finding for the right "Guideline Evidence" panel
  const activeFinding = useMemo(() => {
    if (!report?.findings?.length) return null;
    return report.findings.find((f) => f.id === selectedFindingId) || report.findings[0];
  }, [report, selectedFindingId]);

  if (loading) {
    return <Loading label="Loading analysis report & evidence citations..." />;
  }

  if (!report) {
    return (
      <div className="space-y-6">
        <ErrorNotice>{error || "No analysis reports found in this organisation."}</ErrorNotice>
        <div className="rounded-2xl border border-navy-700/60 bg-navy-850 p-12 text-center shadow-xl">
          <BarChart3 size={40} className="mx-auto text-indigo-400 mb-3" />
          <h2 className="text-base font-bold text-white">No Analysis Report Available</h2>
          <p className="mt-1 text-xs text-slate-400 max-w-sm mx-auto">
            Submit a marketing document to generate real-time brand compliance analysis.
          </p>
          <div className="mt-5">
            <Link
              to="/content"
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-900/40 transition"
            >
              Submit Content Now
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const score = report.compliance_score || 0;
  // Circumference for 52 radius: 2 * pi * 52 ≈ 326.73
  const circumference = 326.73;
  const strokeDashoffset = circumference - (circumference * Math.min(Math.max(score, 0), 100)) / 100;
  const scoreColorClass =
    score >= 85 ? "stroke-emerald-400 text-emerald-400" : score >= 60 ? "stroke-amber-400 text-amber-400" : "stroke-rose-400 text-rose-400";

  // Active finding confidence for right mini gauge
  const activeConfidence = activeFinding ? Math.round((activeFinding.confidence || 0) * 100) : 0;
  const miniCircumference = 163.36; // 2 * pi * 26
  const miniOffset = miniCircumference - (miniCircumference * activeConfidence) / 100;

  return (
    <div className="space-y-6">
      {/* ── Top Header ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/30 to-sky-500/20 text-indigo-300 border border-indigo-500/30 shadow-inner">
            <BarChart3 size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Analysis Report</h1>
            <p className="text-xs text-slate-400">
              Detailed compliance analysis with evidence-based guideline verification
            </p>
          </div>
        </div>

        {/* Top-Right Action Buttons: Export PDF, Export Markdown & Report Selector */}
        <div className="flex items-center gap-2.5">
          {allAnalyses.length > 1 && (
            <select
              aria-label="Select report"
              value={report.id}
              onChange={(e) => navigate(`/analysis/${e.target.value}`)}
              className="rounded-xl border border-navy-700 bg-navy-850 px-3 py-2 text-xs text-slate-200 outline-none focus:border-indigo-500"
            >
              {allAnalyses.map((a, i) => (
                <option key={a.id} value={a.id}>
                  Report #{i + 1} ({a.compliance_score}%) — {new Date(a.created_at).toLocaleDateString()}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={exportPDF}
            className="inline-flex items-center gap-2 rounded-xl border border-navy-700 bg-navy-850 hover:bg-navy-800 hover:text-white px-3.5 py-2 text-xs font-semibold text-slate-300 transition shadow-sm"
          >
            <FileDown size={14} className="text-indigo-400" /> Export PDF
          </button>
          <button
            type="button"
            onClick={exportMarkdown}
            className="inline-flex items-center gap-2 rounded-xl border border-navy-700 bg-navy-850 hover:bg-navy-800 hover:text-white px-3.5 py-2 text-xs font-semibold text-slate-300 transition shadow-sm"
          >
            <Download size={14} className="text-sky-400" /> Export Markdown
          </button>
        </div>
      </div>

      <ErrorNotice>{error}</ErrorNotice>
      <SuccessNotice>{success}</SuccessNotice>

      {/* Partial Analysis Warning if AI was unavailable */}
      {report.analysis_status !== "complete" && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 p-4 text-xs text-amber-300 shadow-md">
          <div className="flex items-start gap-3">
            <CircleAlert size={18} className="mt-0.5 shrink-0 text-amber-400" />
            <div>
              <p className="font-bold text-amber-200">Partial Analysis</p>
              <p className="mt-0.5 leading-relaxed text-amber-300/90">
                {report.analysis_note || "AI analysis was unavailable; deterministic checks are presented below."}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── TOP: Compliance Score Hero Section ───────────────────────────── */}
      <div className="rounded-2xl border border-navy-700/60 bg-gradient-to-br from-navy-850 via-[#151E32] to-navy-900 p-6 shadow-xl">
        <div className="grid gap-6 lg:grid-cols-[1.5fr_2fr] items-center">
          {/* Radial Gauge Card */}
          <div className="flex items-center justify-around gap-6 border-b lg:border-b-0 lg:border-r border-navy-750 pb-6 lg:pb-0 lg:pr-6">
            <div className="relative flex h-[120px] w-[120px] shrink-0 items-center justify-center">
              <svg className="h-full w-full -rotate-90 transform" viewBox="0 0 120 120">
                <circle
                  cx="60"
                  cy="60"
                  r="52"
                  className="stroke-navy-800"
                  strokeWidth="8"
                  fill="transparent"
                />
                <circle
                  cx="60"
                  cy="60"
                  r="52"
                  className={`${scoreColorClass} transition-all duration-1000 ease-out`}
                  strokeWidth="8"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                  fill="transparent"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-2xl font-black text-white tracking-tight">{score}%</span>
                <span className="text-[9px] uppercase tracking-wider font-semibold text-slate-400">Score</span>
              </div>
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Governance Index</span>
                <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  report.analysis_status === "complete"
                    ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                    : "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                }`}>
                  {report.analysis_status === "complete" ? "Complete" : "Partial"}
                </span>
              </div>
              <p className={`text-2xl font-black mt-1 ${scoreColorClass.split(" ")[1]}`}>{score}% Compliant</p>
              <p className="text-[11px] text-slate-400 mt-1 leading-snug">
                {report.score_formula || "Based on deterministic & AI rule compliance"}
              </p>
              <p className="text-[10px] text-slate-500 mt-0.5">
                Evaluated: {new Date(report.created_at).toLocaleString()}
              </p>
            </div>
          </div>

          {/* 4 Severity Mini-Cards in a Row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Critical */}
            <div className="rounded-xl border border-rose-500/25 bg-rose-950/15 p-4 shadow-sm flex flex-col justify-between hover:border-rose-500/40 transition">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-rose-400 uppercase tracking-wider">Critical</span>
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-500/20 text-rose-400">
                  <AlertTriangle size={14} />
                </div>
              </div>
              <p className="text-2xl font-black text-white mt-3">{counts.critical}</p>
              <p className="text-[10px] text-rose-300/70 mt-0.5">Immediate fix</p>
            </div>

            {/* High */}
            <div className="rounded-xl border border-amber-500/25 bg-amber-950/15 p-4 shadow-sm flex flex-col justify-between hover:border-amber-500/40 transition">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wider">High</span>
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/20 text-amber-400">
                  <AlertTriangle size={14} />
                </div>
              </div>
              <p className="text-2xl font-black text-white mt-3">{counts.high}</p>
              <p className="text-[10px] text-amber-300/70 mt-0.5">Requires review</p>
            </div>

            {/* Medium */}
            <div className="rounded-xl border border-yellow-500/25 bg-yellow-950/15 p-4 shadow-sm flex flex-col justify-between hover:border-yellow-500/40 transition">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-yellow-400 uppercase tracking-wider">Medium</span>
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-yellow-500/20 text-yellow-400">
                  <AlertTriangle size={14} />
                </div>
              </div>
              <p className="text-2xl font-black text-white mt-3">{counts.medium}</p>
              <p className="text-[10px] text-yellow-300/70 mt-0.5">Recommended</p>
            </div>

            {/* Low */}
            <div className="rounded-xl border border-blue-500/25 bg-blue-950/15 p-4 shadow-sm flex flex-col justify-between hover:border-blue-500/40 transition">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-blue-400 uppercase tracking-wider">Low</span>
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/20 text-blue-400">
                  <Info size={14} />
                </div>
              </div>
              <p className="text-2xl font-black text-white mt-3">{counts.low}</p>
              <p className="text-[10px] text-blue-300/70 mt-0.5">Advisory notes</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── MAIN BODY: Two Columns (55% Left, 45% Right) ─────────────────── */}
      <div className="grid gap-6 lg:grid-cols-[1.22fr_1fr] items-start">
        {/* LEFT COLUMN: Key Findings, Claim Verification & Visual Analyses */}
        <div className="space-y-6 min-w-0">
          {/* Key Findings Card */}
          <div className="rounded-2xl border border-navy-700/60 bg-navy-850 p-6 shadow-xl">
            <div className="flex items-center justify-between pb-4 border-b border-navy-750">
              <div className="flex items-center gap-2.5">
                <h2 className="text-sm font-bold text-white tracking-wide">Key Findings</h2>
                <span className="rounded-full bg-indigo-500/10 border border-indigo-500/30 px-2 py-0.5 text-[10px] font-bold text-indigo-300">
                  {report.findings?.length || 0}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Select a finding to inspect source evidence</p>
            </div>

            <div className="mt-4 space-y-3.5">
              {!report.findings?.length ? (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-8 text-center">
                  <CheckCircle2 size={32} className="mx-auto text-emerald-400 mb-2" />
                  <p className="text-sm font-bold text-emerald-300">No compliance findings detected</p>
                  <p className="text-xs text-slate-400 mt-1">This marketing submission complies fully with all active approved rules.</p>
                </div>
              ) : (
                report.findings.map((finding) => {
                  const isSelected = activeFinding?.id === finding.id;
                  const severityStyle = severityColors[finding.severity] || severityColors.low;
                  const suggestion = suggestions[finding.id];
                  const isEditingThis = editing === finding.id;

                  return (
                    <div
                      key={finding.id}
                      onClick={() => setSelectedFindingId(finding.id)}
                      className={`group cursor-pointer rounded-xl border p-5 transition-all relative overflow-hidden ${
                        isSelected
                          ? "border-indigo-500/70 bg-navy-800/90 shadow-lg border-l-4 border-l-indigo-400"
                          : "border-navy-750 bg-navy-900/60 hover:border-navy-700 hover:bg-navy-900/80"
                      }`}
                    >
                      {/* Top Row: Severity badge, Category, and Action buttons */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${severityStyle.badge}`}>
                            {finding.severity}
                          </span>
                          <h3 className="text-xs font-bold text-white capitalize">
                            {finding.category.replaceAll("_", " ")}
                          </h3>
                        </div>

                        <div className="flex items-center gap-2">
                          {finding.source_page && (
                            <span className="rounded-lg bg-navy-800 border border-navy-700 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
                              Page {finding.source_page}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedFindingId(finding.id);
                            }}
                            className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                              isSelected
                                ? "bg-indigo-600 text-white"
                                : "bg-navy-800 border border-navy-700 text-slate-300 group-hover:border-indigo-500/40"
                            }`}
                          >
                            View Evidence →
                          </button>
                        </div>
                      </div>

                      {/* Explanation */}
                      <p className="mt-3 text-xs text-slate-300 leading-relaxed">
                        {finding.explanation}
                      </p>

                      {/* Affected Text Quote */}
                      {finding.affected_text && (
                        <div className="mt-3 rounded-lg bg-navy-950/80 border border-navy-800 p-3 text-[11px] leading-relaxed">
                          <span className="text-slate-500 font-semibold block mb-1">Flagged Text:</span>
                          <span className="text-amber-200/90 font-mono italic">"{finding.affected_text}"</span>
                        </div>
                      )}

                      {/* Card Footer: AI Suggestion trigger & confidence */}
                      <div className="mt-3.5 pt-3 border-t border-navy-750 flex flex-wrap items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            createSuggestion(finding);
                          }}
                          disabled={busyId === finding.id}
                          className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-400 hover:text-indigo-300 transition"
                        >
                          {busyId === finding.id ? (
                            <LoaderCircle size={14} className="animate-spin" />
                          ) : (
                            <Sparkles size={14} />
                          )}
                          {suggestion ? "Regenerate AI Suggestion" : "Generate AI Suggestion"}
                        </button>
                        <span className="text-[10px] font-semibold text-slate-400">
                          Confidence: {Math.round(finding.confidence * 100)}%
                        </span>
                      </div>

                      {/* Render Suggestion Box */}
                      {suggestion && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="mt-3.5 rounded-xl border border-indigo-500/40 bg-indigo-950/30 p-4 text-xs shadow-inner"
                        >
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <span className="font-bold text-indigo-300 flex items-center gap-1.5">
                              <Sparkles size={13} className="text-indigo-400" /> Suggested Correction:
                            </span>
                            <span className="text-[10px] text-indigo-300/70 capitalize">
                              Source: {suggestion.generation_source || "AI"}
                            </span>
                          </div>

                          {isEditingThis ? (
                            <div className="space-y-2">
                              <textarea
                                value={editedText}
                                onChange={(e) => setEditedText(e.target.value)}
                                rows={3}
                                className="w-full rounded-lg border border-indigo-500/50 bg-navy-900 p-2 text-xs text-white outline-none focus:ring-1 focus:ring-indigo-400"
                              />
                              <div className="flex gap-2 justify-end">
                                <button
                                  type="button"
                                  onClick={() => setEditing("")}
                                  className="rounded-lg border border-navy-700 bg-navy-800 px-2.5 py-1 text-[11px] font-semibold text-slate-300"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={() => decideSuggestion(finding.id, suggestion, "edited")}
                                  className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-1 text-[11px] font-bold text-white"
                                >
                                  Save &amp; Accept
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <p className="text-slate-200 font-medium leading-relaxed bg-navy-950/60 rounded-lg p-2.5 border border-indigo-500/20">
                                {suggestion.suggested_text}
                              </p>
                              <div className="mt-3 flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => decideSuggestion(finding.id, suggestion, "accepted")}
                                  disabled={busyId === finding.id}
                                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-[11px] font-bold text-white shadow-sm"
                                >
                                  <Check size={12} /> Accept
                                </button>
                                <button
                                  type="button"
                                  onClick={() => decideSuggestion(finding.id, suggestion, "rejected")}
                                  disabled={busyId === finding.id}
                                  className="inline-flex items-center gap-1 rounded-lg bg-rose-600 hover:bg-rose-500 px-3 py-1.5 text-[11px] font-bold text-white shadow-sm"
                                >
                                  <X size={12} /> Reject
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditing(finding.id);
                                    setEditedText(suggestion.suggested_text);
                                  }}
                                  className="inline-flex items-center gap-1 rounded-lg border border-navy-700 bg-navy-800 hover:bg-navy-750 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300"
                                >
                                  <Pencil size={11} /> Edit wording
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* CLAIM VERIFICATION section */}
          {report.claim_verifications?.length > 0 && (
            <section className="rounded-2xl border border-navy-700/60 bg-navy-850 p-6 shadow-xl">
              <div className="flex items-center justify-between border-b border-navy-750 pb-4">
                <div>
                  <h2 className="text-sm font-bold text-white">Evidence-based Claim Verification</h2>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Approved internal rules remain in force; external sources provide empirical validation.
                  </p>
                </div>
                <span className="rounded-full bg-sky-500/10 border border-sky-500/30 px-2.5 py-0.5 text-[10px] font-bold text-sky-300">
                  {report.claim_verifications.length} Claims
                </span>
              </div>

              <div className="mt-4 space-y-4">
                {report.claim_verifications.map((claim) => (
                  <article key={claim.id} className="rounded-xl border border-navy-750 bg-navy-900/70 p-5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-xs font-bold text-slate-100 flex-1 min-w-[200px]">"{claim.claim_text}"</h3>
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                        claim.status === "supported"
                          ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                          : claim.status === "contradicted"
                          ? "bg-rose-500/15 text-rose-300 border border-rose-500/30"
                          : "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                      }`}>
                        {claim.status.replaceAll("_", " ")} · {Math.round(claim.confidence * 100)}%
                      </span>
                    </div>

                    <p className="text-xs leading-relaxed text-slate-300">{claim.reason}</p>

                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-400">
                      <span>Claim type: <strong className="text-slate-300 capitalize">{claim.claim_type?.replaceAll("_", " ") || "Objective factual"}</strong></span>
                      {claim.time_sensitive && <span className="text-amber-300 font-semibold">· Time-sensitive evidence</span>}
                      <span>· Decision: <strong className="text-cyan-300 capitalize">{claim.review_status?.replaceAll("_", " ") || "Pending"}</strong></span>
                      {claim.assessment_model && <span>· Evaluator: Gemini {claim.assessment_model}</span>}
                    </div>

                    {/* Gemini Rationale Box */}
                    {claim.assessment_rationale && claim.assessment_source_ids?.length > 0 && (
                      <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/25 p-3.5">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-300 mb-1">
                          Gemini Rationale · Cited Retrieved Sources
                        </p>
                        <p className="text-xs leading-relaxed text-slate-200">
                          {claim.assessment_rationale}
                        </p>
                      </div>
                    )}

                    {/* Evidence List */}
                    {claim.evidence?.length > 0 && (
                      <div className="border-t border-navy-800 pt-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Sources &amp; Evidence Citations</p>
                        <ul className="space-y-2">
                          {claim.evidence.map((source, index) => (
                            <li key={`${claim.id}-${source.id || index}`} className="rounded-lg bg-navy-950/60 border border-navy-800 p-2.5 text-[11px] text-slate-300">
                              <div className="flex flex-wrap items-center justify-between gap-1.5">
                                <span className="font-semibold text-slate-200">
                                  {source.title || source.source_type || "Rule Source"}
                                </span>
                                {source.credibility_score != null && (
                                  <span className="text-[10px] text-slate-400">
                                    Credibility: {Math.round(source.credibility_score * 100)}%
                                  </span>
                                )}
                              </div>
                              {source.source_url && (
                                <a
                                  href={source.source_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-1 inline-flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300 underline underline-offset-2 break-all"
                                >
                                  {source.source_url} <ExternalLink size={10} />
                                </a>
                              )}
                              {source.text && (
                                <p className="mt-1.5 text-[10px] text-slate-400 line-clamp-3 italic">
                                  "{source.text}"
                                </p>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Review Section */}
                    {["admin", "brand_manager", "reviewer"].includes(user?.role) && (
                      <div className="border-t border-navy-800 pt-3 space-y-2">
                        <label className="block text-[10px] font-semibold text-slate-400" htmlFor={`claim-review-${claim.id}`}>
                          Reviewer Decision Comment
                        </label>
                        <input
                          id={`claim-review-${claim.id}`}
                          value={claimReviewComments[claim.id] || ""}
                          onChange={(e) => setClaimReviewComments((cur) => ({ ...cur, [claim.id]: e.target.value }))}
                          maxLength={2000}
                          className="form-input text-xs"
                          placeholder="Explain decision (required for reject or additional evidence)"
                        />
                        <div className="flex flex-wrap gap-2 pt-1">
                          {[
                            ["approve", "Approve Result", "bg-emerald-600 hover:bg-emerald-500 text-white"],
                            ["reject", "Reject Result", "bg-rose-600 hover:bg-rose-500 text-white"],
                            ["request_additional_evidence", "Request Evidence", "border border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"],
                          ].map(([dec, label, cls]) => (
                            <button
                              key={dec}
                              type="button"
                              onClick={() => reviewClaim(claim, dec)}
                              disabled={claimReviewBusy === claim.id}
                              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${cls}`}
                            >
                              {claimReviewBusy === claim.id ? <LoaderCircle size={12} className="animate-spin inline mr-1" /> : null}
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Decision History */}
                    {claim.review_history?.length > 0 && (
                      <div className="border-t border-navy-800 pt-2 space-y-1">
                        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Review History</p>
                        {claim.review_history.map((entry, idx) => (
                          <p key={`${entry.created_at}-${idx}`} className="text-[10px] text-slate-500">
                            <span className="text-slate-400 font-semibold capitalize">{entry.decision.replaceAll("_", " ")}</span> by {entry.reviewer_name} · {new Date(entry.created_at).toLocaleString()}
                            {entry.comment ? ` · "${entry.comment}"` : ""}
                          </p>
                        ))}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>
          )}

          {/* VISUAL ANALYSES section */}
          {report.visual_analyses?.length > 0 && (
            <section className="rounded-2xl border border-cyan-500/30 bg-navy-850 p-6 shadow-xl">
              <div className="border-b border-navy-750 pb-4">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-white">Visual Brand Compliance</h2>
                  <span className="rounded-full bg-cyan-500/10 border border-cyan-500/30 px-2 py-0.5 text-[10px] font-bold text-cyan-300">
                    {report.visual_analyses.length} Visual Assets
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  Visual observations are reviewed independently of the text compliance score.
                </p>
              </div>

              <div className="mt-4 space-y-4">
                {report.visual_analyses.map((visual) => (
                  <article key={visual.analysis_id} className="rounded-xl border border-navy-750 bg-navy-900/70 p-5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-xs font-bold text-white">{visual.filename}</h3>
                      <span className="rounded-full bg-cyan-500/10 border border-cyan-500/30 px-2.5 py-0.5 text-[10px] font-bold text-cyan-300 capitalize">
                        {visual.review_status?.replaceAll("_", " ") || "Pending"}
                      </span>
                    </div>

                    <p className="text-xs text-slate-300 leading-relaxed">{visual.summary}</p>

                    <div className="flex flex-wrap gap-2 text-[10px]">
                      <span className="rounded-md bg-navy-950 px-2 py-1 text-slate-400 border border-navy-800">
                        OCR: <strong className="text-slate-200">{visual.provider_status?.ocr || "unavailable"}</strong>
                      </span>
                      <span className="rounded-md bg-navy-950 px-2 py-1 text-slate-400 border border-navy-800">
                        Vision: <strong className="text-slate-200">{visual.provider_status?.vision || "unavailable"}</strong>
                      </span>
                    </div>

                    {/* Visual Findings */}
                    <div className="space-y-2 pt-2">
                      {visual.findings?.length ? (
                        visual.findings.map((finding) => (
                          <div key={finding.id} className="rounded-lg border border-navy-700 bg-navy-950/70 p-3 text-xs">
                            <div className="flex justify-between items-center mb-1">
                              <span className="font-bold text-white capitalize">{finding.category.replaceAll("_", " ")}</span>
                              <span className="text-[10px] font-semibold text-amber-300">
                                {finding.verification_status} · {Math.round(finding.confidence * 100)}%
                              </span>
                            </div>
                            <p className="text-slate-300 text-[11px]">{finding.description}</p>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-emerald-300">No visual findings crossed the review thresholds.</p>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* RIGHT COLUMN: Sticky Evidence Panel */}
        <div className="sticky top-6 rounded-2xl border border-navy-700/60 bg-navy-850 p-6 shadow-xl flex flex-col justify-between space-y-6">
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-navy-750">
              <h2 className="text-sm font-bold text-white tracking-wide">Finding Evidence</h2>
              <span className="rounded-full bg-indigo-500/10 border border-indigo-500/30 px-2.5 py-0.5 text-[10px] font-bold text-indigo-300 uppercase tracking-wider">
                Audit Trail
              </span>
            </div>

            {activeFinding ? (
              <div className="mt-5 space-y-5">
                {/* Guideline Title Card */}
                {activeFinding.guideline_id ? (
                  <div className="rounded-xl border border-indigo-500/30 bg-gradient-to-br from-indigo-950/30 to-navy-900 p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
                        <FileText size={20} />
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate font-bold text-white text-xs" title={activeFinding.guideline_title || "Linked guideline"}>
                          {activeFinding.guideline_title || "Linked guideline"}
                        </h3>
                        {(activeFinding.source_section || activeFinding.source_page) && (
                          <p className="text-[11px] text-indigo-300 mt-0.5 font-medium">
                            {activeFinding.source_section || ""}
                            {activeFinding.source_section && activeFinding.source_page ? " · " : ""}
                            {activeFinding.source_page ? `Page ${activeFinding.source_page}` : ""}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-amber-500/25 bg-amber-950/15 p-4 text-[11px] text-amber-200">
                    No linked guideline citation is directly attached to this finding.
                  </div>
                )}

                {/* Evidence Quote Block */}
                {activeFinding.evidence_text ? (
                  <div className="rounded-xl border border-navy-750 bg-navy-900/80 p-4 relative overflow-hidden">
                    <div className="flex items-center gap-2 mb-2 text-indigo-400">
                      <MessageSquareQuote size={16} />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Evidence Quote</span>
                    </div>
                    <blockquote className="text-xs italic text-slate-200 leading-relaxed border-l-2 border-indigo-500/50 pl-3">
                      "{activeFinding.evidence_text}"
                    </blockquote>
                  </div>
                ) : (
                  <div className="rounded-xl border border-navy-750 bg-navy-900/80 p-4 text-[11px] text-slate-400">
                    No explicit guideline excerpt was recorded for this finding.
                  </div>
                )}

                {/* Mini Radial Gauge for Confidence & Metadata */}
                <div className="rounded-xl border border-navy-750 bg-navy-900/60 p-4 flex items-center justify-between gap-4">
                  <div className="relative flex h-16 w-16 shrink-0 items-center justify-center">
                    <svg className="h-full w-full -rotate-90 transform" viewBox="0 0 64 64">
                      <circle
                        cx="32"
                        cy="32"
                        r="26"
                        className="stroke-navy-800"
                        strokeWidth="5"
                        fill="transparent"
                      />
                      <circle
                        cx="32"
                        cy="32"
                        r="26"
                        className="stroke-indigo-400 transition-all duration-700 ease-out"
                        strokeWidth="5"
                        strokeDasharray={miniCircumference}
                        strokeDashoffset={miniOffset}
                        strokeLinecap="round"
                        fill="transparent"
                      />
                    </svg>
                    <span className="absolute text-xs font-bold text-white">{activeConfidence}%</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">AI Confidence</p>
                    <p className="text-xs font-bold text-white mt-0.5">
                      {activeConfidence >= 80 ? "High certainty" : activeConfidence >= 50 ? "Moderate certainty" : "Low certainty"}
                    </p>
                    <p className="text-[10px] text-slate-500 mt-0.5">Verified across approved vectors</p>
                  </div>
                </div>

                {/* Supporting Citations & Metadata Rows */}
                <div className="space-y-2 pt-1 text-xs">
                  <div className="flex justify-between py-2 border-b border-navy-800">
                    <span className="text-slate-400 text-[11px]">Evidence Status</span>
                    <span
                      className={`font-bold capitalize text-[11px] ${
                        activeFinding.evidence_status === "supported"
                          ? "text-emerald-400"
                          : activeFinding.evidence_status === "contradicted"
                            ? "text-rose-400"
                            : "text-amber-300"
                      }`}
                    >
                      {activeFinding.evidence_status.replaceAll("_", " ")}
                    </span>
                  </div>
                  {activeFinding.source_section && (
                    <div className="flex justify-between py-2 border-b border-navy-800">
                      <span className="text-slate-400 text-[11px]">Source Section</span>
                      <span className="text-slate-200 text-[11px] font-semibold">{activeFinding.source_section}</span>
                    </div>
                  )}
                  {activeFinding.source_page && (
                    <div className="flex justify-between py-2 border-b border-navy-800">
                      <span className="text-slate-400 text-[11px]">Source Page</span>
                      <span className="text-slate-200 text-[11px] font-semibold">Page {activeFinding.source_page}</span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="py-16 text-center text-xs text-slate-400">
                <FileText size={28} className="mx-auto text-slate-600 mb-2" />
                Select any finding from the list on the left to inspect linked evidence citations.
              </div>
            )}
          </div>

          {/* Download Guideline Button */}
          {activeFinding?.guideline_id && (
            <div className="pt-4 border-t border-navy-750">
              <button
                type="button"
                onClick={() => downloadGuideline(activeFinding)}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-900/30 transition"
              >
                <ArrowDownToLine size={15} /> Download Original Source PDF
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
