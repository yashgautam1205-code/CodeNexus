import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  BookOpen,
  Building2,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Command,
  FileSearch,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../services/api";

const navigationGroups = [
  {
    label: "OVERVIEW",
    items: [{ to: "/", label: "Dashboard", icon: LayoutDashboard, end: true }],
  },
  {
    label: "ANALYSIS",
    items: [
      { to: "/content", label: "Content analysis", icon: FileSearch },
      { to: "/analysis", label: "Analysis reports", icon: ChartNoAxesCombined },
    ],
  },
  {
    label: "GOVERNANCE",
    items: [
      { to: "/reviews", label: "Review center", icon: ClipboardCheck },
      { to: "/guidelines", label: "Brand guidelines", icon: BookOpen },
      { to: "/audit", label: "Audit history", icon: History },
    ],
  },
  {
    label: "SETTINGS",
    items: [{ to: "/settings", label: "Workspace settings", icon: Settings }],
  },
];

const allNavigationItems = navigationGroups.flatMap((group) => group.items);

function isItemActive(item, pathname) {
  if (item.end) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

function getInitials(name) {
  return name
    ?.trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "BG";
}

function formatRole(role) {
  if (!role) return "Workspace member";
  const labels = {
    admin: "Organization admin",
    brand_manager: "Brand manager",
    content_creator: "Content creator",
    reviewer: "Reviewer",
  };
  return labels[role] || role.replaceAll("_", " ");
}

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [pendingCount, setPendingCount] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef(null);
  const searchPanelRef = useRef(null);
  const profileRef = useRef(null);

  useEffect(() => {
    let active = true;
    api
      .get("/api/dashboard/overview", { params: { days: "30" } })
      .then(({ data }) => {
        if (active && data?.pending_reviews !== undefined) {
          setPendingCount(data.pending_reviews);
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setMobileMenuOpen(false);
    setProfileOpen(false);
    setSearchOpen(false);
    setQuery("");
  }, [location.pathname]);

  useEffect(() => {
    function handleShortcut(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
        requestAnimationFrame(() => searchRef.current?.focus());
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        setProfileOpen(false);
        setMobileMenuOpen(false);
      }
    }

    function handleOutsideClick(event) {
      if (searchPanelRef.current && !searchPanelRef.current.contains(event.target)) {
        setSearchOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(event.target)) {
        setProfileOpen(false);
      }
    }

    document.addEventListener("keydown", handleShortcut);
    document.addEventListener("mousedown", handleOutsideClick);
    return () => {
      document.removeEventListener("keydown", handleShortcut);
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, []);

  const searchResults = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return allNavigationItems;
    return allNavigationItems.filter((item) => item.label.toLowerCase().includes(needle));
  }, [query]);

  const activeItem = allNavigationItems.find((item) => isItemActive(item, location.pathname));
  const currentPage = activeItem?.label || "Workspace";
  const organizationName = user?.organization_name || "Organization workspace";
  const userName = user?.full_name || user?.email || "Workspace member";
  const initials = getInitials(user?.full_name || user?.email);

  function signOut() {
    logout();
    navigate("/login", { replace: true });
  }

  function openSearchResult(path) {
    navigate(path);
    setSearchOpen(false);
    setQuery("");
  }

  function handleSearchKeyDown(event) {
    if (event.key === "Enter" && searchResults.length) {
      event.preventDefault();
      openSearchResult(searchResults[0].to);
    }
  }

  function renderNavigation(compact = false) {
    return navigationGroups.map((group) => (
      <div className="space-y-1" key={group.label}>
        {!compact && (
          <p className="px-3 pb-1 pt-4 text-[10px] font-semibold tracking-[0.14em] text-slate-500">
            {group.label}
          </p>
        )}
        {group.items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => setMobileMenuOpen(false)}
            title={compact ? label : undefined}
            aria-label={compact ? label : undefined}
            className={({ isActive }) =>
              `group flex min-h-10 items-center gap-3 rounded-xl px-3 text-[13px] font-medium transition-colors duration-150 ${
                isActive
                  ? "border border-blue-400/15 bg-gradient-to-r from-blue-600/25 to-violet-500/15 text-white shadow-[inset_0_0_18px_rgba(37,99,235,0.08)]"
                  : "border border-transparent text-slate-400 hover:bg-white/[0.045] hover:text-slate-100"
              } ${compact ? "justify-center px-0" : ""}`
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  size={17}
                  strokeWidth={isActive ? 2.1 : 1.8}
                  className={isActive ? "text-blue-300" : "text-slate-500 group-hover:text-slate-300"}
                />
                {!compact && <span className="truncate">{label}</span>}
              </>
            )}
          </NavLink>
        ))}
      </div>
    ));
  }

  return (
    <div className="min-h-screen bg-transparent text-slate-100">
      <aside
        className={`fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-blue-200/[0.08] bg-[#08152B]/95 px-3 py-4 backdrop-blur-xl transition-[width] duration-200 md:flex ${
          sidebarCollapsed ? "w-[76px]" : "w-[252px]"
        }`}
      >
        <div className={`mb-5 flex h-11 items-center ${sidebarCollapsed ? "justify-center" : "justify-between px-1"}`}>
          <Link to="/" className="flex min-w-0 items-center gap-3 rounded-lg" aria-label="BrandGuard AI home">
            <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-300/20 bg-gradient-to-br from-blue-500/25 to-violet-500/20 text-blue-200 shadow-[0_0_24px_rgba(37,99,235,0.16)]">
              <ShieldCheck size={20} />
              <Sparkles className="absolute -right-1 -top-1 text-cyan-300" size={10} />
            </span>
            {!sidebarCollapsed && (
              <span className="truncate text-[14px] font-semibold tracking-tight text-slate-100">
                BrandGuard <span className="text-blue-300">AI</span>
              </span>
            )}
          </Link>
          {!sidebarCollapsed && (
            <button
              type="button"
              onClick={() => setSidebarCollapsed(true)}
              className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white/[0.06] hover:text-slate-200"
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
            >
              <ChevronLeft size={16} />
            </button>
          )}
        </div>

        {sidebarCollapsed && (
          <button
            type="button"
            onClick={() => setSidebarCollapsed(false)}
            className="mb-3 flex h-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white/[0.06] hover:text-slate-200"
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <ChevronRight size={16} />
          </button>
        )}

        <nav aria-label="Main navigation" className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {renderNavigation(sidebarCollapsed)}
        </nav>

        <div className={`mt-3 border-t border-blue-200/[0.08] pt-3 ${sidebarCollapsed ? "flex justify-center" : ""}`}>
          {sidebarCollapsed ? (
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-blue-300/15 bg-blue-500/10 text-xs font-semibold text-blue-200" title={userName}>
              {initials}
            </div>
          ) : (
            <div className="flex min-w-0 items-center gap-3 rounded-xl border border-blue-200/[0.08] bg-white/[0.025] px-2.5 py-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-blue-300/15 bg-blue-500/10 text-[11px] font-semibold text-blue-200">
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-slate-200">{userName}</p>
                <p className="truncate text-[10px] capitalize text-slate-500">{formatRole(user?.role)}</p>
              </div>
            </div>
          )}
        </div>
      </aside>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close navigation"
          />
          <aside className="absolute inset-y-0 left-0 flex w-[min(84vw,300px)] flex-col border-r border-blue-200/10 bg-[#08152B] p-4 shadow-2xl">
            <div className="mb-5 flex h-10 items-center justify-between border-b border-blue-200/[0.08] pb-4">
              <Link to="/" onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-2.5 text-sm font-semibold text-white">
                <ShieldCheck className="text-blue-300" size={19} /> BrandGuard <span className="-ml-2 text-blue-300">AI</span>
              </Link>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-white/[0.06] hover:text-white"
                aria-label="Close navigation"
              >
                <X size={18} />
              </button>
            </div>
            <nav aria-label="Mobile navigation" className="min-h-0 flex-1 space-y-1 overflow-y-auto">
              {renderNavigation()}
            </nav>
            <div className="mt-3 flex items-center justify-between border-t border-blue-200/[0.08] pt-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-blue-300/15 bg-blue-500/10 text-[11px] font-semibold text-blue-200">{initials}</div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-slate-200">{userName}</p>
                  <p className="truncate text-[10px] capitalize text-slate-500">{formatRole(user?.role)}</p>
                </div>
              </div>
              <button type="button" onClick={signOut} className="rounded-lg p-2 text-slate-500 hover:bg-white/[0.06] hover:text-rose-300" aria-label="Sign out">
                <LogOut size={16} />
              </button>
            </div>
          </aside>
        </div>
      )}

      <div className={`flex min-h-screen min-w-0 flex-col transition-[margin] duration-200 ${sidebarCollapsed ? "md:ml-[76px]" : "md:ml-[252px]"}`}>
        <header className="sticky top-0 z-20 flex h-[68px] items-center gap-3 border-b border-blue-200/[0.08] bg-[#08152B]/80 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className="-ml-1 rounded-lg p-2 text-slate-400 transition hover:bg-white/[0.06] hover:text-white md:hidden"
            aria-label="Open navigation menu"
          >
            <Menu size={19} />
          </button>

          <div className="hidden shrink-0 sm:block">
            <p className="text-[10px] font-medium uppercase tracking-[0.13em] text-slate-500">Workspace</p>
            <p className="mt-0.5 max-w-[150px] truncate text-xs font-medium text-slate-300">{currentPage}</p>
          </div>

          <div ref={searchPanelRef} className="relative min-w-0 flex-1 sm:ml-auto sm:max-w-[340px] md:ml-0 lg:max-w-[400px]">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search pages…"
              aria-label="Search workspace pages"
              aria-expanded={searchOpen}
              className="h-9 w-full rounded-xl border border-blue-200/[0.1] bg-[#0B1A31]/80 pl-9 pr-16 text-xs text-slate-200 outline-none transition placeholder:text-slate-500 hover:border-blue-200/20 focus:border-blue-400/40 focus:ring-2 focus:ring-blue-500/10"
            />
            <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 rounded-md border border-blue-100/10 bg-white/[0.035] px-1.5 py-0.5 text-[9px] font-medium text-slate-500">
              <Command size={10} /> K
            </kbd>
            {searchOpen && (
              <div className="absolute left-0 right-0 top-11 z-50 overflow-hidden rounded-xl border border-blue-200/10 bg-[#0C1A30] p-1.5 shadow-2xl shadow-black/40">
                <p className="px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  {query.trim() ? "Pages" : "Quick navigation"}
                </p>
                {searchResults.length ? searchResults.map(({ to, label, icon: Icon }) => (
                  <button
                    key={to}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => openSearchResult(to)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-slate-300 transition hover:bg-blue-500/10 hover:text-white"
                  >
                    <Icon size={14} className="text-slate-500" />
                    {label}
                  </button>
                )) : (
                  <p className="px-2.5 py-3 text-xs text-slate-500">No matching pages.</p>
                )}
              </div>
            )}
          </div>

          <div className="ml-auto hidden min-w-0 items-center gap-2 rounded-xl border border-blue-200/[0.08] bg-white/[0.025] px-2.5 py-2 sm:flex" title={organizationName}>
            <Building2 size={14} className="shrink-0 text-blue-300/80" />
            <span className="max-w-[160px] truncate text-[11px] font-medium text-slate-300">{organizationName}</span>
          </div>

          <Link
            to="/reviews"
            className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-200/[0.08] text-slate-400 transition hover:border-blue-300/20 hover:bg-white/[0.04] hover:text-slate-100"
            aria-label={pendingCount ? `${pendingCount} pending reviews` : "Review center"}
            title={pendingCount ? `${pendingCount} pending reviews` : "Review center"}
          >
            <Bell size={17} />
            {pendingCount > 0 && <span className="absolute -right-1 -top-1 flex h-[17px] min-w-[17px] items-center justify-center rounded-full border-2 border-[#08152B] bg-blue-500 px-1 text-[9px] font-semibold text-white">{pendingCount > 99 ? "99+" : pendingCount}</span>}
          </Link>

          <div className="relative shrink-0" ref={profileRef}>
            <button
              type="button"
              onClick={() => setProfileOpen((open) => !open)}
              aria-expanded={profileOpen}
              aria-label="Open user menu"
              className="flex items-center gap-2 rounded-xl p-1 transition hover:bg-white/[0.04]"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-blue-300/20 bg-gradient-to-br from-blue-500/20 to-violet-500/15 text-[11px] font-semibold text-blue-100">{initials}</span>
              <ChevronDown size={13} className={`hidden text-slate-500 transition sm:block ${profileOpen ? "rotate-180" : ""}`} />
            </button>
            {profileOpen && (
              <div className="absolute right-0 top-11 z-50 w-60 rounded-xl border border-blue-200/10 bg-[#0C1A30] p-2 shadow-2xl shadow-black/40">
                <div className="border-b border-blue-200/[0.08] px-2.5 pb-2.5 pt-1">
                  <p className="truncate text-xs font-medium text-slate-100">{userName}</p>
                  {user?.email && <p className="mt-0.5 truncate text-[10px] text-slate-500">{user.email}</p>}
                  <p className="mt-1 text-[10px] capitalize text-slate-500">{formatRole(user?.role)}</p>
                </div>
                <Link to="/settings" onClick={() => setProfileOpen(false)} className="mt-1 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs text-slate-300 hover:bg-white/[0.05] hover:text-white">
                  <UserRound size={14} className="text-slate-500" /> Account settings
                </Link>
                <button type="button" onClick={signOut} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-slate-300 hover:bg-rose-500/10 hover:text-rose-200">
                  <LogOut size={14} /> Sign out
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1760px] flex-1 p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
