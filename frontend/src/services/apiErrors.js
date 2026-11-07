function responseDetail(error) {
  const detail = error?.response?.data?.detail;
  if (Array.isArray(detail)) {
    return detail.map((item) => item?.msg).filter(Boolean).join("; ");
  }
  return typeof detail === "string" ? detail : "";
}

export function getErrorMessage(
  error,
  fallback = "The request could not be completed.",
  { timeoutMessage } = {},
) {
  const detail = responseDetail(error);
  const status = error?.response?.status;
  if (detail) {
    const retryAfter = error?.response?.headers?.["retry-after"];
    return status === 429 && retryAfter
      ? `${detail} Try again in ${retryAfter} seconds.`
      : detail;
  }

  if (
    error?.code === "ECONNABORTED" ||
    error?.code === "ETIMEDOUT" ||
    /timeout/i.test(error?.message || "")
  ) {
    return timeoutMessage || "The request timed out. Please try again.";
  }
  if (status === 401) return "Your session has expired. Sign in again to continue.";
  if (status === 403) return "You do not have permission to perform this action.";
  if (status === 429) {
    return "Too many requests. Wait a moment and try again.";
  }
  if (status >= 500) return "The server is temporarily unavailable. Please try again later.";
  if (status) return fallback;
  if (error?.code === "ERR_NETWORK" || error?.request) {
    return "Could not reach the server. Check your connection and API configuration, then try again.";
  }
  return fallback;
}
