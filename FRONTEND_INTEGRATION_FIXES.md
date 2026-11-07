# BrandGuard AI frontend integration fixes

## Changes

- Replaced the global 5-second Axios timeout with environment-configurable settings:
  - `VITE_API_TIMEOUT_MS` — default 15,000 ms for normal requests.
  - `VITE_AI_REQUEST_TIMEOUT_MS` — default 130,000 ms for analysis and Gemini-backed correction suggestions. This exceeds the backend's documented maximum Gemini call timeout of 120,000 ms.
- Kept the existing Axios bearer-token request interceptor and auth token storage behavior.
- Added build-time production validation for `VITE_API_BASE_URL`. Production builds require a valid HTTPS backend origin, reject localhost and non-origin paths, and explain the required configuration when invalid. Production API requests therefore cannot silently fall back to the Vercel SPA origin.
- Preserved the Vite development proxy. `VITE_API_PROXY_TARGET` is now loaded from Vite environment files, and `/docs`, `/openapi.json`, and `/redoc` use that same development proxy. The in-app API documentation link uses the configured backend origin in production and the proxied `/docs` path in development.
- Improved error messages for network failures, request timeouts, unauthorized/forbidden responses, rate limits (including `Retry-After`), and server errors. Backend `detail` messages and validation messages are retained when present.
- AI timeout messages now say that the server may still finish processing and recommend checking history before retrying. Partial analysis and suggestion-source behavior remain as provided by the backend; the frontend does not substitute mock or synthetic data.
- Added synchronous in-flight guards for content upload/analysis actions and per-finding correction generation/decision actions to prevent rapid duplicate submissions. Long-running AI buttons show an analysis/generation progress state; all busy states clear in `finally` blocks.
- Added `frontend/.env.example`, documented Vercel and local development configuration in `README.md`, and refreshed timeout/base URL details in `FRONTEND_API_CONTRACT.md`.
- Added Node's built-in test runner for API configuration and error handling.

## API contract compatibility

Compared the frontend's API call sites with `FRONTEND_API_CONTRACT.md` and the existing backend route definitions. Existing frontend methods, paths, query usage, multipart field names, and JSON payload shapes are unchanged and remain compatible. Optional backend routes not currently called by the frontend remain available. No backend route, schema, or response behavior was changed.

This is a source-level compatibility review and client configuration test, not a live backend integration test.

## Verification

- `npm test` from `frontend`: **8 passed**.
- `VITE_API_BASE_URL=https://api.example.com npm run build` from `frontend`: **passed**.
- `npm run build` without `VITE_API_BASE_URL`: **failed as intended** with an explicit instruction to configure the HTTPS backend origin.
- Confirmed `frontend/src` contains no hardcoded `localhost:8000` API/docs link; localhost remains only as the Vite development proxy default.

## Remaining integration risks

- Configure the actual backend HTTPS origin as `VITE_API_BASE_URL` in Vercel. No deployment was performed.
- A browser-side AI timeout cannot cancel already-started backend work; the UI warns users to check history before retrying, but an eventual response may still be lost to that browser request.
- `VITE_API_TIMEOUT_MS` and `VITE_AI_REQUEST_TIMEOUT_MS` must be configured consistently with the hosting platform's request/runtime limits. The defaults do not prove Gemini or hosted deployment availability.
- The Vite proxy default targets local `http://localhost:8000` for development only. Set `VITE_API_PROXY_TARGET` in `frontend/.env.local` for a different local backend.
- No live Gemini, PostgreSQL, Render, or Vercel integration was tested or claimed.
