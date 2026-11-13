# BrandGuard AI frontend API contract

This contract reflects the FastAPI routes and Pydantic response/request models currently registered in `backend/app/main.py`. JSON uses `snake_case`; timestamps are ISO-8601 datetime strings. Unless stated otherwise, errors use FastAPI's JSON envelope:

```json
{"detail": "Human-readable message"}
```

Request validation errors use `422` with `detail` as an array of objects containing `loc`, `msg`, and `type`. The frontend's `getErrorMessage` joins validation messages and displays string `detail` values.

## Base URL, authentication, and loading

- The Axios client uses `VITE_API_BASE_URL` as `baseURL`, sends normal requests with configurable `VITE_API_TIMEOUT_MS` (default 15 seconds), sends Gemini-backed analysis/suggestion requests with configurable `VITE_AI_REQUEST_TIMEOUT_MS` (default 240 seconds), and attaches the saved access token as an HTTP bearer token. Both timeout settings are in milliseconds. Token storage key: `brandguard.accessToken`.
- Local development relies on Vite's `/api` proxy to `http://localhost:8000`; override its target with `VITE_API_PROXY_TARGET`.
- Production must set `VITE_API_BASE_URL` to the backend HTTPS origin, with no path or `/api` suffix. Production builds fail with a configuration error if it is missing or points to a non-HTTPS/local URL. If this check were absent, requests could go to the Vercel frontend origin, where the catch-all rewrite serves `index.html`, not the API.
- Protected routes require `Authorization: Bearer <access_token>`. Tokens are returned by register/login and expire after the configured lifetime (60 minutes by default). Invalid, expired, missing, or inactive-user tokens return `401`.
- Public routes: `GET /`, `GET /api/health`, `GET /api/health/database`, `POST /api/auth/register`, and `POST /api/auth/login`. All other routes require authentication.
- Auth restoration calls `GET /api/auth/me`; the app shows its startup loading state until this finishes. Data pages show route-specific loading indicators. Mutations generally disable the associated button and show action-specific progress text; request errors are shown inline. Dashboard filter reloads use a loading state.
- The default AI request timeout is 240 seconds to allow bounded Gemini retry/fallback processing. A caller may configure it lower; if it expires, the UI warns that server-side processing may still complete and recommends checking history before retrying. Each Gemini HTTP attempt is independently bounded by `GEMINI_TIMEOUT_MS`.

## Roles and permissions

Role values: `admin`, `brand_manager`, `content_creator`, `reviewer`.

| Capability | Allowed roles |
|---|---|
| Register first organisation administrator | Public registration; new account receives `admin` |
| Create/list organisation users | `admin` |
| Upload/manage guidelines and rules, approve rules, rebuild retrieval index | `admin`, `brand_manager` |
| Upload/read content, run/read analysis, create/decide correction suggestions, view dashboard | Any authenticated role |
| Approve/reject/request revision on content | `admin`, `brand_manager`, `reviewer` |
| Review claim-verification results and visual analyses | `admin`, `brand_manager`, `reviewer` |
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

`AnalysisRead`: `id`, `submission_id`, `compliance_score`, `analysis_status`, `analysis_note` (nullable), `score_formula`, `created_at`, `findings` (array), `claim_verifications` (array), and `visual_analyses` (array). Each persisted claim result includes `claim_type`, `time_sensitive`, canonical machine `status` (`supported|contradicted|insufficient_evidence|needs_review`), confidence, retrieval/assessment status, assessment model, source-backed assessment rationale and selected source ids, sanitized assessment error type/status code, last verification time, cited evidence metadata, and separate `review_status`/`review_history`. Assessment rationale is stored only when at least one selected source id matches a retrieved, sufficiently relevant citation. Human decisions never overwrite the machine status. Linked visual reports include their findings, evidence, confidence, provider status/model, review status, and review history. Older persisted claim statuses are normalized by the current migration; legacy analysis-finding `evidence_status` still uses its own `no_source_found|needs_verification` vocabulary.

