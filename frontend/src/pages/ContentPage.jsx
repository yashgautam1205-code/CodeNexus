import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Eye,
  FileCode,
  FileEdit,
  FileSpreadsheet,
  FileText,
  FileUp,
  ImagePlus,
  LoaderCircle,
  Play,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Upload,
  UploadCloud,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { EmptyState, ErrorNotice, Loading, SuccessNotice } from "../components/Feedback";
import { AI_REQUEST_TIMEOUT_MS, api, getErrorMessage } from "../services/api";
import { useAuth } from "../context/AuthContext";

// ─── small shared helpers ─────────────────────────────────────────────────────

function FilePill({ ext }) {
  const map = {
    pdf: "bg-rose-500/20 text-rose-300 border-rose-500/30",
    docx: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    txt: "bg-sky-500/20 text-sky-300 border-sky-500/30",
  };
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${map[ext] || "bg-slate-700 text-slate-300 border-slate-600"}`}>
      {ext}
    </span>
  );
}

function ReviewStatusBadge({ status }) {
  const map = {
    pending: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    approved: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    rejected: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    request_revision: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  };
  const label = (status || "pending").replaceAll("_", " ");
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold capitalize ${map[status] || map.pending}`}>
      {label}
    </span>
  );
}

function ConfidenceBar({ value }) {
  const pct = Math.round((value || 0) * 100);
  const color = pct >= 80 ? "from-emerald-500 to-emerald-400" : pct >= 50 ? "from-amber-500 to-amber-400" : "from-rose-500 to-rose-400";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-navy-800">
        <div className={`h-full rounded-full bg-gradient-to-r ${color} transition-all duration-700`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right text-[10px] font-semibold text-slate-400">{pct}%</span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ContentPage() {
  const { user } = useAuth();

  // ── State ──────────────────────────────────────────────────────────────────
  const [submissions, setSubmissions] = useState([]);
  const [analyses, setAnalyses] = useState([]);
  const [brandAssets, setBrandAssets] = useState([]);
  const [visualFile, setVisualFile] = useState(null);
  const [visualAssetKind, setVisualAssetKind] = useState("creative");
  const [logoRequired, setLogoRequired] = useState(false);
  const [visualPreviewUrl, setVisualPreviewUrl] = useState("");
  const [visualSubmissionId, setVisualSubmissionId] = useState("");
  const [visualReport, setVisualReport] = useState(null);
  const [visualReviewComment, setVisualReviewComment] = useState("");
  const [visualBusy, setVisualBusy] = useState("");
  const [file, setFile] = useState(null);
  const [activeTab, setActiveTab] = useState("file"); // "file" | "text"
  const [pageTab, setPageTab] = useState("content"); // "content" | "visual"
  const [textTitle, setTextTitle] = useState("");
  const [textContent, setTextContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [analyzingId, setAnalyzingId] = useState("");
  const [visualDragOver, setVisualDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const visualInputRef = useRef(null);
  const actionInProgress = useRef(false);

  // ── Visual preview URL lifecycle ───────────────────────────────────────────
  useEffect(() => {
    if (!visualFile) { setVisualPreviewUrl(""); return undefined; }
    const previewUrl = URL.createObjectURL(visualFile);
    setVisualPreviewUrl(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [visualFile]);

  // ── Data loader ────────────────────────────────────────────────────────────
  async function load() {
    try {
      const [submissionResponse, analysisResponse, assetResponse] = await Promise.all([
        api.get("/api/content"),
        api.get("/api/analysis"),
        api.get("/api/brand-assets"),
      ]);
      setSubmissions(submissionResponse.data);
      setAnalyses(analysisResponse.data);
      setBrandAssets(assetResponse.data);
      setError("");
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Submission history could not be loaded."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // ── Computed ───────────────────────────────────────────────────────────────
  const latestAnalysis = new Map();
  for (const analysis of analyses) {
    if (!latestAnalysis.has(analysis.submission_id)) {
      latestAnalysis.set(analysis.submission_id, analysis);
    }
  }

  // ── Upload / analyze logic ─────────────────────────────────────────────────
  async function uploadFileObject(fileToUpload) {
    if (!fileToUpload || actionInProgress.current) return;
    if (fileToUpload.size > 10 * 1024 * 1024) { setError("File exceeds the 10 MB limit."); return; }
    actionInProgress.current = true;
    setBusy(true);
    setError("");
    setSuccess("");
    let uploadedSubmission = null;
    try {
      const formData = new FormData();
      formData.append("file", fileToUpload);
      const { data: newContent } = await api.post("/api/content/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setFile(null);
      setTextTitle("");
      setTextContent("");
      setSuccess("Content submitted. Running governance analysis…");
      await load();
      uploadedSubmission = newContent;
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Content upload failed."));
    } finally {
      actionInProgress.current = false;
      setBusy(false);
    }
    if (uploadedSubmission?.id) await analyze(uploadedSubmission);
  }

  async function handleTextSubmit(e) {
    e.preventDefault();
    if (!textContent.trim()) { setError("Please enter marketing text to analyze."); return; }
    const filename = textTitle.trim()
      ? textTitle.trim().endsWith(".txt") ? textTitle.trim() : `${textTitle.trim()}.txt`
      : "Draft_Marketing_Copy.txt";
    const textBlob = new Blob([textContent], { type: "text/plain" });
    const textFile = new File([textBlob], filename, { type: "text/plain" });
    await uploadFileObject(textFile);
  }

  async function analyze(submission) {
    if (actionInProgress.current) return;
    actionInProgress.current = true;
    setAnalyzingId(submission.id);
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const { data } = await api.post(`/api/analysis/${submission.id}/run`, undefined, { timeout: AI_REQUEST_TIMEOUT_MS });
      setSuccess(
        data.analysis_status === "complete"
          ? "Analysis completed with AI and approved evidence."
          : "Partial analysis saved. Review report note for limitations."
      );
      await load();
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Analysis could not be completed.", {
        timeoutMessage: "Analysis is taking longer than expected. It may still finish on the server; check submission history before retrying.",
      }));
    } finally {
      actionInProgress.current = false;
      setAnalyzingId("");
      setBusy(false);
    }
  }

  async function uploadVisualAsset(event) {
    event.preventDefault();
    if (!visualFile || visualBusy) return;
    setVisualBusy("upload");
    setError("");
    setSuccess("");
    try {
      const formData = new FormData();
      formData.append("file", visualFile);
      formData.append("asset_kind", visualAssetKind);
      const { data } = await api.post("/api/brand-assets/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setBrandAssets((current) => [data, ...current]);
      setVisualFile(null);
      setSuccess(
        visualAssetKind === "logo_reference"
          ? "Logo reference uploaded. A brand manager or administrator must approve it before comparison."
          : "Creative uploaded and ready for visual analysis."
      );
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Visual asset upload failed."));
    } finally {
      setVisualBusy("");
    }
  }

  async function approveVisualAsset(asset) {
    setVisualBusy(asset.id);
    setError("");
    try {
      const { data } = await api.put(`/api/brand-assets/${asset.id}/approve`);
      setBrandAssets((current) => current.map((item) => item.id === data.id ? data : item));
      setSuccess("Approved reference asset saved for organisation logo comparisons.");
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Asset approval failed."));
    } finally {
      setVisualBusy("");
    }
  }

  async function analyzeVisualAsset(asset) {
    setVisualBusy(asset.id);
    setError("");
    setVisualReport(null);
    try {
      const { data } = await api.post(
        `/api/brand-assets/${asset.id}/analyze`,
        undefined,
        {
          timeout: AI_REQUEST_TIMEOUT_MS,
          params: {
            ...(visualSubmissionId ? { submission_id: visualSubmissionId } : {}),
            logo_required: logoRequired,
          },
        },
      );
      setVisualReport(data);
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Visual review could not be completed."));
    } finally {
      setVisualBusy("");
    }
  }

  async function loadLatestVisualReport(asset) {
    setVisualBusy(asset.id);
    setError("");
    try {
      const { data } = await api.get(`/api/brand-assets/${asset.id}/analysis/latest`);
      setVisualReport(data);
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Saved visual report could not be loaded."));
    } finally {
      setVisualBusy("");
    }
  }

  async function reviewVisualReport(decision) {
    if (!visualReport || visualBusy) return;
    if (decision !== "approve" && !visualReviewComment.trim()) {
      setError("A comment is required to reject or request a visual revision.");
      return;
    }
    setVisualBusy("review");
    setError("");
    try {
      const { data } = await api.post(
        `/api/brand-assets/${visualReport.asset_id}/analysis/${visualReport.analysis_id}/review`,
        { decision, comment: visualReviewComment.trim() || undefined },
      );
      setVisualReport(data);
      setVisualReviewComment("");
      setSuccess(`Visual review saved as ${data.review_status.replaceAll("_", " ")}.`);
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Visual review decision could not be saved."));
    } finally {
      setVisualBusy("");
    }
  }

  // ── Utilities ──────────────────────────────────────────────────────────────
  function getFileIcon(filename) {
    const ext = filename?.split(".").pop()?.toLowerCase();
    if (ext === "pdf") return (
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-500/15 text-rose-400 border border-rose-500/30">
        <FileText size={18} />
      </div>
    );
    if (ext === "docx" || ext === "doc") return (
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30">
        <FileSpreadsheet size={18} />
      </div>
    );
    return (
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/15 text-sky-400 border border-sky-500/30">
        <FileCode size={18} />
      </div>
    );
  }

  function formatDate(isoString) {
    if (!isoString) return "-";
    return new Date(isoString).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  RENDER
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="space-y-6">
      {/* ── Page Header ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/30 to-sky-500/20 text-indigo-300 border border-indigo-500/30 shadow-inner">
            <BarChart3 size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Content Analysis</h1>
            <p className="text-xs text-slate-400">Submit marketing content for brand compliance analysis</p>
          </div>
        </div>
      </div>

      <ErrorNotice>{error}</ErrorNotice>
      <SuccessNotice>{success}</SuccessNotice>

      {/* ── Page-level Tabs ───────────────────────────────────────────────── */}
      <div className="inline-flex rounded-xl border border-navy-700/60 bg-navy-900 p-1">
        <button
          type="button"
          onClick={() => setPageTab("content")}
          className={`flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold transition ${
            pageTab === "content"
              ? "bg-gradient-to-r from-indigo-600 to-indigo-500 text-white shadow-md"
              : "text-slate-400 hover:text-white"
          }`}
        >
          <FileEdit size={16} /> Content Analysis
        </button>
        <button
          type="button"
          onClick={() => setPageTab("visual")}
          className={`flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold transition ${
            pageTab === "visual"
              ? "bg-gradient-to-r from-cyan-600 to-sky-500 text-white shadow-md"
              : "text-slate-400 hover:text-white"
          }`}
        >
          <Eye size={16} /> Visual Compliance
        </button>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          TAB 1 — Content Analysis
      ════════════════════════════════════════════════════════════════════ */}
      {pageTab === "content" && (
        <>
          {/* Upload + Guidelines row */}
          <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
            {/* Left: Upload Card */}
            <div className="rounded-2xl border border-navy-700/60 bg-navy-850 p-6 shadow-xl flex flex-col gap-5">
              {/* File / Text toggle */}
              <div className="inline-flex rounded-xl bg-navy-900 p-1 border border-navy-750 self-start">
                <button
                  type="button"
                  onClick={() => setActiveTab("file")}
                  className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition ${
                    activeTab === "file"
                      ? "bg-indigo-600 text-white shadow-md shadow-indigo-900/40"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  <FileUp size={14} /> Upload File
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("text")}
                  className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition ${
                    activeTab === "text"
                      ? "bg-indigo-600 text-white shadow-md shadow-indigo-900/40"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  <FileEdit size={14} /> Submit Text
                </button>
              </div>

              {/* File Upload drop zone */}
              {activeTab === "file" && (
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (e.dataTransfer.files?.[0]) uploadFileObject(e.dataTransfer.files[0]);
                  }}
                  className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-navy-700 hover:border-indigo-500/60 bg-navy-900/50 px-8 py-12 text-center transition group cursor-default"
                >
                  {busy ? (
                    <div className="flex flex-col items-center gap-4">
                      <div className="relative flex h-16 w-16 items-center justify-center">
                        <div className="absolute inset-0 rounded-full border-4 border-indigo-500/20 animate-ping" />
                        <LoaderCircle size={32} className="animate-spin text-indigo-400" />
                      </div>
                      <p className="text-sm font-semibold text-indigo-300">Uploading & analysing…</p>
                      <div className="w-48 h-1.5 rounded-full bg-navy-800 overflow-hidden">
                        <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-sky-400 w-3/4 animate-pulse" />
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-indigo-600/30 to-sky-500/20 text-indigo-400 border border-indigo-500/30 group-hover:scale-105 transition-transform">
                        <UploadCloud size={32} />
                      </div>
                      <p className="mt-4 text-sm font-semibold text-white">Drag &amp; drop your file here</p>
                      <p className="mt-1 text-xs text-slate-400 mb-3">
                        Supports PDF, DOCX, TXT — max 10MB
                      </p>
                      <div className="flex gap-2 mb-5">
                        <FilePill ext="pdf" />
                        <FilePill ext="docx" />
                        <FilePill ext="txt" />
                      </div>
                      <div className="flex items-center gap-4 w-full max-w-xs">
                        <div className="flex-1 h-px bg-navy-700" />
                        <span className="text-[10px] text-slate-500 font-medium">OR</span>
                        <div className="flex-1 h-px bg-navy-700" />
                      </div>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={busy}
                        className="mt-5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 px-6 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-900/40 transition"
                      >
                        <Upload size={14} /> Choose File
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".pdf,.docx,.txt"
                        className="hidden"
                        onChange={(e) => { if (e.target.files?.[0]) uploadFileObject(e.target.files[0]); }}
                      />
                    </>
                  )}
                </div>
              )}

              {/* Text submit form */}
              {activeTab === "text" && (
                <form onSubmit={handleTextSubmit} className="space-y-4">
                  <div>
                    <label className="form-label">Document Title / Campaign Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Summer Campaign Copy"
                      value={textTitle}
                      onChange={(e) => setTextTitle(e.target.value)}
                      className="form-input text-xs"
                    />
                  </div>
                  <div>
                    <label className="form-label">Marketing Text / Copy Content</label>
                    <textarea
                      rows={6}
                      required
                      placeholder="Paste or write marketing draft copy here..."
                      value={textContent}
                      onChange={(e) => setTextContent(e.target.value)}
                      className="form-input text-xs font-mono"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={busy || !textContent.trim()}
                      className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-900/40 transition disabled:opacity-50"
                    >
                      {busy ? <LoaderCircle size={14} className="animate-spin" /> : <Sparkles size={14} />}
                      Submit &amp; Analyze Copy
                    </button>
                  </div>
                </form>
              )}
            </div>

            {/* Right: Submission Guidelines */}
            <div className="rounded-2xl border border-navy-700/60 bg-navy-850 p-6 shadow-xl flex flex-col justify-between">
              <div>
                <h2 className="text-sm font-bold text-white tracking-wide pb-4 border-b border-navy-750">
                  Submission Guidelines
                </h2>
                <div className="mt-5 space-y-4">
                  {[
                    "Use approved brand guidelines",
                    "Avoid misleading claims",
                    "Maintain consistent voice",
                    "Follow our style guide",
                    "Include mandatory disclaimers",
                    "Respect trademark usage rules",
                  ].map((item) => (
                    <div key={item} className="flex items-center gap-3">
                      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
                        <CheckCircle2 size={14} />
                      </div>
                      <span className="text-xs font-medium text-slate-200">{item}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-8 rounded-xl border border-navy-750 bg-navy-900/60 p-3.5 text-[11px] text-slate-400 leading-relaxed">
                Uploaded content is verified strictly against active approved guidelines. Analysis reports provide full citations and source page references.
              </div>
            </div>
          </div>

          {/* ── Recent Submissions ──────────────────────────────────────────── */}
          <div className="rounded-2xl border border-navy-700/60 bg-navy-850 p-5 shadow-xl">
            <div className="flex items-center justify-between pb-4 border-b border-navy-750">
              <h2 className="text-sm font-bold text-white tracking-wide">Recent Submissions</h2>
              <Link to="/reviews" className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition flex items-center gap-1">
                View all →
              </Link>
            </div>

            <div className="mt-4 space-y-3">
              {loading ? (
                <Loading label="Loading submission history..." />
              ) : submissions.length === 0 ? (
                <div className="py-8">
                  <EmptyState
                    title="No content submitted yet"
                    description="Upload a campaign brief or marketing copy to get started with analysis."
                  />
                </div>
              ) : (
                submissions.slice(0, 5).map((submission) => {
                  const analysis = latestAnalysis.get(submission.id);
                  const isAnalyzing = analyzingId === submission.id;
                  return (
                    <div
                      key={submission.id}
                      className="rounded-xl border border-navy-750 bg-navy-900/70 p-4 hover:border-navy-700 transition"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div className="flex items-center gap-3.5 min-w-0">
                          {getFileIcon(submission.filename)}
                          <div className="min-w-0">
                            <h3 className="truncate text-xs font-semibold text-white" title={submission.filename}>
                              {submission.filename}
                            </h3>
                            <p className="text-[11px] text-slate-400 mt-0.5">{formatDate(submission.created_at)}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          {isAnalyzing ? (
                            <div className="flex items-center gap-2 text-xs text-indigo-400 font-semibold bg-indigo-500/10 border border-indigo-500/30 px-3 py-1 rounded-full">
                              <LoaderCircle size={13} className="animate-spin" />
                              <span>Analyzing…</span>
                            </div>
                          ) : analysis ? (
                            <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                              analysis.analysis_status === "complete"
                                ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                                : "bg-amber-500/15 text-amber-400 border-amber-500/30"
                            }`}>
                              {analysis.compliance_score}% Compliant
                            </span>
                          ) : (
                            <span className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border bg-slate-800 text-slate-300 border-slate-700">
                              {submission.status}
                            </span>
                          )}

                          <div className="flex items-center gap-2">
                            {analysis && (
                              <Link
                                to={`/analysis/${analysis.id}`}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-navy-700 bg-navy-800 hover:bg-navy-750 px-3 py-1.5 text-xs font-semibold text-slate-200 transition"
                              >
                                View report <ArrowRight size={13} />
                              </Link>
                            )}
                            <button
                              type="button"
                              onClick={() => analyze(submission)}
                              disabled={busy || isAnalyzing}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition disabled:opacity-50"
                            >
                              <Play size={12} fill="currentColor" /> {analysis ? "Re-run" : "Analyze"}
                            </button>
                          </div>
                        </div>
                      </div>

                      {isAnalyzing && (
                        <div className="mt-3 w-full bg-navy-800 rounded-full h-1.5 overflow-hidden">
                          <div className="bg-gradient-to-r from-indigo-500 to-sky-400 h-1.5 rounded-full w-3/4 animate-pulse" />
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          TAB 2 — Visual Compliance
      ════════════════════════════════════════════════════════════════════ */}
      {pageTab === "visual" && (
        <>
          {/* Premium hero banner for tab */}
          <div className="relative overflow-hidden rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-navy-850 via-cyan-950/20 to-navy-850 p-5 shadow-xl">
            <div className="absolute inset-0 opacity-5" style={{ backgroundImage: "radial-gradient(circle at 70% 50%, #22d3ee 0%, transparent 60%)" }} />
            <div className="relative flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500/30 to-sky-500/20 text-cyan-300 border border-cyan-500/30">
                <Eye size={20} />
              </div>
              <div>
                <h2 className="text-sm font-bold text-white">Visual Compliance</h2>
                <p className="text-[11px] text-cyan-300/80">AI-powered visual brand analysis — colours, typography, logo detection</p>
              </div>
              <span className="ml-auto rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-0.5 text-[10px] font-bold text-cyan-300 uppercase tracking-wider">Premium</span>
            </div>
          </div>

          {/* Two-panel upload + result layout */}
          <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
            {/* LEFT: Upload panel */}
            <div className="rounded-2xl border border-navy-700/60 bg-navy-850 p-6 shadow-xl flex flex-col gap-5">
              <h3 className="text-sm font-bold text-white border-b border-navy-750 pb-3">Upload Visual Asset</h3>

              {/* Image drop zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setVisualDragOver(true); }}
                onDragLeave={() => setVisualDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setVisualDragOver(false);
                  const dropped = e.dataTransfer.files?.[0];
                  if (dropped) setVisualFile(dropped);
                }}
                onClick={() => visualInputRef.current?.click()}
                className={`relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed cursor-pointer transition ${
                  visualDragOver
                    ? "border-cyan-400 bg-cyan-900/20"
                    : "border-navy-700 hover:border-cyan-500/50 bg-navy-900/50"
                }`}
                style={{ minHeight: 200 }}
              >
                {visualPreviewUrl ? (
                  <>
                    <img
                      src={visualPreviewUrl}
                      alt={`Preview of ${visualFile?.name || "selected marketing image"}`}
                      className="max-h-56 max-w-full rounded-xl object-contain p-2"
                    />
                    <div className="absolute top-2 right-2">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setVisualFile(null); }}
                        className="flex h-6 w-6 items-center justify-center rounded-full bg-navy-800/80 border border-navy-700 text-slate-400 hover:text-white transition"
                      >
                        <X size={12} />
                      </button>
                    </div>
                    <p className="pb-3 text-[11px] text-slate-400 truncate max-w-[90%]">{visualFile?.name}</p>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-3 p-8 text-center pointer-events-none">
                    <div className={`flex h-14 w-14 items-center justify-center rounded-full border transition ${
                      visualDragOver ? "bg-cyan-500/30 border-cyan-400 text-cyan-300" : "bg-cyan-500/10 border-cyan-500/30 text-cyan-400"
                    }`}>
                      <ImagePlus size={28} />
                    </div>
                    <p className="text-sm font-semibold text-white">Drop image here</p>
                    <p className="text-xs text-slate-400">PNG, JPG, WEBP, BMP, GIF</p>
                  </div>
                )}
                <input
                  ref={visualInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/bmp,image/gif"
                  className="hidden"
                  onChange={(e) => setVisualFile(e.target.files?.[0] || null)}
                />
              </div>

              {/* Asset options */}
              <div className="space-y-3">
                <div>
                  <label className="form-label">Asset Kind</label>
                  <select
                    aria-label="Visual asset kind"
                    value={visualAssetKind}
                    onChange={(e) => setVisualAssetKind(e.target.value)}
                    className="form-input text-xs"
                  >
                    <option value="creative">Marketing Creative</option>
                    <option value="logo_reference">Approved Logo Reference</option>
                  </select>
                </div>

                <div>
                  <label className="form-label" htmlFor="visual-submission">
                    Link to Submission (optional)
                  </label>
                  <select
                    id="visual-submission"
                    value={visualSubmissionId}
                    onChange={(e) => setVisualSubmissionId(e.target.value)}
                    className="form-input text-xs"
                  >
                    <option value="">Standalone visual review</option>
                    {submissions.map((s) => (
                      <option key={s.id} value={s.id}>{s.filename}</option>
                    ))}
                  </select>
                </div>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    aria-label="Logo required in creative"
                    type="checkbox"
                    checked={logoRequired}
                    onChange={(e) => setLogoRequired(e.target.checked)}
                    className="rounded border-navy-600 bg-navy-900 text-cyan-500 focus:ring-cyan-500"
                  />
                  <span className="text-xs text-slate-300">A logo is required in this creative</span>
                </label>
              </div>

              <form onSubmit={uploadVisualAsset}>
                <button
                  type="submit"
                  disabled={!visualFile || Boolean(visualBusy)}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 to-sky-500 hover:from-cyan-500 hover:to-sky-400 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-cyan-900/30 transition disabled:opacity-50"
                >
                  {visualBusy === "upload" ? <LoaderCircle size={16} className="animate-spin" /> : <ImagePlus size={16} />}
                  Upload Image
                </button>
              </form>
            </div>

            {/* RIGHT: Analysis result panel */}
            <div className="rounded-2xl border border-navy-700/60 bg-navy-850 shadow-xl overflow-hidden flex flex-col">
              {!visualReport ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 p-10 text-center">
                  <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500/15 to-sky-500/10 border border-cyan-500/20 text-cyan-400/60">
                    <Eye size={36} />
                  </div>
                  <p className="text-sm font-semibold text-slate-400">No analysis loaded</p>
                  <p className="text-xs text-slate-500 max-w-xs">Upload a creative and run analysis, or load the latest report from an asset below.</p>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto p-6 space-y-5">
                  {/* Header */}
                  <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-navy-750">
                    <div>
                      <h3 className="text-sm font-bold text-white">{visualReport.filename}</h3>
                      {visualReport.submission_id && latestAnalysis.get(visualReport.submission_id) && (
                        <Link
                          to={`/analysis/${latestAnalysis.get(visualReport.submission_id).id}`}
                          className="mt-1 inline-flex text-[11px] font-semibold text-cyan-300 underline underline-offset-2"
                        >
                          Open unified compliance report →
                        </Link>
                      )}
                    </div>
                    <ReviewStatusBadge status={visualReport.review_status} />
                  </div>

                  {/* Provider status row */}
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: "OCR", value: visualReport.provider_status?.ocr },
                      { label: "Vision", value: visualReport.provider_status?.vision },
                      visualReport.provider_status?.vision_model && { label: "Model", value: visualReport.provider_status.vision_model },
                    ].filter(Boolean).map((item) => (
                      <span key={item.label} className="inline-flex items-center gap-1 rounded-lg border border-navy-700 bg-navy-900 px-2.5 py-1 text-[10px] font-semibold">
                        <span className="text-slate-500">{item.label}:</span>
                        <span className={item.value === "available" || item.value === "ok" ? "text-emerald-400" : "text-slate-300"}>{item.value || "unavailable"}</span>
                      </span>
                    ))}
                  </div>

                  {/* Summary */}
                  {visualReport.summary && (
                    <p className="text-xs text-slate-300 leading-relaxed">{visualReport.summary}</p>
                  )}

                  {/* Warnings */}
                  {visualReport.warnings?.map((w) => (
                    <div key={w} className="rounded-lg border border-amber-500/25 bg-amber-950/15 px-3 py-2 text-[11px] text-amber-300">
                      {w}
                    </div>
                  ))}

                  {/* Colour rows */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="mb-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Detected Colours</p>
                      <div className="flex flex-wrap gap-1.5">
                        {visualReport.dominant_colours?.length ? visualReport.dominant_colours.map((c) => (
                          <span key={c} title={c} className="h-6 w-6 rounded-md border border-white/20 shadow-inner" style={{ backgroundColor: c }} />
                        )) : <span className="text-[11px] text-slate-500">None detected</span>}
                      </div>
                    </div>
                    <div>
                      <p className="mb-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Approved Palette</p>
                      <div className="flex flex-wrap gap-1.5">
                        {visualReport.approved_colours?.length ? visualReport.approved_colours.map((c) => (
                          <span key={c} title={c} className="h-6 w-6 rounded-md border border-white/20 shadow-inner" style={{ backgroundColor: c }} />
                        )) : <span className="text-[11px] text-slate-500">No approved HEX palette rule found.</span>}
                      </div>
                    </div>
                  </div>

                  {/* Typography */}
                  <div className="rounded-xl border border-navy-750 bg-navy-900/60 p-3 text-[11px] text-slate-400 space-y-1">
                    <p className="font-semibold text-slate-300 text-xs mb-2">Typography</p>
                    <div className="flex justify-between">
                      <span>Font family estimate</span>
                      <span className="text-slate-200">{visualReport.typography_analysis?.font_family_estimate || "unavailable"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Layout</span>
                      <span className="text-slate-200">{visualReport.typography_analysis?.layout || visualReport.typography_analysis?.layout_summary || "unavailable"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Text density</span>
                      <span className="text-slate-200">{Math.round((visualReport.typography_analysis?.text_density || 0) * 100)}%</span>
                    </div>
                  </div>

                  {/* Findings */}
                  {visualReport.findings?.length > 0 && (
                    <div>
                      <p className="mb-3 text-xs font-bold text-white">Visual Findings</p>
                      <div className="space-y-3">
                        {visualReport.findings.map((finding) => (
                          <div key={finding.id} className="rounded-xl border border-navy-750 bg-navy-900/70 p-4">
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                              <span className="text-xs font-bold text-white capitalize">{finding.category.replaceAll("_", " ")}</span>
                              <span className={`text-[10px] font-semibold ${
                                finding.verification_status === "confirmed" ? "text-rose-400" : "text-amber-300"
                              }`}>
                                {finding.verification_status.replaceAll("_", " ")}
                              </span>
                            </div>
                            <p className="text-xs text-slate-300 mb-3">{finding.description}</p>
                            <ConfidenceBar value={finding.confidence} />
                            {finding.evidence?.map((item, idx) => (
                              <div key={`${finding.id}-ev-${idx}`} className="mt-2 text-[10px] text-slate-500">
                                <p>Evidence: {item.method}{item.observation ? ` · ${item.observation}` : ""}</p>
                                {item.approved_guideline_references?.map((ref) => (
                                  <p key={ref.rule_id} className="mt-1 text-slate-500">
                                    Rule: {ref.title}{ref.source_section ? ` · ${ref.source_section}` : ""}{ref.source_page ? ` · p.${ref.source_page}` : ""}
                                  </p>
                                ))}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {visualReport.findings?.length === 0 && (
                    <div className="flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-950/15 p-4">
                      <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
                      <p className="text-xs font-semibold text-emerald-300">No findings crossed the review thresholds.</p>
                    </div>
                  )}

                  {/* Reviewer section */}
                  {["admin", "brand_manager", "reviewer"].includes(user?.role) && (
                    <div className="border-t border-navy-800 pt-4 space-y-3">
                      <p className="text-xs font-bold text-white">Reviewer Decision</p>
                      <div>
                        <label className="mb-1 block text-[10px] font-semibold text-slate-400">
                          Comment (required for reject or revision)
                        </label>
                        <input
                          value={visualReviewComment}
                          onChange={(e) => setVisualReviewComment(e.target.value)}
                          maxLength={2000}
                          className="form-input text-xs"
                          placeholder="Add context for the visual review decision"
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {[
                          ["approve", "Approve", "bg-emerald-600 hover:bg-emerald-500 text-white"],
                          ["reject", "Reject", "bg-rose-600 hover:bg-rose-500 text-white"],
                          ["request_revision", "Request Revision", "border border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"],
                        ].map(([dec, label, cls]) => (
                          <button
                            key={dec}
                            type="button"
                            onClick={() => reviewVisualReport(dec)}
                            disabled={Boolean(visualBusy)}
                            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${cls}`}
                          >
                            {visualBusy === "review" ? <LoaderCircle size={12} className="animate-spin inline mr-1" /> : null}
                            {label}
                          </button>
                        ))}
                      </div>

                      {/* Decision history */}
                      {visualReport.review_history?.length > 0 && (
                        <div className="space-y-1 pt-2 border-t border-navy-800">
                          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Decision History</p>
                          {visualReport.review_history.map((entry, i) => (
                            <div key={`${entry.created_at}-${i}`} className="flex items-start gap-2 text-[10px] text-slate-500">
                              <span className="text-slate-400 font-semibold capitalize">{entry.decision.replaceAll("_", " ")}</span>
                              <span>·</span>
                              <span>{new Date(entry.created_at).toLocaleString()}</span>
                              {entry.comment && <><span>·</span><span className="text-slate-400 italic">{entry.comment}</span></>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Brand Assets Grid ──────────────────────────────────────────── */}
          <div className="rounded-2xl border border-navy-700/60 bg-navy-850 p-5 shadow-xl">
            <div className="flex items-center justify-between pb-4 border-b border-navy-750">
              <div>
                <h2 className="text-sm font-bold text-white">Brand Assets</h2>
                <p className="text-[11px] text-slate-400 mt-0.5">{brandAssets.length} asset{brandAssets.length !== 1 ? "s" : ""} uploaded</p>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {brandAssets.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-500">No visual assets have been uploaded.</p>
              ) : brandAssets.slice(0, 8).map((asset) => (
                <div key={asset.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-navy-750 bg-navy-900/70 p-3 hover:border-navy-700 transition">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
                      <ImagePlus size={15} />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-white">{asset.filename}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        {asset.asset_kind === "logo_reference"
                          ? asset.approved ? "✓ Approved logo reference" : "⚠ Unapproved logo reference"
                          : "Marketing creative"}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {asset.asset_kind === "logo_reference" && !asset.approved && ["admin", "brand_manager"].includes(user?.role) && (
                      <button
                        type="button"
                        onClick={() => approveVisualAsset(asset)}
                        disabled={Boolean(visualBusy)}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[10px] font-semibold text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50 transition"
                      >
                        <ShieldCheck size={12} /> Approve
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => analyzeVisualAsset(asset)}
                      disabled={Boolean(visualBusy)}
                      className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-2.5 py-1.5 text-[10px] font-semibold text-white disabled:opacity-50 transition"
                    >
                      {visualBusy === asset.id ? <LoaderCircle size={12} className="animate-spin" /> : <ScanSearch size={12} />}
                      Analyze
                    </button>
                    <button
                      type="button"
                      onClick={() => loadLatestVisualReport(asset)}
                      disabled={Boolean(visualBusy)}
                      className="rounded-lg border border-navy-700 bg-navy-800 hover:bg-navy-750 px-2.5 py-1.5 text-[10px] font-semibold text-slate-300 disabled:opacity-50 transition"
                    >
                      Latest report
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
