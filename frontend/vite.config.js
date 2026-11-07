import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolveApiConfig } from "./src/services/apiConfig.js";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || "http://localhost:8000";
  const configuredApiBaseUrl = (env.VITE_API_BASE_URL || "").trim();

  // Local builds can rely on the Vite proxy without a hardened production origin.
  // Production deployments should set VITE_API_BASE_URL explicitly so the origin is
  // validated and fixed at build time.
  if (mode === "production" && configuredApiBaseUrl) {
    resolveApiConfig({
      production: true,
      baseUrl: configuredApiBaseUrl,
      apiTimeoutMs: env.VITE_API_TIMEOUT_MS,
      aiRequestTimeoutMs: env.VITE_AI_REQUEST_TIMEOUT_MS,
    });
  }

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": apiProxyTarget,
        "/docs": apiProxyTarget,
        "/openapi.json": apiProxyTarget,
        "/redoc": apiProxyTarget,
      },
    },
  };
});
