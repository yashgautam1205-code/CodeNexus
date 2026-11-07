# BrandGuard AI frontend API contract

This contract reflects the FastAPI routes and Pydantic response/request models currently registered in `backend/app/main.py`. JSON uses `snake_case`; timestamps are ISO-8601 datetime strings. Unless stated otherwise, errors use FastAPI's JSON envelope:

```json
{"detail": "Human-readable message"}
```

Request validation errors use `422` with `detail` as an array of objects containing `loc`, `msg`, and `type`. The frontend's `getErrorMessage` joins validation messages and displays string `detail` values.

## Base URL, authentication, and loading

- The Axios client uses `VITE_API_BASE_URL` as `baseURL`, sends normal requests with configurable `VITE_API_TIMEOUT_MS` (default 15 seconds), sends Gemini-backed analysis/suggestion requests with configurable `VITE_AI_REQUEST_TIMEOUT_MS` (default 130 seconds), and attaches the saved access token as an HTTP bearer token. Both timeout settings are in milliseconds. Token storage key: `brandguard.accessToken`.
- Local development relies on Vite's `/api` proxy to `http://localhost:8000`; override its target with `VITE_API_PROXY_TARGET`.
- Production must set `VITE_API_BASE_URL` to the backend HTTPS origin, with no path or `/api` suffix. Production builds fail with a configuration error if it is missing or points to a non-HTTPS/local URL. If this check were absent, requests could go to the Vercel frontend origin, where the catch-all rewrite serves `index.html`, not the API.
- Protected routes require `Authorization: Bearer <access_token>`. Tokens are returned by register/login and expire after the configured lifetime (60 minutes by default). Invalid, expired, missing, or inactive-user tokens return `401`.
- Public routes: `GET /`, `GET /api/health`, `GET /api/health/database`, `POST /api/auth/register`, and `POST /api/auth/login`. All other routes require authentication.
- Auth restoration calls `GET /api/auth/me`; the app shows its startup loading state until this finishes. Data pages show route-specific loading indicators. Mutations generally disable the associated button and show action-specific progress text; request errors are shown inline. Dashboard filter reloads, review-history loads, and several action handlers do not consistently show a dedicated loading indicator.
- The default AI request timeout (130 seconds) exceeds the backend Gemini timeout maximum (120 seconds). A caller may configure it lower; if it expires, the UI warns that server-side processing may still complete and recommends checking history before retrying.

## Roles and permissions

Role values: `admin`, `brand_manager`, `content_creator`, `reviewer`.

| Capability | Allowed roles |
|---|---|
| Register first organisation administrator | Public registration; new account receives `admin` |
| Create/list organisation users | `admin` |
| Upload/manage guidelines and rules, approve rules, rebuild retrieval index | `admin`, `brand_manager` |
| Upload/read content, run/read analysis, create/decide correction suggestions, view dashboard | Any authenticated role |
| Approve/reject/request revision on content | `admin`, `brand_manager`, `reviewer` |
| Read review history | Any authenticated role |

Organisation-scoped records are filtered using the authenticated user's organisation. A role failure returns `403`; a record outside the user's organisation is normally indistinguishable from a missing record and returns `404`.

## Shared response schemas

### User

`UserRead`: `id`, `organization_id`, `organization_name`, `email`, `full_name`, `role`.

`AuthResponse`: `access_token`, `token_type` (always `"bearer"`), `user` (`UserRead`).

### Guideline and rule

`GuidelineRead`: `id`, `filename`, `title`, `status`, `version_number`, `supersedes_guideline_id` (nullable), `extracted_text`, `created_at`. Uploads initially have status `needs_review`; only approved rules, not raw guideline text, are authoritative analysis knowledge.

`RuleRead`: `id`, `guideline_id` (nullable), `term` (nullable), `category`, `title`, `rule_text`, `source_section` (nullable), `source_page` (nullable), `replacement_text` (nullable), `approved`, `approved_at` (nullable), `created_at`, `updated_at`.

Rule categories: `tone_of_voice`, `approved_terminology`, `prohibited_terminology`, `brand_messaging`, `product_information`, `marketing_claims`, `communication_guidelines`, `required_disclaimers`.

### Content, analysis, evidence

`ContentRead`: `id`, `filename`, `extracted_text`, `status`, `review_status`, `created_at`. Review statuses are `pending`, `approved`, `rejected`, `revision_requested`.

`AnalysisRead`: `id`, `submission_id`, `compliance_score`, `analysis_status`, `analysis_note` (nullable), `score_formula`, `created_at`, `findings` (array).

