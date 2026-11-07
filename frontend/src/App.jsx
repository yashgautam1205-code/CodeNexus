import { lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import AppLayout from "./layouts/AppLayout";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";

const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const GuidelinesPage = lazy(() => import("./pages/GuidelinesPage"));
const ContentPage = lazy(() => import("./pages/ContentPage"));
const AnalysisPage = lazy(() => import("./pages/AnalysisPage"));
const ReviewsPage = lazy(() => import("./pages/ReviewsPage"));
const AuditHistoryPage = lazy(() => import("./pages/AuditHistoryPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));

function ProtectedRoutes() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-navy-900 text-sm text-slate-400">
        Loading BrandGuard workspace…
      </div>
    );
  }
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}

function AnonymousRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-navy-900 text-sm text-slate-400">
        Loading…
      </div>
    );
  }
  return user ? <Navigate to="/" replace /> : children;
}

function AppRoutes() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-screen place-items-center bg-navy-900 text-sm text-slate-400">
          Loading workspace…
        </div>
      }
    >
      <Routes>
        <Route
          path="/login"
          element={
            <AnonymousRoute>
              <LoginPage />
            </AnonymousRoute>
          }
        />
        <Route
          path="/register"
          element={
            <AnonymousRoute>
              <RegisterPage />
            </AnonymousRoute>
          }
        />
        <Route element={<ProtectedRoutes />}>
          <Route element={<AppLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="/guidelines" element={<GuidelinesPage />} />
            <Route path="/content" element={<ContentPage />} />
            <Route path="/analysis" element={<AnalysisPage />} />
            <Route path="/analysis/:analysisId" element={<AnalysisPage />} />
            <Route path="/reviews" element={<ReviewsPage />} />
            <Route path="/audit" element={<AuditHistoryPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
