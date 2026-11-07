import { useEffect, useRef, useState, useMemo } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  Download,
  FileCode,
  FileDown,
  FileText,
  Info,
  Pencil,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button, Card, EmptyState, ErrorNotice, Loading, SuccessNotice } from "../components/Feedback";
import { AI_REQUEST_TIMEOUT_MS, api, getErrorMessage } from "../services/api";

const severityColors = {
  critical: { bg: "bg-rose-500/15", text: "text-rose-400", border: "border-rose-500/30", badge: "bg-rose-600 text-white" },
  high: { bg: "bg-amber-500/15", text: "text-amber-400", border: "border-amber-500/30", badge: "bg-amber-600 text-white" },
  medium: { bg: "bg-yellow-500/15", text: "text-yellow-400", border: "border-yellow-500/30", badge: "bg-yellow-600 text-white" },
  low: { bg: "bg-blue-500/15", text: "text-blue-400", border: "border-blue-500/30", badge: "bg-blue-600 text-white" },
};

export default function AnalysisPage() {
  const { analysisId } = useParams();
  const navigate = useNavigate();
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
          <BarChart3 size={36} className="mx-auto text-blue-400 mb-3" />
          <h2 className="text-base font-bold text-white">No Analysis Report Available</h2>
          <p className="mt-1 text-xs text-slate-400 max-w-sm mx-auto">
            Submit a marketing document to generate real-time brand compliance analysis.
          </p>
          <div className="mt-5">
            <Link
              to="/content"
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 px-4 py-2 text-xs font-bold text-white shadow-lg transition"
            >
              Submit Content Now
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const score = report.compliance_score || 0;
  // Circumference for 45 radius: 2 * pi * 45 ≈ 282.74
  const strokeDashoffset = 282.74 - (282.74 * score) / 100;

  return (
    <div className="space-y-6">
      {/* Top Header matching Reference Image Screen 4 */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30 shadow-inner">
            <BarChart3 size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Analysis Report</h1>
            <p className="text-xs text-slate-400">
              Detailed analysis with evidence-based findings
            </p>
          </div>
        </div>

        {/* Top-Right Action Buttons: Export PDF & Export Markdown */}
        <div className="flex items-center gap-2.5">
          {allAnalyses.length > 1 && (
            <select
              aria-label="Select report"
              value={report.id}
              onChange={(e) => navigate(`/analysis/${e.target.value}`)}
              className="rounded-xl border border-navy-700 bg-navy-850 px-3 py-1.5 text-xs text-slate-200 outline-none"
            >
              {allAnalyses.map((a, i) => (
                <option key={a.id} value={a.id}>
                  Report #{i + 1} ({a.compliance_score}%)
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={exportPDF}
            className="inline-flex items-center gap-2 rounded-xl border border-navy-700 bg-navy-850 hover:bg-navy-800 hover:text-white px-3.5 py-2 text-xs font-semibold text-slate-300 transition shadow-sm"
          >
            <FileDown size={14} /> Export PDF
          </button>
          <button
            type="button"
            onClick={exportMarkdown}
            className="inline-flex items-center gap-2 rounded-xl border border-navy-700 bg-navy-850 hover:bg-navy-800 hover:text-white px-3.5 py-2 text-xs font-semibold text-slate-300 transition shadow-sm"
          >
            <Download size={14} /> Export Markdown
          </button>
        </div>
      </div>

      <ErrorNotice>{error}</ErrorNotice>
      <SuccessNotice>{success}</SuccessNotice>

      {/* Partial Analysis Warning if AI was unavailable */}
      {report.analysis_status !== "complete" && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 p-3.5 text-xs text-amber-300">
          <div className="flex items-start gap-2.5">
            <CircleAlert size={16} className="mt-0.5 shrink-0 text-amber-400" />
            <div>
              <p className="font-semibold text-amber-200">Partial Analysis</p>
              <p className="mt-0.5 leading-relaxed text-amber-300/90">
                {report.analysis_note || "AI analysis was unavailable; deterministic checks are presented below."}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Top Stats Row matching Reference Image Screen 4 */}
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        {/* Compliance Score Gauge Card (Spans 2 columns on lg) */}
        <div className="col-span-2 rounded-2xl border border-navy-700/60 bg-navy-850 p-4 shadow-xl flex items-center justify-around gap-4">
          <div className="relative flex h-24 w-24 shrink-0 items-center justify-center">
            <svg className="h-full w-full -rotate-90 transform" viewBox="0 0 100 100">
              <circle
                cx="50"
                cy="50"
                r="45"
                className="stroke-navy-750"
                strokeWidth="7"
                fill="transparent"
              />
              <circle
                cx="50"
                cy="50"
                r="45"
                className="stroke-emerald-400 transition-all duration-1000 ease-out"
                strokeWidth="7"
                strokeDasharray={282.74}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                fill="transparent"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-xl font-bold text-white tracking-tight">{score}%</span>
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Compliance Score</p>
            <p className="text-lg font-bold text-emerald-400 mt-0.5">{score}%</p>
            <p className="text-[10px] text-slate-400 mt-1">(Internal Heuristic)</p>
          </div>
        </div>

        {/* Mini Severity Card: Critical */}
        <div className="rounded-2xl border border-navy-700/60 bg-navy-850 p-4 shadow-xl flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 text-rose-400 border border-rose-500/30">
            <AlertTriangle size={18} />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-rose-400">Critical</p>
            <p className="text-xl font-bold text-white">{counts.critical}</p>
          </div>
        </div>

        {/* Mini Severity Card: High */}
        <div className="rounded-2xl border border-navy-700/60 bg-navy-850 p-4 shadow-xl flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30">
            <AlertTriangle size={18} />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-amber-400">High</p>
            <p className="text-xl font-bold text-white">{counts.high}</p>
          </div>
        </div>

        {/* Mini Severity Card: Medium */}
        <div className="rounded-2xl border border-navy-700/60 bg-navy-850 p-4 shadow-xl flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-yellow-500/15 text-yellow-400 border border-yellow-500/30">
            <AlertTriangle size={18} />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-yellow-400">Medium</p>
            <p className="text-xl font-bold text-white">{counts.medium}</p>
          </div>
        </div>

        {/* Mini Severity Card: Low */}
        <div className="rounded-2xl border border-navy-700/60 bg-navy-850 p-4 shadow-xl flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 text-blue-400 border border-blue-500/30">
            <Info size={18} />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-blue-400">Low</p>
            <p className="text-xl font-bold text-white">{counts.low}</p>
          </div>
        </div>
      </div>

      {/* Main Bottom Section: Key Findings (Left) & Guideline Evidence (Right) */}
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        {/* Left: Key Findings List matching Reference Image Screen 4 */}
        <div className="rounded-2xl border border-navy-700/60 bg-navy-850 p-5 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-navy-750">
              <h2 className="text-sm font-bold text-white tracking-wide">Key Findings</h2>
              <span className="text-xs text-blue-400 font-semibold cursor-pointer">
                View all →
              </span>
            </div>

            <div className="mt-4 space-y-3.5">
              {report.findings?.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-400">
                  <CheckCircle2 size={24} className="mx-auto text-emerald-400 mb-2" />
                  No compliance findings detected.
                </div>
              ) : (
                report.findings.map((finding) => {
                  const isSelected = activeFinding?.id === finding.id;
                  const severityStyle = severityColors[finding.severity] || severityColors.low;
                  const suggestion = suggestions[finding.id];

                  return (
                    <div
                      key={finding.id}
                      onClick={() => setSelectedFindingId(finding.id)}
                      className={`cursor-pointer rounded-xl border p-4 transition-all ${
                        isSelected
                          ? "border-blue-500/60 bg-navy-800/90 shadow-md"
                          : "border-navy-750 bg-navy-900/60 hover:border-navy-700"
                      }`}
                    >
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
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedFindingId(finding.id);
                            }}
                            className="rounded-lg bg-blue-600 hover:bg-blue-500 px-3 py-1 text-[11px] font-semibold text-white shadow-sm transition"
                          >
                            View Evidence
                          </button>
                          {finding.source_page && (
                            <span className="rounded-lg bg-navy-800 border border-navy-700 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
                              Page {finding.source_page}
                            </span>
                          )}
                        </div>
                      </div>

                      <p className="mt-2.5 text-xs text-slate-300 leading-relaxed">
                        {finding.explanation}
                      </p>

                      {finding.affected_text && (
                        <div className="mt-2 rounded-lg bg-navy-950/70 border border-navy-800 p-2 text-[11px] text-slate-400">
                          <span className="text-slate-500 font-medium">Flagged text: </span>
                          <span className="text-slate-200">"{finding.affected_text}"</span>
                        </div>
                      )}

                      {/* AI Suggestion Section if active */}
                      <div className="mt-3 pt-2.5 border-t border-navy-750 flex flex-wrap items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            createSuggestion(finding);
                          }}
                          disabled={busyId === finding.id}
                          className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-blue-400 hover:text-blue-300"
                        >
                          <Sparkles size={13} />
                          {suggestion ? "Regenerate Suggestion" : "Generate AI Suggestion"}
                        </button>
                        <span className="text-[10px] text-slate-500">
                          Confidence: {Math.round(finding.confidence * 100)}%
                        </span>
                      </div>

                      {/* Render Suggestion Box */}
                      {suggestion && (
                        <div className="mt-3 rounded-xl border border-blue-500/30 bg-blue-950/20 p-3 text-xs">
                          <p className="font-semibold text-blue-300 mb-1">Suggested Correction:</p>
                          <p className="text-slate-200 font-medium">{suggestion.suggested_text}</p>
                          <div className="mt-2.5 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                decideSuggestion(finding.id, suggestion, "accepted");
                              }}
                              className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-2.5 py-1 text-[10px] font-bold text-white"
                            >
                              Accept
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                decideSuggestion(finding.id, suggestion, "rejected");
                              }}
                              className="rounded-lg bg-rose-600 hover:bg-rose-500 px-2.5 py-1 text-[10px] font-bold text-white"
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Right: Guideline Evidence Card matching Reference Image Screen 4 */}
        <div className="rounded-2xl border border-navy-700/60 bg-navy-850 p-6 shadow-xl flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-bold text-white tracking-wide pb-4 border-b border-navy-750">
              Guideline Evidence
            </h2>

            {activeFinding ? (
              <div className="mt-5 space-y-4">
                {/* Blue document card */}
                <div className="rounded-xl border border-blue-500/30 bg-blue-950/25 p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600/30 text-blue-400 border border-blue-500/40">
                      <FileText size={20} />
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate font-bold text-white text-xs">
                        {activeFinding.guideline_title || "Brand Guidelines v2.1"}
                      </h3>
                      <p className="text-[11px] text-blue-300 mt-0.5">
                        {activeFinding.source_section || "Section 3.2 - Claims"}
                        {activeFinding.source_page ? ` · Page ${activeFinding.source_page}` : " · Page 2"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Evidence Quote Box */}
                <div className="rounded-xl border border-navy-750 bg-navy-900/80 p-4">
                  <p className="text-xs italic text-slate-300 leading-relaxed">
                    "{activeFinding.evidence_text || 'Avoid making unsubstantiated superlative claims. All claims referencing industry performance must be backed by verifiable data.'}"
                  </p>
                </div>

                <div className="space-y-2 pt-2 text-[11px] text-slate-400">
                  <div className="flex justify-between py-1 border-b border-navy-800">
                    <span>Evidence Status</span>
                    <span className="font-semibold text-emerald-400 capitalize">{activeFinding.evidence_status}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-navy-800">
                    <span>Source Section</span>
                    <span className="text-slate-300">{activeFinding.source_section || "Approved Standard"}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-12 text-center text-xs text-slate-400">
                Select a finding on the left to view verified guideline citations.
              </div>
            )}
          </div>

          {activeFinding?.guideline_id && (
            <div className="mt-6 pt-4 border-t border-navy-750">
              <button
                type="button"
                onClick={() => downloadGuideline(activeFinding)}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-navy-700 bg-navy-800 hover:bg-navy-750 py-2.5 text-xs font-semibold text-slate-200 transition"
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