Each finding has: `id`, `category`, `affected_text`, `explanation`, `severity` (`critical|high|medium|low`), `confidence` (0–1), `evidence_status` (`supported|contradicted|no_source_found|needs_verification`), `evidence_text` (nullable), `guideline_id` (nullable), `guideline_title` (nullable), `source_section` (nullable), `source_page` (nullable), `suggested_correction` (nullable). Analysis may return HTTP 200 with `analysis_status: "partial"` and an explanatory `analysis_note` when AI or retrieval is unavailable; this is not a successful Gemini result.

### Suggestions and review

`SuggestionRead`: `id`, `violation_id`, `original_text`, `suggested_text`, `decision` (`pending|accepted|rejected|edited`), `generation_source` (`gemini|deterministic|fallback`, nullable), `created_at`.

`ReviewRead`: `id`, `submission_id`, `reviewer_id`, `decision` (`approve|reject|request_revision`), `previous_status`, `new_status`, `comment` (nullable), `created_at`.

### Visual and external evidence

Visual analysis is persisted under the asset's organisation and includes per-finding evidence, confidence, provider status, palette status, and review status. Approved HEX palette rules and explicitly approved logo-reference assets are used as comparison evidence. High-variation images skip automated palette violations and set `palette_status` to `needs_verification`, with a warning for human review. Uncertain detections use `needs_verification`; no provider result is returned as a confirmed violation. Only admin/brand_manager users can approve visual reference assets. Admin, brand_manager, and reviewer roles can record visual review decisions; reject/revision decisions require a comment and each decision is retained in visual review history and audit logs.

Claim verification combines supplied evidence and approved organisation rules with optional configured external search results. Claim types are `objective_factual`, `statistical`, `product_performance`, `superiority`, and `subjective_marketing`. External citations are restricted to HTTPS URLs returned by the configured search provider; source ID selections not present in the retrieved result set are ignored. Publication/retrieval timestamps, publisher domain, and freshness state are retained when available. Credibility is a heuristic score, relevance is lexical overlap, and time-sensitive claims reject stale/unknown-dated sources for automated classification. `citation_valid` means the HTTPS URL matched a configured-provider result; it does not establish that the page is accessible or independently validate the claim. Provider failure remains unverified. Reviewer status and comments are stored separately.

`ReviewAssignmentRead`: assignment id, resource type (`content|visual|claim`), resource id/name, reviewer and assigner ids, reviewer name, status (`pending|completed|cancelled`), and assignment/completion timestamps. Reviewers see only their own assignments. When an item has a pending assignment, a reviewer assigned to a different person cannot decide it. Admins and brand managers may assign pending items; completing a review closes pending assignments for that resource.

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
| `POST /api/evidence/extract-claims` | JSON `{text}` | `{claims: [...]}` | Public extraction; no provider call |
| `POST /api/evidence/verify` | JSON `{text, evidence?: [...], submission_id?}` | `ClaimResult[]` with evidence/provider metadata | Authenticated; `submission_id`, if supplied, must belong to caller's organisation |

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
| `POST /api/evidence/{claim_verification_id}/review` | JSON `{decision: "approve"|"reject"|"request_additional_evidence", comment?}` | Updated `ClaimResult`, with unchanged AI status and appended review history | Admin/brand manager/reviewer; reject/additional-evidence decisions require a comment; `404`, `422` |
| `GET /api/review-assignments?status=pending` | Optional status (`pending|completed|cancelled`) and limit (1–500) | `ReviewAssignmentRead[]` | Admin/brand manager see organisation assignments; reviewer sees only own assignments |
| `GET /api/review-assignments/reviewers` | None | Active reviewer/admin/brand-manager identities | Admin/brand manager; organisation-scoped |
| `POST /api/review-assignments` | JSON `{resource_type: "content"|"visual"|"claim", resource_id, reviewer_id}` | `201 ReviewAssignmentRead` | Admin/brand manager; pending organisation-owned item only; previous pending assignment is cancelled; `404`, `409` |

### Visual assets

