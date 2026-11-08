import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../services/api";
import { LOGIN_REQUEST_TIMEOUT_MS } from "../services/apiConfig";

const AuthContext = createContext(null);
const TOKEN_KEY = "brandguard.accessToken";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setLoading(false);
      return;
    }
    api.get("/api/auth/me")
      .then(({ data }) => setUser(data))
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  async function authenticate(path, payload, config) {
    const { data } = await api.post(path, payload, config);
    localStorage.setItem(TOKEN_KEY, data.access_token);
    setUser(data.user);
    return data.user;
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
  }

  const value = useMemo(() => ({
    user,
    loading,
    login: (payload) =>
      authenticate("/api/auth/login", payload, { timeout: LOGIN_REQUEST_TIMEOUT_MS }),
    register: (payload) => authenticate("/api/auth/register", payload),
    logout,
  }), [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider.");
  return context;
}
