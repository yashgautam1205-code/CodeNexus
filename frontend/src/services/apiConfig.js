const DEFAULT_API_TIMEOUT_MS = 15_000;
const DEFAULT_AI_REQUEST_TIMEOUT_MS = 240_000;
const MAX_TIMEOUT_MS = 300_000;

export const LOGIN_REQUEST_TIMEOUT_MS = 90_000;

function timeoutValue(name, value, defaultValue) {
  if (value === undefined || value === "") return defaultValue;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > MAX_TIMEOUT_MS) {
    throw new Error(`${name} must be an integer between 1000 and ${MAX_TIMEOUT_MS}.`);
  }
  return parsed;
}

export function resolveApiConfig({
  production = false,
  baseUrl = "",
  apiTimeoutMs,
  aiRequestTimeoutMs,
} = {}) {
  const configuredBaseUrl = String(baseUrl || "").trim();
  let resolvedBaseUrl = configuredBaseUrl;

  if (production) {
    if (!configuredBaseUrl) {
      throw new Error(
        "VITE_API_BASE_URL is required for production builds. Set it to the HTTPS backend origin without an /api suffix.",
      );
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(configuredBaseUrl);
    } catch {
      throw new Error("VITE_API_BASE_URL must be an absolute HTTPS backend origin.");
    }

    const localHostname =
      parsedUrl.hostname === "localhost" ||
      parsedUrl.hostname.endsWith(".localhost") ||
      parsedUrl.hostname === "::1" ||
      parsedUrl.hostname === "[::1]" ||
      /^127\./.test(parsedUrl.hostname);
    if (
      parsedUrl.protocol !== "https:" ||
      localHostname ||
      parsedUrl.username ||
      parsedUrl.password ||
      (parsedUrl.pathname !== "" && parsedUrl.pathname !== "/") ||
      parsedUrl.search ||
      parsedUrl.hash
    ) {
      throw new Error(
        "VITE_API_BASE_URL must be an HTTPS backend origin without credentials, a path, query, or fragment.",
      );
    }
    resolvedBaseUrl = parsedUrl.origin;
  }

  return {
    baseURL: resolvedBaseUrl.replace(/\/+$/, ""),
    timeout: timeoutValue("VITE_API_TIMEOUT_MS", apiTimeoutMs, DEFAULT_API_TIMEOUT_MS),
    aiRequestTimeout: timeoutValue(
      "VITE_AI_REQUEST_TIMEOUT_MS",
      aiRequestTimeoutMs,
      DEFAULT_AI_REQUEST_TIMEOUT_MS,
    ),
  };
}