| Method and path | Request | Response | Access and relevant errors |
|---|---|---|---|
| `POST /api/brand-assets/upload` | Multipart `file`, optional `asset_kind` (`creative|logo_reference`, default `creative`) | `201 BrandAssetRead` (`approved: false`) | Authenticated; supported raster image, size/type validation |
| `PUT /api/brand-assets/{asset_id}/approve` | No body | `BrandAssetRead` | Admin/brand manager; org-scoped; `404` |
| `POST /api/brand-assets/{asset_id}/analyze` | Optional `submission_id` and `logo_required` query parameters | `VisualComplianceReport` | Authenticated; org-scoped; analysis/evidence is persisted and audited; when linked, appears in the unified analysis report |
| `GET /api/brand-assets/{asset_id}/analysis/latest` | None | Latest visual report, review state/history | Authenticated; org-scoped; `404` |
| `POST /api/brand-assets/{asset_id}/analysis/{analysis_id}/review` | JSON `{decision: "approve"|"reject"|"request_revision", comment?}` | Updated visual report and review history | Admin/brand manager/reviewer; reject/revision require comment |

### Dashboard

Both dashboard routes accept `days` (default 30, 1–365), `granularity` (`daily|weekly|monthly`), optional `review_status` (`pending|approved|rejected|revision_requested`), `severity` (`critical|high|medium|low`), `category` (up to 48 characters), and `reviewer_id`. Invalid filters return `422`. `severity` and `category` are violation-specific; shared date/status/reviewer filters scope content, claim, visual, and reviewer analytics. Reviewer filtering includes review history and pending assignments. `review_assignment_statistics` and reviewer workload include pending/completed/cancelled assignment counts.

| Method and path | Response | Access |
|---|---|---|
| `GET /api/dashboard/overview?days=30&review_status=approved&severity=high&category=unsupported_claim&reviewer_id={id}` | `DashboardOverview` | Authenticated |
| `GET /api/dashboard/analytics?days=30&granularity=weekly&review_status=approved&severity=high&category=unsupported_claim&reviewer_id={id}` | Includes issue/severity/compliance data, claim and visual trends, review workload/time, assignment statistics, and persisted decision breakdowns | Authenticated |

## Frontend integration findings and readiness

The content page hosts visual asset upload/approval/analysis/review and the review queue provides content assignment controls. The analysis report displays persisted claim assessments and separate human decisions; the assignment API also supports visual and claim records, but the browser does not yet expose their assignment controls. The dashboard exposes date/granularity, review-status, severity, category, and reviewer filters over persisted data. The frontend also supplies `supersedes_guideline_id` when linking guideline versions. It does not currently call `GET /api/content/{id}`, `GET /api/guidelines/{id}`, `GET /api/rules/{id}`, or `GET /api/analysis/{id}/report`; these remain available for future integration.

Before frontend refinement or deployment:

1. **Set the Vercel API origin.** Production builds now require `VITE_API_BASE_URL`; missing or unsafe values fail the build rather than sending API requests to the SPA.
2. **Keep the 10 MiB upload limit aligned.** The frontend checks 10 MiB and the backend defaults to the same limit. If `MAX_UPLOAD_SIZE_BYTES` is overridden, update the frontend copy/check to match.
3. **Treat analysis as complete only when `analysis_status === "complete"`.** Partial reports carry `analysis_note`; do not infer Gemini success from HTTP 200.
4. **Account for rate limits.** HTTP 429 responses include `Retry-After`; the frontend preserves the backend message and includes the wait duration.
5. **Use safe multipart handling.** Upload fields are named `file`; guideline version linking uses the additional form field `supersedes_guideline_id`.

Backend contract readiness: all routes listed above are implemented and have typed request/response behavior as documented. This is a source-level contract review, not a live PostgreSQL, Gemini, Render, or Vercel integration test. Live service/deployment verification remains outstanding.

## Production storage and deployment

The production backend requires `PERSISTENT_STORAGE_ROOT`, `UPLOAD_DIRECTORY`, and `CHROMA_PERSIST_DIRECTORY` to be explicit absolute paths. Upload and vector paths must be non-temporary and inside the configured root. Startup verifies that the root is an attached, writable filesystem mount; the application does not currently support object storage. The Render production blueprint mounts its disk at `/var/data/brandguard` and places uploads and Chroma data below it. The separate `render.demo.yaml` blueprint is ephemeral and rejects uploads. See the README Deployment section for PostgreSQL, ClamAV, secrets, Docker, and migration setup.
