import { useEffect, useState } from "react";
import {
  BarChart3,
  BookOpen,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileEdit,
  HelpCircle,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Settings,
  Shield,
  Sparkles,
  X,
} from "lucide-react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { API_DOCS_URL, api, fetchHealth } from "../services/api";

const navigation = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/guidelines", label: "Brand Knowledge", icon: BookOpen },
  { to: "/content", label: "Content Submission", icon: FileEdit },
  { to: "/analysis", label: "Analysis Report", icon: BarChart3 },
  { to: "/reviews", label: "Review Queue", icon: ListChecks, badgeKey: "pendingReviews" },
  { to: "/audit", label: "Audit History", icon: Clock },
];

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [apiOnline, setApiOnline] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);

  useEffect(() => {
    let active = true;
    fetchHealth()
      .then(() => active && setApiOnline(true))
      .catch(() => active && setApiOnline(false));

    // Fetch live pending reviews count
    api.get("/api/dashboard/overview", { params: { days: "30" } })
      .then(({ data }) => {
        if (active && data?.pending_reviews !== undefined) {
          setPendingCount(data.pending_reviews);
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [location.pathname]);

  function signOut() {
    logout();
    navigate("/login", { replace: true });
  }

  const initials = user?.full_name
    ? user.full_name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "SJ";

  const formattedRole = user?.role
    ? user.role === "admin"
      ? "Organisation Admin"
      : user.role === "brand_manager"
      ? "Brand Manager"
      : user.role === "content_creator"
      ? "Content Creator"
      : user.role === "reviewer"
      ? "Reviewer"
      : user.role.replaceAll("_", " ")
    : "Marketing Manager";

  return (
    <div className="min-h-screen bg-navy-900 text-slate-100 flex flex-col md:flex-row">
      {/* Desktop Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-navy-950 border-r border-navy-800/80 px-4 py-5 text-slate-200 md:flex">
        {/* Brand Header */}
        <div className="flex items-center gap-3 px-2 mb-7">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-900/30">
            <div className="relative">
              <Shield size={22} className="fill-blue-500/30 stroke-white stroke-[2.2]" />
              <Sparkles size={11} className="absolute inset-0 m-auto text-cyan-300" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-1.5 font-bold tracking-tight text-white text-base">
              <span>BrandGuard</span>
              <span className="text-blue-400 font-semibold">AI</span>
            </div>
            <p className="text-[11px] text-slate-400 font-medium">Enterprise Governance</p>
          </div>
        </div>

        {/* Main Navigation */}
        <nav className="space-y-1.5 flex-1">
          {navigation.map(({ to, label, icon: Icon, end, badgeKey }) => {
            const isAnalysis = to === "/analysis";
            const isActive = isAnalysis
              ? location.pathname.startsWith("/analysis")
              : end
              ? location.pathname === to
              : location.pathname.startsWith(to);

            return (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={`flex items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all duration-150 ${
                  isActive
                    ? "bg-blue-600 text-white font-semibold shadow-md shadow-blue-600/30"
                    : "text-slate-300 hover:bg-navy-800 hover:text-white"
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon size={18} strokeWidth={isActive ? 2.2 : 1.8} />
                  <span>{label}</span>
                </div>
                {badgeKey === "pendingReviews" && pendingCount > 0 && (
                  <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-600 px-1.5 text-[11px] font-bold text-white shadow-sm shadow-rose-900/50">
                    {pendingCount}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* Secondary Links & Bottom Footer */}
        <div className="mt-auto space-y-1 pt-4 border-t border-navy-800/80">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors ${
                isActive ? "bg-navy-800 text-white" : "text-slate-400 hover:bg-navy-850 hover:text-white"
              }`
            }
          >
            <Settings size={17} strokeWidth={1.8} />
            <span>Settings</span>
          </NavLink>

          <button
            type="button"
            onClick={() => setShowHelpModal(true)}
            className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2 text-sm font-medium text-slate-400 hover:bg-navy-850 hover:text-white transition-colors text-left"
          >
            <HelpCircle size={17} strokeWidth={1.8} />
            <span>Help & Support</span>
          </button>

          {/* User Profile Card */}
          <div className="mt-4 rounded-xl border border-navy-750 bg-navy-850/80 p-2.5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600/30 border border-blue-500/40 text-blue-300 font-bold text-xs">
                  {initials}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-white">
                    {user?.full_name || "Sarah Johnson"}
                  </p>
                  <p className="truncate text-[10px] text-slate-400">{formattedRole}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={signOut}
                title="Sign out"
                aria-label="Sign out"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-navy-750 hover:text-rose-400 transition-colors"
              >
                <LogOut size={16} />
              </button>
            </div>
            {user?.organization_name && (
              <div className="mt-2 pt-2 border-t border-navy-750 text-[10px] text-slate-400 truncate">
                Org: <span className="text-slate-300 font-medium">{user.organization_name}</span>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Mobile Header */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-navy-800 bg-navy-950/95 px-4 py-3 backdrop-blur md:hidden">
        <div className="flex items-center gap-2.5 font-bold tracking-tight text-white">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white">
            <Shield size={18} />
          </div>
          <span className="text-base">BrandGuard <span className="text-blue-400">AI</span></span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-lg p-2 text-slate-400 hover:bg-navy-800 hover:text-white"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </header>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-30 bg-black/70 backdrop-blur-sm md:hidden">
          <div className="fixed inset-y-0 left-0 w-72 bg-navy-950 p-5 shadow-2xl flex flex-col">
            <div className="flex items-center justify-between pb-4 border-b border-navy-800">
              <div className="flex items-center gap-2 font-bold text-white">
                <Shield size={20} className="text-blue-400" />
                <span>BrandGuard AI</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <nav className="mt-5 space-y-1.5 flex-1 overflow-y-auto">
              {navigation.map(({ to, label, icon: Icon, end, badgeKey }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-medium ${
                      isActive ? "bg-blue-600 text-white font-semibold" : "text-slate-300 hover:bg-navy-800"
                    }`
                  }
                >
                  <div className="flex items-center gap-3">
                    <Icon size={18} />
                    <span>{label}</span>
                  </div>
                  {badgeKey === "pendingReviews" && pendingCount > 0 && (
                    <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-600 px-1.5 text-[11px] font-bold text-white">
                      {pendingCount}
                    </span>
                  )}
                </NavLink>
              ))}
              <NavLink
                to="/settings"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-300 hover:bg-navy-800"
              >
                <Settings size={18} />
                <span>Settings</span>
              </NavLink>
            </nav>

            <div className="pt-4 border-t border-navy-800">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-white">{user?.full_name}</p>
                  <p className="text-[10px] text-slate-400">{formattedRole}</p>
                </div>
                <button
                  type="button"
                  onClick={signOut}
                  className="rounded-lg p-2 text-rose-400 hover:bg-navy-800"
                >
                  <LogOut size={18} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 md:ml-64 flex flex-col min-w-0">
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1600px] w-full mx-auto">
          <Outlet />
        </main>
      </div>

      {/* Help & Support Modal */}
      {showHelpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-navy-700 bg-navy-850 p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5 font-bold text-white text-lg">
                <HelpCircle size={20} className="text-blue-400" />
                <span>BrandGuard AI Support</span>
              </div>
              <button
                type="button"
                onClick={() => setShowHelpModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            <div className="mt-4 space-y-3 text-xs text-slate-300 leading-relaxed">
              <p>
                <strong className="text-white">BrandGuard AI</strong> governs brand compliance across all marketing copy, guidelines, and assets using verified rules and evidence.
              </p>
              <div className="rounded-xl border border-navy-700 bg-navy-800/80 p-3">
                <p className="font-semibold text-blue-300 mb-1">API Status</p>
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${apiOnline ? "bg-emerald-400" : "bg-rose-400"}`} />
                  <span>{apiOnline ? "Connected & Healthy" : "Offline / Unreachable"}</span>
                </div>
              </div>
              <p>
                To explore or test backend routes and schemas, check the OpenAPI documentation below:
              </p>
              <a
                href={API_DOCS_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-navy-600 bg-navy-800 px-3.5 py-2 font-medium text-white hover:bg-navy-700 transition"
              >
                <span>Interactive Swagger API Docs</span>
                <ExternalLink size={14} />
              </a>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setShowHelpModal(false)}
                className="rounded-xl bg-navy-700 px-4 py-2 text-xs font-semibold text-white hover:bg-navy-650"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
