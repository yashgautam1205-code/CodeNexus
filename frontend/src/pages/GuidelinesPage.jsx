import { useEffect, useRef, useState, useMemo } from "react";
import {
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  FileCode,
  FilePlus,
  FileSpreadsheet,
  FileText,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  UploadCloud,
  X,
  Sparkles,
} from "lucide-react";
import { Button, Card, EmptyState, ErrorNotice, Loading, SuccessNotice } from "../components/Feedback";
import { useAuth } from "../context/AuthContext";
import { api, getErrorMessage } from "../services/api";

const categories = [
  ["tone_of_voice", "Tone of voice"],
  ["approved_terminology", "Approved terminology"],
  ["prohibited_terminology", "Prohibited terminology"],
  ["brand_messaging", "Brand messaging"],
  ["product_information", "Product information"],
  ["marketing_claims", "Marketing claims"],
  ["communication_guidelines", "Communication guidelines"],
  ["required_disclaimers", "Required disclaimers"],
];

const blankRule = {
  category: "tone_of_voice",
  title: "",
  rule_text: "",
  guideline_id: "",
  term: "",
  source_section: "",
  source_page: "",
  replacement_text: "",
};

export default function GuidelinesPage() {
  const { user } = useAuth();
  const canManage = ["admin", "brand_manager"].includes(user?.role);
  const [guidelines, setGuidelines] = useState([]);
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [file, setFile] = useState(null);
  const [supersedesGuidelineId, setSupersedesGuidelineId] = useState("");
  const [extractingGuideline, setExtractingGuideline] = useState("");
  const [ruleForm, setRuleForm] = useState(blankRule);
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [openActionDropdown, setOpenActionDropdown] = useState(null);
  const fileInputRef = useRef(null);

  async function load() {
    setError("");
    try {
      const [guidelineResponse, ruleResponse] = await Promise.all([
        api.get("/api/guidelines"),
        api.get("/api/rules"),
      ]);
      setGuidelines(guidelineResponse.data);
      setRules(ruleResponse.data);
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Brand knowledge could not be loaded."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function uploadFile(selectedFile) {
    if (!selectedFile) return;
    if (selectedFile.size > 10 * 1024 * 1024) {
      setError("File exceeds the 10 MB limit.");
      return;
    }
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      if (supersedesGuidelineId) formData.append("supersedes_guideline_id", supersedesGuidelineId);
      await api.post("/api/guidelines/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setFile(null);
      setSupersedesGuidelineId("");
      setSuccess("Guideline uploaded and processed. Extract draft rules to add them to your brand index.");
      await load();
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Guideline upload failed."));
    } finally {
      setBusy(false);
    }
  }

  async function extractRules(guidelineId) {
    setExtractingGuideline(guidelineId);
    setError("");
    setSuccess("");
    try {
      const { data } = await api.post(`/api/guidelines/${guidelineId}/extract-rules`);
      setSuccess(`Extracted ${data.length} candidate rules. Review and approve them to update the retrieval index.`);
      await load();
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Rule extraction failed."));
    } finally {
      setExtractingGuideline("");
    }
  }

  async function toggleApproval(rule) {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await api.put(`/api/rules/${rule.id}`, { approved: !rule.approved });
      setSuccess(
        rule.approved
          ? "Rule returned to draft status."
          : "Rule approved and synchronized with organisation retrieval index."
      );
      await load();
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Rule approval could not be updated."));
    } finally {
      setBusy(false);
    }
  }

  async function deleteRule(ruleId) {
    if (!window.confirm("Delete this rule? This cannot be undone.")) return;
    setBusy(true);
    setError("");
    try {
      await api.delete(`/api/rules/${ruleId}`);
      setSuccess("Rule deleted.");
      await load();
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Rule could not be deleted."));
    } finally {
      setBusy(false);
    }
  }

  async function deleteGuideline(guidelineId) {
    if (!window.confirm("Delete this guideline document and its related records?")) return;
    setBusy(true);
    setError("");
    try {
      await api.delete(`/api/guidelines/${guidelineId}`);
      setSuccess("Guideline deleted.");
      await load();
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Guideline could not be deleted."));
    } finally {
      setBusy(false);
    }
  }

  async function downloadGuideline(guideline) {
    try {
      const { data } = await api.get(`/api/guidelines/${guideline.id}/file`, { responseType: "blob" });
      const objectUrl = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = guideline.filename || `${guideline.title}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Guideline download failed."));
    }
  }

  async function submitRule(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = {
        ...ruleForm,
        guideline_id: ruleForm.guideline_id || null,
        term: ruleForm.term || null,
        source_section: ruleForm.source_section || null,
        source_page: ruleForm.source_page ? Number(ruleForm.source_page) : null,
        replacement_text: ruleForm.replacement_text || null,
      };

      if (editingRule) {
        await api.put(`/api/rules/${editingRule}`, payload);
        setSuccess("Rule updated successfully.");
      } else {
        await api.post("/api/rules", payload);
        setSuccess("Rule created as draft. Approve it to index.");
      }
      setShowRuleModal(false);
      setEditingRule(null);
      setRuleForm(blankRule);
      await load();
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Rule could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  // Split approved vs draft rules
  const approvedRules = useMemo(() => rules.filter((r) => r.approved), [rules]);
  const draftRules = useMemo(() => rules.filter((r) => !r.approved), [rules]);

  function getFileIcon(filename) {
    const ext = filename?.split(".").pop()?.toLowerCase();
    if (ext === "pdf") {
      return (
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-500/15 text-rose-400 border border-rose-500/30">
          <FileText size={15} />
        </div>
      );
    }
    if (ext === "docx" || ext === "doc") {
      return (
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/30">
          <FileSpreadsheet size={15} />
        </div>
      );
    }
    return (
      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/15 text-blue-400 border border-blue-500/30">
        <FileCode size={15} />
      </div>
    );
  }

  function getFileTypeLabel(filename) {
    return filename?.split(".").pop()?.toUpperCase() || "PDF";
  }

  function formatDate(isoString) {
    if (!isoString) return "-";
    return new Date(isoString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  // Map guideline IDs to title for "From: X"
  const guidelineMap = useMemo(() => {
    return new Map(guidelines.map((g) => [g.id, g.title || g.filename]));
  }, [guidelines]);

  return (
    <div className="space-y-6">
      {/* Top Header matching Reference Image Screen 2 */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30 shadow-inner">
            <BookOpen size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Brand Knowledge Hub</h1>
            <p className="text-xs text-slate-400">Manage your brand guidelines and approved rules</p>
          </div>
        </div>

        {canManage && (
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                setEditingRule(null);
                setRuleForm(blankRule);
                setShowRuleModal(true);
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-navy-700 bg-navy-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-navy-750 transition"
            >
              <Plus size={15} /> Add Rule
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-blue-900/40 transition"
            >
              <Upload size={15} /> Upload Guidelines
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.[0]) uploadFile(e.target.files[0]);
              }}
            />
          </div>
        )}
      </div>

      <ErrorNotice>{error}</ErrorNotice>
      <SuccessNotice>{success}</SuccessNotice>

      {/* Top Row: Dropzone (Left) & Guideline Overview (Right) */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: Drag & Drop Upload Zone */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files?.[0]) uploadFile(e.dataTransfer.files[0]);
          }}
          onClick={() => fileInputRef.current?.click()}
          className="group flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-navy-700 hover:border-blue-500/60 bg-navy-850/80 p-8 text-center cursor-pointer transition shadow-lg"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-600/20 text-blue-400 border border-blue-500/30 group-hover:scale-110 transition-transform">
            <UploadCloud size={28} />
          </div>
          <p className="mt-4 text-sm font-semibold text-white">
            Drag and drop files or click to upload
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Supports: PDF, DOCX, TXT (max 10MB)
          </p>
          {busy && <p className="mt-2 text-xs text-blue-400 font-medium">Uploading & extracting text…</p>}
        </div>

        {/* Right: Guideline Overview Card */}
        <div className="rounded-2xl border border-navy-700/60 bg-navy-850 p-6 shadow-xl flex flex-col justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              <CheckCircle2 size={16} />
            </div>
            <h2 className="text-sm font-bold text-white tracking-wide">Guideline Overview</h2>
          </div>

          <div className="grid grid-cols-3 gap-4 my-auto pt-6 pb-2 text-center">
            <div className="rounded-xl border border-navy-750 bg-navy-900/60 p-4">
              <p className="text-xs text-slate-400 font-medium">Total Documents</p>
              <p className="mt-2 text-3xl font-bold text-white tracking-tight">{guidelines.length}</p>
            </div>
            <div className="rounded-xl border border-navy-750 bg-navy-900/60 p-4">
              <p className="text-xs text-slate-400 font-medium">Approved Rules</p>
              <p className="mt-2 text-3xl font-bold text-emerald-400 tracking-tight">{approvedRules.length}</p>
            </div>
            <div className="rounded-xl border border-navy-750 bg-navy-900/60 p-4">
              <p className="text-xs text-slate-400 font-medium">Pending Review</p>
              <p className="mt-2 text-3xl font-bold text-amber-400 tracking-tight">{draftRules.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Row: Uploaded Documents (Left) & Draft Rules (Right) */}
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        {/* Left: Uploaded Documents Table */}
        <div className="rounded-2xl border border-navy-700/60 bg-navy-850 p-5 shadow-xl flex flex-col">
          <div className="flex items-center justify-between pb-4 border-b border-navy-750">
            <h2 className="text-sm font-bold text-white tracking-wide">Uploaded Documents</h2>
            <span className="text-xs text-slate-400 font-medium">{guidelines.length} total</span>
          </div>

          {loading ? (
            <Loading label="Loading guidelines..." />
          ) : guidelines.length === 0 ? (
            <div className="py-12">
              <EmptyState
                title="No guideline documents"
                description="Upload a brand PDF, DOCX, or TXT document above to establish rules."
              />
            </div>
          ) : (
            <div className="overflow-x-auto mt-2">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-navy-750 text-slate-400">
                  <tr>
                    <th className="py-3 pl-2 pr-3 font-semibold uppercase tracking-wider text-[11px]">Name</th>
                    <th className="py-3 px-3 font-semibold uppercase tracking-wider text-[11px]">Type</th>
                    <th className="py-3 px-3 font-semibold uppercase tracking-wider text-[11px]">Uploaded</th>
                    <th className="py-3 px-3 font-semibold uppercase tracking-wider text-[11px]">Status</th>
                    <th className="py-3 pl-3 pr-2 text-right font-semibold uppercase tracking-wider text-[11px]">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-750 text-slate-200">
                  {guidelines.map((guideline) => (
                    <tr key={guideline.id} className="hover:bg-navy-800/40 transition-colors">
                      <td className="py-3.5 pl-2 pr-3 max-w-[180px]">
                        <div className="flex items-center gap-2.5">
                          {getFileIcon(guideline.filename)}
                          <span className="truncate font-medium text-slate-200" title={guideline.title || guideline.filename}>
                            {guideline.title || guideline.filename}
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-3 font-medium text-slate-400 uppercase">
                        {getFileTypeLabel(guideline.filename)}
                      </td>
                      <td className="py-3.5 px-3 text-slate-400 whitespace-nowrap">
                        {formatDate(guideline.created_at)}
                      </td>
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                          guideline.status === "approved"
                            ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                            : "bg-amber-500/15 text-amber-400 border-amber-500/30"
                        }`}>
                          {guideline.status === "approved" ? "Approved" : "Pending"}
                        </span>
                      </td>
                      <td className="py-3.5 pl-3 pr-2 text-right relative">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => extractRules(guideline.id)}
                            disabled={extractingGuideline === guideline.id}
                            title="Extract Rules with AI"
                            className="rounded-lg p-1.5 text-blue-400 hover:bg-navy-800 transition"
                          >
                            <Sparkles size={14} className={extractingGuideline === guideline.id ? "animate-spin" : ""} />
                          </button>
                          <button
                            type="button"
                            onClick={() => downloadGuideline(guideline)}
                            title="Download Source Document"
                            className="rounded-lg p-1.5 text-slate-400 hover:text-white hover:bg-navy-800 transition"
                          >
                            <Download size={14} />
                          </button>
                          {canManage && (
                            <button
                              type="button"
                              onClick={() => deleteGuideline(guideline.id)}
                              title="Delete Guideline"
                              className="rounded-lg p-1.5 text-slate-400 hover:text-rose-400 hover:bg-navy-800 transition"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right: Draft Rules List matching Reference Image Screen 2 */}
        <div className="rounded-2xl border border-navy-700/60 bg-navy-850 p-5 shadow-xl flex flex-col">
          <div className="flex items-center justify-between pb-4 border-b border-navy-750">
            <h2 className="text-sm font-bold text-white tracking-wide">Draft Rules</h2>
            <span className="rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2.5 py-0.5 text-xs font-bold">
              {draftRules.length} pending
            </span>
          </div>

          <div className="mt-4 space-y-3 max-h-[380px] overflow-y-auto pr-1">
            {draftRules.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-400">
                <CheckCircle2 size={24} className="mx-auto text-emerald-400 mb-2" />
                All rules approved! No draft rules pending review.
              </div>
            ) : (
              draftRules.map((rule) => {
                const sourceDoc = rule.guideline_id ? guidelineMap.get(rule.guideline_id) : "General Guidelines";
                return (
                  <div
                    key={rule.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-navy-750 bg-navy-900/60 p-3.5 hover:border-navy-700 transition"
                  >
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-xs font-semibold text-slate-100">{rule.title}</h3>
                      <p className="truncate text-[11px] text-slate-400 mt-0.5">
                        From: <span className="text-slate-300 font-medium">{sourceDoc}</span>
                      </p>
                      {rule.source_section && (
                        <p className="text-[10px] text-slate-500 mt-0.5">{rule.source_section}</p>
                      )}
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => toggleApproval(rule)}
                          disabled={busy}
                          className="rounded-lg bg-blue-600 hover:bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition"
                        >
                          Review
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteRule(rule.id)}
                          disabled={busy}
                          className="rounded-lg border border-navy-700 bg-navy-800 hover:bg-navy-750 hover:text-rose-400 px-3 py-1.5 text-xs font-semibold text-slate-300 transition"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Manual Add / Edit Rule Modal */}
      {showRuleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-navy-700 bg-navy-850 p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-navy-750">
              <h3 className="text-base font-bold text-white">
                {editingRule ? "Edit Brand Rule" : "Create Brand Rule"}
              </h3>
              <button
                type="button"
                onClick={() => setShowRuleModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={submitRule} className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="form-label">Category</label>
                <select
                  className="form-input text-xs"
                  value={ruleForm.category}
                  onChange={(e) => setRuleForm({ ...ruleForm, category: e.target.value })}
                >
                  {categories.map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label">Title</label>
                <input
                  type="text"
                  required
                  className="form-input text-xs"
                  placeholder="e.g. Avoid exaggerated claims"
                  value={ruleForm.title}
                  onChange={(e) => setRuleForm({ ...ruleForm, title: e.target.value })}
                />
              </div>
              <div>
                <label className="form-label">Rule Text / Requirement</label>
                <textarea
                  rows={3}
                  required
                  className="form-input text-xs"
                  placeholder="Describe the policy, rule, or restriction..."
                  value={ruleForm.rule_text}
                  onChange={(e) => setRuleForm({ ...ruleForm, rule_text: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Source Section (optional)</label>
                  <input
                    type="text"
                    className="form-input text-xs"
                    placeholder="e.g. Section 3.2"
                    value={ruleForm.source_section}
                    onChange={(e) => setRuleForm({ ...ruleForm, source_section: e.target.value })}
                  />
                </div>
                <div>
                  <label className="form-label">Source Page (optional)</label>
                  <input
                    type="number"
                    className="form-input text-xs"
                    placeholder="e.g. 2"
                    value={ruleForm.source_page}
                    onChange={(e) => setRuleForm({ ...ruleForm, source_page: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2.5 pt-3 border-t border-navy-750">
                <button
                  type="button"
                  onClick={() => setShowRuleModal(false)}
                  className="rounded-xl border border-navy-700 bg-navy-800 px-4 py-2 font-medium text-slate-300 hover:bg-navy-750"
                >
                  Cancel
                </button>
                <Button type="submit" disabled={busy}>
                  {busy ? "Saving…" : "Save Rule"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
