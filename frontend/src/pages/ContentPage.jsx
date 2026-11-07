import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  FileCode,
  FileEdit,
  FileSpreadsheet,
  FileText,
  FileUp,
  LoaderCircle,
  Play,
  Sparkles,
  Upload,
  UploadCloud,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Button, Card, EmptyState, ErrorNotice, Loading, SuccessNotice } from "../components/Feedback";
import { AI_REQUEST_TIMEOUT_MS, api, getErrorMessage } from "../services/api";

export default function ContentPage() {
  const [submissions, setSubmissions] = useState([]);
  const [analyses, setAnalyses] = useState([]);
  const [file, setFile] = useState(null);
  const [activeTab, setActiveTab] = useState("file"); // "file" | "text"
  const [textTitle, setTextTitle] = useState("");
  const [textContent, setTextContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [analyzingId, setAnalyzingId] = useState("");
  const fileInputRef = useRef(null);
  const actionInProgress = useRef(false);

  async function load() {
    try {
      const [submissionResponse, analysisResponse] = await Promise.all([
        api.get("/api/content"),
        api.get("/api/analysis"),
      ]);
      setSubmissions(submissionResponse.data);
      setAnalyses(analysisResponse.data);
      setError("");
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Submission history could not be loaded."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function uploadFileObject(fileToUpload) {
    if (!fileToUpload || actionInProgress.current) return;
    if (fileToUpload.size > 10 * 1024 * 1024) {
      setError("File exceeds the 10 MB limit.");
      return;
    }

    actionInProgress.current = true;
    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const formData = new FormData();
      formData.append("file", fileToUpload);
      const { data: newContent } = await api.post("/api/content/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setFile(null);
      setTextTitle("");
      setTextContent("");
      setSuccess("Content submitted successfully. Click 'Run analysis' to perform governance verification.");
      await load();

      // Automatically trigger analysis for seamless experience if desired
      if (newContent?.id) {
        analyze(newContent);
      }
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Content upload failed."));
    } finally {
      actionInProgress.current = false;
      setBusy(false);
    }
  }

  async function handleTextSubmit(e) {
    e.preventDefault();
    if (!textContent.trim()) {
      setError("Please enter marketing text to analyze.");
      return;
    }
    const filename = textTitle.trim()
      ? textTitle.trim().endsWith(".txt")
        ? textTitle.trim()
        : `${textTitle.trim()}.txt`
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
      const { data } = await api.post(
        `/api/analysis/${submission.id}/run`,
        undefined,
        { timeout: AI_REQUEST_TIMEOUT_MS }
      );
      setSuccess(
        data.analysis_status === "complete"
          ? "Analysis completed with AI and approved evidence."
          : "Partial analysis saved. Review report note for limitations."
      );
      await load();
    } catch (requestError) {
      setError(
        getErrorMessage(requestError, "Analysis could not be completed.", {
          timeoutMessage:
            "Analysis is taking longer than expected. It may still finish on the server; check submission history before retrying.",
        })
      );
    } finally {
      actionInProgress.current = false;
      setAnalyzingId("");
      setBusy(false);
    }
  }

  const latestAnalysis = new Map();
  for (const analysis of analyses) {
    if (!latestAnalysis.has(analysis.submission_id)) {
      latestAnalysis.set(analysis.submission_id, analysis);
    }
  }

  function getFileIcon(filename) {
    const ext = filename?.split(".").pop()?.toLowerCase();
    if (ext === "pdf") {
      return (
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-500/15 text-rose-400 border border-rose-500/30">
          <FileText size={18} />
        </div>
      );
    }
    if (ext === "docx" || ext === "doc") {
      return (
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30">
          <FileSpreadsheet size={18} />
        </div>
      );
    }
    return (
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/15 text-blue-400 border border-blue-500/30">
        <FileCode size={18} />
      </div>
    );
  }

  function formatDate(isoString) {
    if (!isoString) return "-";
    return new Date(isoString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }

  return (
    <div className="space-y-6">
      {/* Top Header matching Reference Image Screen 3 */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cyan-600/20 text-cyan-400 border border-cyan-500/30 shadow-inner">
            <FileEdit size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Content Submission</h1>
            <p className="text-xs text-slate-400">
              Submit marketing content for brand compliance analysis
            </p>
          </div>
        </div>
      </div>

      <ErrorNotice>{error}</ErrorNotice>
      <SuccessNotice>{success}</SuccessNotice>

      {/* Main Form Split: Upload Card (Left) & Submission Guidelines (Right) */}
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        {/* Left Card with Tabs: Upload File / Submit Text */}
        <div className="rounded-2xl border border-navy-700/60 bg-navy-850 p-6 shadow-xl flex flex-col justify-between">
          <div>
            {/* Tabs matching Reference Image Screen 3 */}
            <div className="inline-flex rounded-xl bg-navy-900 p-1 border border-navy-750">
              <button
                type="button"
                onClick={() => setActiveTab("file")}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition ${
                  activeTab === "file"
                    ? "bg-blue-600 text-white shadow-md shadow-blue-900/40"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <FileUp size={15} /> Upload File
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("text")}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition ${
                  activeTab === "text"
                    ? "bg-blue-600 text-white shadow-md shadow-blue-900/40"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <FileEdit size={15} /> Submit Text
              </button>
            </div>

            {/* Tab 1: Upload File */}
            {activeTab === "file" && (
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer.files?.[0]) uploadFileObject(e.dataTransfer.files[0]);
                }}
                className="mt-6 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-navy-700 hover:border-blue-500/60 bg-navy-900/50 p-10 text-center transition"
              >
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-600/20 text-blue-400 border border-blue-500/30">
                  <UploadCloud size={32} />
                </div>
                <p className="mt-4 text-sm font-semibold text-white">
                  Drag and drop your file here
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Supports: PDF, DOCX, TXT (max 10MB)
                </p>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy}
                  className="mt-6 inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-blue-900/40 transition"
                >
                  <Upload size={14} /> Choose File
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.txt"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.[0]) uploadFileObject(e.target.files[0]);
                  }}
                />
              </div>
            )}

            {/* Tab 2: Submit Text */}
            {activeTab === "text" && (
              <form onSubmit={handleTextSubmit} className="mt-6 space-y-4">
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
                    className="inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-blue-900/40 transition disabled:opacity-50"
                  >
                    <Sparkles size={14} /> Submit & Analyze Copy
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        {/* Right Card: Submission Guidelines matching Reference Image Screen 3 */}
        <div className="rounded-2xl border border-navy-700/60 bg-navy-850 p-6 shadow-xl flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-bold text-white tracking-wide pb-4 border-b border-navy-750">
              Submission Guidelines
            </h2>

            <div className="mt-5 space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
                  <CheckCircle2 size={15} />
                </div>
                <span className="text-xs font-medium text-slate-200">
                  Use approved brand guidelines
                </span>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
                  <CheckCircle2 size={15} />
                </div>
                <span className="text-xs font-medium text-slate-200">
                  Avoid misleading claims
                </span>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
                  <CheckCircle2 size={15} />
                </div>
                <span className="text-xs font-medium text-slate-200">
                  Maintain consistent voice
                </span>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
                  <CheckCircle2 size={15} />
                </div>
                <span className="text-xs font-medium text-slate-200">
                  Follow our style guide
                </span>
              </div>
            </div>
          </div>

          <div className="mt-8 rounded-xl border border-navy-750 bg-navy-900/60 p-3.5 text-[11px] text-slate-400 leading-relaxed">
            Uploaded content is verified strictly against active approved guidelines. Analysis reports provide full citations and source page references.
          </div>
        </div>
      </div>

      {/* Bottom Section: Recent Submissions matching Reference Image Screen 3 */}
      <div className="rounded-2xl border border-navy-700/60 bg-navy-850 p-5 shadow-xl">
        <div className="flex items-center justify-between pb-4 border-b border-navy-750">
          <h2 className="text-sm font-bold text-white tracking-wide">Recent Submissions</h2>
          <Link
            to="/reviews"
            className="text-xs font-semibold text-blue-400 hover:text-blue-300 transition flex items-center gap-1"
          >
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
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {formatDate(submission.created_at)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      {isAnalyzing ? (
                        <div className="flex items-center gap-2 text-xs text-blue-400 font-semibold bg-blue-500/10 border border-blue-500/30 px-3 py-1 rounded-full">
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
                          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition disabled:opacity-50"
                        >
                          <Play size={12} fill="currentColor" /> {analysis ? "Re-run" : "Analyze"}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Progress bar matching Reference Image Screen 3 when analyzing */}
                  {isAnalyzing && (
                    <div className="mt-3 w-full bg-navy-800 rounded-full h-1.5 overflow-hidden">
                      <div className="bg-gradient-to-r from-blue-500 to-cyan-400 h-1.5 rounded-full w-3/4 animate-pulse" />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