Each finding has: `id`, `category`, `affected_text`, `explanation`, `severity` (`critical|high|medium|low`), `confidence` (0–1), `evidence_status` (`supported|contradicted|no_source_found|needs_verification`), `evidence_text` (nullable), `guideline_id` (nullable), `guideline_title` (nullable), `source_section` (nullable), `source_page` (nullable), `suggested_correction` (nullable). Analysis may return HTTP 200 with `analysis_status: "partial"` and an explanatory `analysis_note` when AI or retrieval is unavailable; this is not a successful Gemini result.

### Suggestions and review

`SuggestionRead`: `id`, `violation_id`, `original_text`, `suggested_text`, `decision` (`pending|accepted|rejected|edited`), `generation_source` (`gemini|deterministic|fallback`, nullable), `created_at`.

`ReviewRead`: `id`, `submission_id`, `reviewer_id`, `decision` (`approve|reject|request_revision`), `previous_status`, `new_status`, `comment` (nullable), `created_at`.

### Dashboard

`DashboardOverview`: `total_submissions`, `analyzed_submissions`, `pending_reviews`, `approved_content`, `rejected_content`, `total_violations` (integers); `severity_distribution` (severity-to-count object); `compliance_trend` (array of `{date, average_score}`); `recent_activities` (array of `{id, action, entity_type, entity_id, actor_name, created_at}`).

## Endpoint contract

All routes below are available on the backend. `204` responses have no response body.

### Health and authentication

| Method and path | Request | Response | Access and relevant errors |
|---|---|---|---|
| `GET /` | None | `{name, docs, health}` | Public |
| `GET /api/health` | None | `{status: "ok", service: "brandguard-api"}` | Public liveness |
| `GET /api/health/database` | None | `{status: "ok", database: "connected"}` | Public; `503` if DB unavailable |
| `POST /api/auth/register` | JSON `{organization_name, full_name, email, password}`; names 2–160 chars, password 12–128 chars | `201 AuthResponse` | Public; `409` duplicate email; `422` invalid input; `429` rate limit |
| `POST /api/auth/login` | JSON `{email, password}`; password 1–128 chars | `200 AuthResponse` | Public; `401` incorrect credentials; `422`; `429` |
| `GET /api/auth/me` | None | `UserRead` | Authenticated; `401` |
| `GET /api/auth/users` | None | `UserRead[]` | Admin; `401`, `403` |
| `POST /api/auth/users` | JSON `{full_name, email, password, role}`; password 12–128 chars | `201 UserRead` | Admin; user belongs to caller's organisation; `409`, `422`, `401`, `403` |

### Guideline and rule management

| Method and path | Request | Response | Access and relevant errors |
|---|---|---|---|
| `POST /api/guidelines/upload` | Multipart `file`; optional multipart `supersedes_guideline_id` | `201 GuidelineRead` | Admin/brand manager; PDF/DOCX/TXT, max 10 MiB; `401`, `403`, `404` prior version, `413`, `415`, `422`, `429`, `503` scanner unavailable |
| `GET /api/guidelines` | None | `GuidelineRead[]` | Authenticated |
| `GET /api/guidelines/{guideline_id}` | None | `GuidelineRead` | Authenticated; `404` |
| `GET /api/guidelines/{guideline_id}/file` | None | Original file (binary; use Axios `responseType: "blob"`) | Authenticated; `404` guideline/file, `500` invalid stored path |
| `PUT /api/guidelines/{guideline_id}` | JSON `{title}`; 2–200 chars | `GuidelineRead` | Admin/brand manager; `404`, `422` |
| `DELETE /api/guidelines/{guideline_id}` | None | `204` | Admin/brand manager; `404`, `500` invalid path, `503` cleanup/index failure after deletion |
| `POST /api/guidelines/{guideline_id}/extract-rules` | No body | `201 RuleRead[]` | Admin/brand manager; creates draft candidates; `404` |
| `GET /api/rules` | Optional query `approved=true|false` | `RuleRead[]` | Authenticated |
| `POST /api/rules` | JSON `{category, title, rule_text, guideline_id?, term?, source_section?, source_page?, replacement_text?}`; title 2–200, rule text 2–5000 | `201 RuleRead` | Admin/brand manager; new rule is a draft by default; `404` invalid guideline; `422` |
| `GET /api/rules/{rule_id}` | None | `RuleRead` | Authenticated; `404` |
| `PUT /api/rules/{rule_id}` | Partial JSON of rule fields; `approved?` boolean may be included | `RuleRead` | Admin/brand manager; `404`, `422`, `503` retrieval index update failure |
| `DELETE /api/rules/{rule_id}` | None | `204` | Admin/brand manager; `404`, `503` retrieval vector cleanup failure after deletion |
| `POST /api/rules/reindex` | No body | `202 {indexed_rules: integer}` | Admin/brand manager; only approved rules indexed; `503` on index failure |

