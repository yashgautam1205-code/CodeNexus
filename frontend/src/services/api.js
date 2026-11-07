import axios from "axios";
import { getErrorMessage } from "./apiErrors";
import { resolveApiConfig } from "./apiConfig";

const apiConfig = resolveApiConfig({
  production: import.meta.env.PROD,
  baseUrl: import.meta.env.VITE_API_BASE_URL,
  apiTimeoutMs: import.meta.env.VITE_API_TIMEOUT_MS,
  aiRequestTimeoutMs: import.meta.env.VITE_AI_REQUEST_TIMEOUT_MS,
});

export const api = axios.create({
  baseURL: apiConfig.baseURL,
  timeout: apiConfig.timeout,
});

export const AI_REQUEST_TIMEOUT_MS = apiConfig.aiRequestTimeout;
export const API_DOCS_URL = apiConfig.baseURL ? `${apiConfig.baseURL}/docs` : "/docs";

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("brandguard.accessToken");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export async function fetchHealth() {
  const { data } = await api.get("/api/health");
  return data;
}

export { getErrorMessage };
