import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
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
} from "lucide-react";
import { Link } from "react-router-dom";
import { Button, Card, EmptyState, ErrorNotice, Loading, SuccessNotice } from "../components/Feedback";
import { AI_REQUEST_TIMEOUT_MS, api, getErrorMessage } from "../services/api";
import { useAuth } from "../context/AuthContext";

export default function ContentPage() {
  const { user } = useAuth();
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
  const [textTitle, setTextTitle] = useState("");
  const [textContent, setTextContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [analyzingId, setAnalyzingId] = useState("");
  const fileInputRef = useRef(null);
  const actionInProgress = useRef(false);

  useEffect(() => {
    if (!visualFile) {
      setVisualPreviewUrl("");
      return undefined;
    }
    const previewUrl = URL.createObjectURL(visualFile);
    setVisualPreviewUrl(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [visualFile]);

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
    if (uploadedSubmission?.id) {
      await analyze(uploadedSubmission);
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
      const { data } = await api.get(
        `/api/brand-assets/${asset.id}/analysis/latest`,
      );
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

      <section className="rounded-2xl border border-navy-700/60 bg-navy-850 p-5 shadow-xl">
        <div className="flex items-center gap-3 border-b border-navy-750 pb-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/15 text-cyan-300">
            <ImagePlus size={18} />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">Visual Brand Review</h2>
            <p className="mt-1 text-[11px] text-slate-400">
              Heuristic checks remain available when OCR or Gemini vision is not configured.
            </p>
          </div>
        </div>
        <form onSubmit={uploadVisualAsset} className="mt-4 flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/bmp,image/gif"
            onChange={(event) => setVisualFile(event.target.files?.[0] || null)}
            className="min-w-0 flex-1 text-xs text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-navy-700 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white"
          />
          <label className="text-[11px] text-slate-300">
            Upload as
            <select
              aria-label="Visual asset kind"
              value={visualAssetKind}
              onChange={(event) => setVisualAssetKind(event.target.value)}
              className="ml-2 rounded-lg border border-navy-700 bg-navy-900 px-2 py-2 text-[11px]"
            >
              <option value="creative">Marketing creative</option>
              <option value="logo_reference">Approved logo reference</option>
            </select>
          </label>
          <button
            type="submit"
            disabled={!visualFile || Boolean(visualBusy)}
            className="inline-flex items-center gap-2 rounded-lg bg-cyan-700 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-600 disabled:opacity-50"
          >
            {visualBusy === "upload" ? <LoaderCircle size={14} className="animate-spin" /> : <ImagePlus size={14} />}
            Upload image
          </button>
        </form>
        {visualPreviewUrl && (
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-navy-750 bg-navy-900/70 p-3">
            <img
              src={visualPreviewUrl}
              alt={`Preview of ${visualFile?.name || "selected marketing image"}`}
              className="max-h-40 max-w-full rounded-lg object-contain"
            />
            <p className="text-[11px] text-slate-400">{visualFile?.name}</p>
          </div>
        )}
        <div className="mt-4 max-w-xl">
          <label className="form-label" htmlFor="visual-submission">
            Link analysis to a content submission (optional)
          </label>
          <select
            id="visual-submission"
            value={visualSubmissionId}
            onChange={(event) => setVisualSubmissionId(event.target.value)}
            className="form-input text-xs"
          >
            <option value="">Standalone visual review</option>
            {submissions.map((submission) => (
              <option key={submission.id} value={submission.id}>
                {submission.filename}
              </option>
            ))}
          </select>
          <label className="mt-3 flex items-center gap-2 text-[11px] text-slate-300">
            <input
              aria-label="Logo required in creative"
              type="checkbox"
              checked={logoRequired}
              onChange={(event) => setLogoRequired(event.target.checked)}
            />
            A logo is required in this creative
          </label>
        </div>

        <div className="mt-4 space-y-2">
          {brandAssets.length === 0 ? (
            <p className="py-4 text-xs text-slate-500">No visual assets have been uploaded.</p>
          ) : brandAssets.slice(0, 5).map((asset) => (
            <div key={asset.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-navy-750 bg-navy-900/70 p-3">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-white">{asset.filename}</p>
                <p className="mt-1 text-[10px] text-slate-400">
                  {asset.asset_kind === "logo_reference"
                    ? asset.approved
                      ? "Approved logo reference"
                      : "Unapproved logo reference"
                    : "Marketing creative"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {asset.asset_kind === "logo_reference" && !asset.approved && ["admin", "brand_manager"].includes(user?.role) && (
                  <button
                    type="button"
                    onClick={() => approveVisualAsset(asset)}
                    disabled={Boolean(visualBusy)}
                    className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 px-2.5 py-1.5 text-[10px] font-semibold text-emerald-300 disabled:opacity-50"
                  >
                    <ShieldCheck size={12} /> Approve reference
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => analyzeVisualAsset(asset)}
                  disabled={Boolean(visualBusy)}
                  className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-[10px] font-semibold text-white disabled:opacity-50"
                >
                  {visualBusy === asset.id ? <LoaderCircle size={12} className="animate-spin" /> : <ScanSearch size={12} />}
                  Analyze
                </button>
                <button
                  type="button"
                  onClick={() => loadLatestVisualReport(asset)}
                  disabled={Boolean(visualBusy)}
                  className="rounded-lg border border-navy-700 px-2.5 py-1.5 text-[10px] font-semibold text-slate-300 disabled:opacity-50"
                >
                  Latest report
                </button>
              </div>
            </div>
          ))}
        </div>

        {visualReport && (
          <div className="mt-4 rounded-xl border border-cyan-500/25 bg-cyan-950/15 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-bold text-white">{visualReport.filename} · visual findings</h3>
              <span className="text-[10px] text-cyan-200">
                {visualReport.review_status?.replaceAll("_", " ") || "pending"} · OCR: {visualReport.provider_status?.ocr || "unavailable"} · Vision: {visualReport.provider_status?.vision || "unavailable"}
                {visualReport.provider_status?.vision_model ? ` (${visualReport.provider_status.vision_model})` : ""}
              </span>
            </div>
            {visualReport.submission_id && latestAnalysis.get(visualReport.submission_id) && (
              <Link
                to={`/analysis/${latestAnalysis.get(visualReport.submission_id).id}`}
                className="mt-2 inline-flex text-[10px] font-semibold text-cyan-300 underline underline-offset-2"
              >
                Open unified compliance report
              </Link>
            )}
            <p className="mt-2 text-[11px] leading-relaxed text-slate-300">{visualReport.summary}</p>
            <div className="mt-3 flex flex-wrap gap-4 text-[10px] text-slate-400">
              <div>
                <p className="mb-1 font-semibold text-slate-300">Detected colours</p>
                <div className="flex flex-wrap gap-1">
                  {visualReport.dominant_colours?.map((colour) => (
                    <span key={colour} title={colour} className="h-5 w-5 rounded border border-white/20" style={{ backgroundColor: colour }} />
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1 font-semibold text-slate-300">Approved palette</p>
                <div className="flex flex-wrap gap-1">
                  {visualReport.approved_colours?.length ? visualReport.approved_colours.map((colour) => (
                    <span key={colour} title={colour} className="h-5 w-5 rounded border border-white/20" style={{ backgroundColor: colour }} />
                  )) : <span>No approved HEX palette rule found.</span>}
                </div>
              </div>
            </div>
            <p className="mt-2 text-[10px] text-slate-400">
              Typography: {visualReport.typography_analysis?.font_family_estimate || "unavailable"} ·
              Layout: {visualReport.typography_analysis?.layout || visualReport.typography_analysis?.layout_summary || "unavailable"} ·
              Text density: {Math.round((visualReport.typography_analysis?.text_density || 0) * 100)}%
            </p>
            {visualReport.warnings?.map((warning) => (
              <p key={warning} className="mt-2 text-[10px] text-amber-300">{warning}</p>
            ))}
            <div className="mt-3 space-y-2">
              {visualReport.findings?.length ? visualReport.findings.map((finding) => (
                <div key={finding.id} className="rounded-lg border border-navy-700 bg-navy-900/80 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-white">{finding.category.replaceAll("_", " ")}</span>
                    <span className="text-[10px] text-amber-300">
                      {finding.verification_status.replaceAll("_", " ")} · {Math.round(finding.confidence * 100)}%
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-300">{finding.description}</p>
                  {finding.evidence?.map((item, index) => (
                    <div key={`${finding.id}-evidence-${index}`} className="mt-1 text-[10px] text-slate-500">
                      <p>Evidence: {item.method}{item.observation ? ` · ${item.observation}` : ""}</p>
                      {item.approved_guideline_references?.map((reference) => (
                        <p key={reference.rule_id} className="mt-1">
                          Approved rule: {reference.title}
                          {reference.source_section ? ` · ${reference.source_section}` : ""}
                          {reference.source_page ? ` · page ${reference.source_page}` : ""}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
              )) : <p className="mt-3 text-[11px] text-emerald-300">No findings crossed the review thresholds.</p>}
            </div>
            {["admin", "brand_manager", "reviewer"].includes(user?.role) && (
              <div className="mt-4 border-t border-navy-800 pt-3">
                <label className="mb-2 block text-[10px] font-semibold text-slate-400">
                  Reviewer comment (required for reject or revision)
                </label>
                <input
                  value={visualReviewComment}
                  onChange={(event) => setVisualReviewComment(event.target.value)}
                  maxLength={2000}
                  className="form-input text-xs"
                  placeholder="Add context for the visual review decision"
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {[
                    ["approve", "Approve"],
                    ["reject", "Reject"],
                    ["request_revision", "Request revision"],
                  ].map(([decision, label]) => (
                    <button
                      key={decision}
                      type="button"
                      onClick={() => reviewVisualReport(decision)}
                      disabled={Boolean(visualBusy)}
                      className="rounded-lg border border-navy-700 bg-navy-800 px-3 py-1.5 text-[10px] font-semibold text-slate-200 hover:bg-navy-750 disabled:opacity-50"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {visualReport.review_history?.map((entry, index) => (
                  <p key={`${entry.created_at}-${index}`} className="mt-2 text-[10px] text-slate-500">
                    {entry.decision.replaceAll("_", " ")} · {new Date(entry.created_at).toLocaleString()}
                    {entry.comment ? ` · ${entry.comment}` : ""}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

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