### Content, analysis, and corrections

| Method and path | Request | Response | Access and relevant errors |
|---|---|---|---|
| `POST /api/content/upload` | Multipart `file` | `201 ContentRead` | Authenticated; PDF/DOCX/TXT, max 10 MiB; `401`, `413`, `415`, `422`, `429`, `503` scanner unavailable |
| `GET /api/content` | Optional `limit` (default 50, 1–100), `offset` (default 0, >=0) | `ContentRead[]` | Authenticated; organisation-scoped |
| `GET /api/content/{submission_id}` | None | `ContentRead` | Authenticated; `404` |
| `POST /api/analysis/{content_id}/run` | No body | `AnalysisRead` | Authenticated; `404`, `422` if extracted text is empty, `429`; partial analysis is represented in the response, not as an HTTP error |
| `GET /api/analysis` | Optional `limit` (default 50, 1–100), `offset` (default 0, >=0) | `AnalysisRead[]` | Authenticated |
| `GET /api/analysis/{analysis_id}` | None | `AnalysisRead` | Authenticated; `404` |
| `GET /api/analysis/{analysis_id}/report` | None | `AnalysisRead` | Authenticated; `404`; same schema as analysis detail |
| `POST /api/findings/{finding_id}/suggest` | No body | `201 SuggestionRead` | Authenticated; `404`; source is explicit in `generation_source` |
| `POST /api/suggestions/{suggestion_id}/decision` | JSON `{decision: "accepted"|"rejected"|"edited", suggested_text?}`; edited requires non-empty text, max 8000 chars | `SuggestionRead` | Authenticated; `404`, `422` |

### Human review

`ReviewDecision` is JSON `{comment?: string|null}`; comment max 2000 characters. Approval body may be omitted and comment is optional. Reject and request-revision require a non-empty comment.

| Method and path | Request | Response | Access and relevant errors |
|---|---|---|---|
| `POST /api/reviews/{content_id}/approve` | Optional `ReviewDecision` | `ReviewRead` | Admin/brand manager/reviewer; `404` |
| `POST /api/reviews/{content_id}/reject` | `ReviewDecision` with non-empty comment | `ReviewRead` | Admin/brand manager/reviewer; `404`, `422` |
| `POST /api/reviews/{content_id}/request-revision` | `ReviewDecision` with non-empty comment | `ReviewRead` | Admin/brand manager/reviewer; `404`, `422` |
| `GET /api/reviews/{content_id}/history` | None | `ReviewRead[]`, newest first | Authenticated; `404` submission |

### Dashboard

Both dashboard routes accept `days` (default 30, 1–365), optional `review_status` (`pending|approved|rejected|revision_requested`), and optional `severity` (`critical|high|medium|low`). Invalid filters return `422`. `severity` filters findings; submission totals/status counts still reflect the selected date range/status, not severity.

| Method and path | Response | Access |
|---|---|---|
| `GET /api/dashboard/overview` | `DashboardOverview` | Authenticated |
| `GET /api/dashboard/analytics` | `{issue_categories: {category: count}, severity_distribution: {severity: count}, compliance_trend: [{date, average_score}]}` | Authenticated |

## Frontend integration findings and readiness

The existing frontend calls match the corresponding backend paths, methods, and payloads for login/register, user management, content uploads/listing, analysis/report retrieval, correction decisions, guideline/rule management, index reindexing, reviews/history, and dashboard overview. The frontend also supplies `supersedes_guideline_id` when linking guideline versions. It does not currently call `GET /api/dashboard/analytics`, `GET /api/content/{id}`, `GET /api/guidelines/{id}`, `GET /api/rules/{id}`, or `GET /api/analysis/{id}/report`; these are available for future integration.

Before frontend refinement or deployment:

1. **Set the Vercel API origin.** Production builds now require `VITE_API_BASE_URL`; missing or unsafe values fail the build rather than sending API requests to the SPA.
2. **Keep the 10 MiB upload limit aligned.** The frontend checks 10 MiB and the backend defaults to the same limit. If `MAX_UPLOAD_SIZE_BYTES` is overridden, update the frontend copy/check to match.
3. **Treat analysis as complete only when `analysis_status === "complete"`.** Partial reports carry `analysis_note`; do not infer Gemini success from HTTP 200.
4. **Account for rate limits.** HTTP 429 responses include `Retry-After`; the frontend preserves the backend message and includes the wait duration.
5. **Use safe multipart handling.** Upload fields are named `file`; guideline version linking uses the additional form field `supersedes_guideline_id`.

Backend contract readiness: all routes listed above are implemented and have typed request/response behavior as documented. This is a source-level contract review, not a live PostgreSQL, Gemini, Render, or Vercel integration test. Live service/deployment verification remains outstanding.
