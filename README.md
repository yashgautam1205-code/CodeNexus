# BrandGuard AI

BrandGuard AI checks marketing content against organisation-approved brand rules. It provides source-linked findings, correction suggestions, and a human review history. It never publishes content automatically.

## Problem and solution

Marketing teams need to check content against brand guidance before publication, but policy documents are difficult to apply consistently. BrandGuard AI extracts source text, helps managers turn it into draft rules, retrieves only explicitly approved rules during analysis, and presents explainable findings for a person to decide. It is a governance aid, not legal certification or an external fact-checking service.

## Architecture

- **Frontend:** React/Vite SPA with protected routes, organisation workspace screens, Axios API calls, and Recharts dashboard visualisations.
- **Backend:** FastAPI routers and Pydantic schemas; SQLAlchemy services persist tenant-owned records and audit events.
- **Database:** PostgreSQL in production, SQLite for local development and tests; Alembic manages schema migrations.
- **Retrieval and AI:** ChromaDB stores approved rule chunks in per-organisation collections. Deterministic checks always run; Gemini analysis and correction generation are optional.
- **Files and deployment:** Original uploads are stored under organisation-specific directories. Docker/Render configuration provisions persistent storage; Vercel configuration supports the SPA.

## Database design

The schema separates organisations and users from guideline documents, brand rules, submissions, analysis results, violations, correction suggestions, approval history, audit logs, and brand assets. Tenant-owned rows carry an `organization_id`; API queries and vector collection selection apply that scope. Guideline versions are retained as separate records with a `supersedes_guideline_id` link. Review history records the prior and resulting submission status.

## AI and RAG workflow

1. Extract text from PDF, DOCX, or TXT while retaining page/section markers where available.
2. Suggest candidate rules from explicit directive-like source lines. Candidates remain drafts and are never authoritative without a manager's approval. PDF page markers and DOCX section headings are retained as rule provenance.
3. Index only approved rules; retrieval is restricted to the active organisation.
4. Run configured prohibited-term/disclaimer checks, then optionally send the content and retrieved approved rules to Gemini for structured analysis. Chroma results beyond the configured-in-code L2 distance cutoff are discarded.
5. Extract typed claim candidates (objective, statistical, performance, superiority, or subjective) and combine organisation-approved rule evidence with optional Tavily excerpts. Gemini can assess a bounded set of retrieved excerpts, but source IDs are restricted to actual provider results and URLs must be validated HTTPS URLs. Findings use `supported`, `contradicted`, `insufficient_evidence`, or `needs_review`; provider failure never implies falsity.
6. For uploaded visual assets, run connected-region palette analysis, layout heuristics, and optional Tesseract OCR with word boxes. Explicitly approved logo-reference assets can be compared with creatives using local feature/template matching; optional Gemini vision remains supplementary. Uncertain findings remain review-only.
7. Save findings, evidence references, claim/visual analysis records, reviewer assignments and decisions, and audit history. Original submissions are not overwritten.

## Implemented MVP

- Organisation registration, JWT login, Argon2 password hashing, role checks, and tenant-scoped API access.
- Admin-managed team accounts for admins, brand managers, content creators, and reviewers.
- PDF/DOCX/TXT guideline upload, safe organisation-specific file storage, text extraction, source preview, version linking, and guideline management.
- Source-derived draft rule extraction plus manual rule creation/edit/deletion. Rules remain non-authoritative until an admin or brand manager explicitly approves them.
- Content PDF/DOCX/TXT upload and extraction, submission history, and file-size/type validation.
- ChromaDB persistent vector index using Chroma's local `all-MiniLM-L6-v2` embedding function. Only approved rules are indexed; collections and query metadata are organisation-scoped.
- Deterministic prohibited-term and explicitly configured disclaimer checks, RAG-backed evidence, and optional Gemini structured analysis.
- Optional external claim-source retrieval through Tavily, with retrieved URL/snippet, publisher and publication-date metadata, configurable freshness windows, and source-ID citation validation. Internal approved rules remain an independent evidence source. A missing publication date is displayed as unknown, not invented.
- Visual asset analysis using connected palette regions, OpenCV logo matching, optional Tesseract OCR, and optional Gemini vision-language inspection. Approved HEX palette rules and explicitly approved logo-reference assets supply comparison evidence; high-variation images skip automated palette violations and require human verification.
- Persisted visual and claim findings, separate human claim-verification decisions/history, reviewer comments, and audit records surfaced in the existing content and unified analysis workflow.
- Pydantic-validated findings, evidence status, severity-weighted compliance score, correction suggestions, and saved accept/reject/edit decisions.
- Human approve/reject/request-revision workflow, reviewer comments, previous/new status history, tenant-scoped assignments for content, visual, and claim records, and audit history.
- Dashboard date-range, shared review-status and reviewer filters, violation-specific severity/category filters, daily/weekly/monthly trends, assignment counts, and decision breakdowns from persisted records. Organisation scope is fixed to the authenticated tenant.
- Alembic migrations, PostgreSQL support, SQLite local fallback, Docker configuration, Vercel SPA routing, and Render deployment blueprint.

The app reports **partial analysis** when Gemini or relevant approved evidence is unavailable. `insufficient_evidence` and `needs_review` are not treated as false. The compliance score is a review aid and is not certified legal or factual validation.

## Requirements

- Python 3.11+
- Node.js 20+
- PostgreSQL 15+ for deployment (SQLite is used when `DATABASE_URL` is unset for local development)
- Docker Desktop is optional for local PostgreSQL

## Configuration

Copy `.env.example` to `.env` in the repository root. The file is git-ignored. Set a long random `JWT_SECRET_KEY`; set `DATABASE_URL` to PostgreSQL for a shared or deployed instance. Do not commit `.env` or use placeholder values in production.

Set `ENVIRONMENT=development` for local work, `ENVIRONMENT=demo` for a hosted demo without ClamAV, or `ENVIRONMENT=production` for deployment. Demo mode can start without ClamAV, but both content and guideline upload endpoints return `503` and do not store files. Production requires a TLS-enabled PostgreSQL `DATABASE_URL` (`sslmode=require` or stronger), a unique `JWT_SECRET_KEY` of at least 32 characters, exact HTTPS `FRONTEND_URL` and `ALLOWED_ORIGINS`, a private reachable `CLAMAV_HOST`/`CLAMAV_PORT`, and `PERSISTENT_STORAGE_ROOT`, `UPLOAD_DIRECTORY`, and `CHROMA_PERSIST_DIRECTORY`. These three storage paths must be absolute, non-temporary, and uploads/vector data must be under the configured root. Startup fails unless that root is an attached writable filesystem mount. `CLAMAV_PORT` defaults to 3310 and `CLAMAV_TIMEOUT_SECONDS` to 10 seconds.

`GEMINI_API_KEY` is optional. `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `GEMINI_TIMEOUT_MS`, and `GEMINI_RETRY_ATTEMPTS` control the model, real-provider fallback, per-attempt timeout, and bounded retry count (default: 2 attempts). The fallback is another live Gemini model, not a local or mock result. Provider errors remain explicitly unavailable after configured models/retries are exhausted. For optional web retrieval, set `EXTERNAL_SEARCH_PROVIDER=tavily` and `TAVILY_API_KEY`; the default provider is disabled. `EXTERNAL_SEARCH_TIMEOUT_SECONDS`, `EXTERNAL_SEARCH_MAX_RESULTS`, and `EXTERNAL_CLAIM_LIMIT` bound requests. `EVIDENCE_FRESHNESS_DAYS` and `TIME_SENSITIVE_FRESHNESS_DAYS` set the freshness windows (defaults: 365 and 90 days). Set `TESSERACT_CMD` only when the Tesseract executable is outside the system path; the Docker image installs Tesseract OCR. When configured, claim text is sent to Tavily and excerpts plus claim text may be sent to Gemini; image bytes and approved logo-reference images may be sent to Gemini vision. Enable these integrations only when your organisation permits that processing. Without credentials or service availability, results remain unverified/partial. Copy `frontend/.env.example` to `frontend/.env.local` for Vite settings. Local development may leave `VITE_API_BASE_URL` empty and use the `/api` proxy; production builds require `VITE_API_BASE_URL` to be an HTTPS backend origin without an `/api` suffix. `VITE_API_TIMEOUT_MS` defaults to 15000 ms for normal calls; `VITE_AI_REQUEST_TIMEOUT_MS` defaults to 240000 ms for analysis and correction generation. Set these as Vercel project environment variables for production. Keep `.env` files out of source control.

For local PostgreSQL with Docker Compose, set `POSTGRES_PASSWORD` in your shell and make sure `DATABASE_URL` uses the same user and password. Never use these local credentials in production.

For local development, `UPLOAD_DIRECTORY` and `CHROMA_PERSIST_DIRECTORY` default to ignored local folders under the repository root. Production must explicitly override them with mounted durable paths and set `PERSISTENT_STORAGE_ROOT`; the app rejects missing, temporary, relative, or out-of-root paths and checks the volume at startup. Chroma's local default embedding model is `all-MiniLM-L6-v2`; the first indexing operation may download its model files.

## Run locally

Start the database if using PostgreSQL:

```powershell
$env:POSTGRES_PASSWORD = "your-local-only-password"
docker compose up -d db
```

Run backend commands from `backend`:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

Run the frontend in a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`, register the first organisation administrator, and upload a guideline. The first admin can add team accounts in **Settings**. Create and approve rules before submitting content for analysis.

The frontend uses the Vite `/api` proxy to `http://localhost:8000` in development. Set `VITE_API_PROXY_TARGET` in `frontend/.env.local` if the backend runs elsewhere. For deployment, set `VITE_API_BASE_URL` as a Vercel environment variable to the backend HTTPS origin (for example `https://brandguard-api.example.com`, with no path or `/api` suffix); the production build fails clearly if it is missing or unsafe. Configure `VITE_API_TIMEOUT_MS` and `VITE_AI_REQUEST_TIMEOUT_MS` in Vercel as needed. AI calls use the longer timeout and show a warning if the browser times out because the server may still finish processing.

## Tests and checks

From the repository root:

```powershell
.\backend\.venv\Scripts\python.exe -m pytest -q
cd frontend
npm run build
npm audit
```

The tests cover health checks and simulated database failure, authentication, guideline extraction and approval, content extraction, tenant isolation, retrieval relevance filtering, conservative AI evidence status, missing-AI partial status, correction provenance, human review transitions, candidate rules, version links, and filtered dashboard totals. Gemini network calls are not claimed as tested without a configured key.

## API

FastAPI Swagger UI: `http://localhost:8000/docs`

See [FRONTEND_API_CONTRACT.md](./FRONTEND_API_CONTRACT.md) for request/response schemas, authentication and role requirements, error behavior, loading states, frontend integration findings, and endpoint readiness.

Useful endpoints:

- `GET /api/health` and `GET /api/health/database`
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `POST /api/guidelines/upload`, `GET/PUT/DELETE /api/guidelines/{id}`, `POST /api/guidelines/{id}/extract-rules`
- `POST /api/rules`, `GET/PUT/DELETE /api/rules/{id}`, `POST /api/rules/reindex`
- `POST /api/content/upload`, `GET /api/content`
- `POST /api/analysis/{content_id}/run`, `GET /api/analysis/{analysis_id}`
- `POST /api/findings/{finding_id}/suggest`, `POST /api/suggestions/{id}/decision`
- `POST /api/reviews/{content_id}/approve|reject|request-revision`
- `POST /api/brand-assets/upload`, `GET /api/brand-assets`, `GET /api/brand-assets/{asset_id}`, `POST /api/brand-assets/{asset_id}/analyze?submission_id={content_id}` (optional link to the unified report)
- `PUT /api/brand-assets/{asset_id}/approve`, `POST /api/brand-assets/{asset_id}/analysis/{analysis_id}/review`, `GET /api/brand-assets/{asset_id}/analysis/latest`
- `POST /api/evidence/extract-claims`, `POST /api/evidence/verify`
- `POST /api/evidence/{claim_verification_id}/review`
- `GET /api/review-assignments`, `GET /api/review-assignments/reviewers`, `POST /api/review-assignments`
- `GET /api/dashboard/overview?days=30&review_status=approved&severity=high&category=unsupported_claim&reviewer_id={id}` and `GET /api/dashboard/analytics`

All non-health endpoints require a bearer token. Claim verification retains its AI/evidence status separately from reviewer decisions; only admin, brand-manager, and reviewer roles may record a decision. Organisation ownership is enforced in API queries and vector collection selection.

## Deployment

- **Vercel:** configure the project root as `frontend`; set `VITE_API_BASE_URL` to the deployed API HTTPS origin (scheme and host only, no `/api` suffix). Set `VITE_API_TIMEOUT_MS` (default 15000) and `VITE_AI_REQUEST_TIMEOUT_MS` (default 240000) if needed. Vite rejects a production build with missing, non-HTTPS, localhost, or path-bearing API origins. Deploy only after the backend is reachable from the selected frontend origin.
- **Render production:** `render.yaml` defines a paid `1c-2g` Docker web service and a 10 GB persistent disk mounted at `/var/data/brandguard`. The blueprint configures `ENVIRONMENT=production`, `PERSISTENT_STORAGE_ROOT=/var/data/brandguard`, uploads under `/var/data/brandguard/uploads`, and Chroma under `/var/data/brandguard/chroma`. Render disks are single-instance; this service is configured for one instance and cannot be horizontally scaled or use zero-downtime deployments while the disk is attached. Only data below the mount survives a restart/deploy. Back up the database and copy any existing uploads/vector data before changing an already-used service; the new disk starts empty.
- Set the Render `DATABASE_URL` to a separate TLS-enabled PostgreSQL database (`sslmode=require` or stronger). Set `FRONTEND_URL` and `ALLOWED_ORIGINS` to the exact deployed frontend HTTPS origin. `JWT_SECRET_KEY` is generated by Render. Enter `CLAMAV_HOST` and `CLAMAV_PORT` for a private, network-reachable ClamAV daemon; the blueprint does not provision ClamAV. Keep that daemon off the public internet and maintain its signatures. `GEMINI_API_KEY` and `TAVILY_API_KEY` are optional secrets; web search remains disabled until `EXTERNAL_SEARCH_PROVIDER=tavily` is deliberately configured. All credentials are entered in Render, not committed to YAML. The image installs Tesseract and sets `TESSERACT_CMD=/usr/bin/tesseract`.
- **Render demo:** choose `render.demo.yaml` in the Blueprint path field. It is intentionally separate, runs `ENVIRONMENT=demo` on the free plan, has no persistent disk, and rejects file uploads. Do not use it for production data.
- The backend container applies `alembic upgrade head` before starting Uvicorn. Confirm this succeeds in deploy logs, then check `GET /api/health` (liveness) and `GET /api/health/database` (database connectivity). Before deploying schema changes, take a PostgreSQL backup. Use `alembic downgrade c5310caee341` only as a deliberate rollback of the visual-analysis submission-link migration; it removes those links, so preserve a backup and coordinate rollback with feature use.
- **PostgreSQL migration test:** use a dedicated disposable PostgreSQL test database, not production. From `backend`, export the required production settings (`ENVIRONMENT`, test `DATABASE_URL` with TLS, `JWT_SECRET_KEY`, `FRONTEND_URL`, `ALLOWED_ORIGINS`, `CLAMAV_HOST`, `PERSISTENT_STORAGE_ROOT`, `UPLOAD_DIRECTORY`, and `CHROMA_PERSIST_DIRECTORY`), then run `alembic upgrade head` and verify `alembic current`. The application startup also requires the configured persistent root to be mounted.
- **Docker:** from the repository root run `docker build --tag brandguard-api:local --file backend/Dockerfile backend`. For production, provide all mandatory settings at runtime through a secret manager and mount durable storage at the configured `PERSISTENT_STORAGE_ROOT`; never bake credentials into the image. The Docker image includes Pillow from `backend/requirements.txt` and Tesseract OCR.
- **Vercel:** configure the project root as `frontend`; set `VITE_API_BASE_URL` to the deployed API HTTPS origin (scheme and host only, no `/api` suffix). Set `VITE_API_TIMEOUT_MS` (default 15000) and `VITE_AI_REQUEST_TIMEOUT_MS` (default 240000) if needed. Vite rejects a production build with missing, non-HTTPS, localhost, or path-bearing API origins. Deploy only after the backend is reachable from the selected frontend origin.
- The app limits authentication to 10 login attempts per minute and 5 registrations per hour per observed client address, and limits each account to 20 uploads and 30 analyses per hour. These in-memory counters are per process; configure equivalent or stricter platform/gateway rate limits and do not rely on them as a distributed limiter.
- ClamAV uses the daemon's TCP `INSTREAM` protocol; connect it over a private network, keep signatures updated, and do not expose its port publicly. In production, every accepted upload must pass scanning; infected files return 422 and scanner errors/timeouts return 503 without saving the file. Demo mode explicitly rejects uploads without storing them. Local development retains its existing behavior of skipping scanning when `CLAMAV_HOST` is unset.
- Set `ENVIRONMENT=production`; the backend refuses SQLite and the built-in development JWT secret in production mode. Keep SQL echo disabled, use HTTPS, and configure platform/gateway request limits, logs, database backups, and restore validation.
- In production, register a test organisation, upload and approve a guideline rule, submit content, inspect the analysis and references, and make a human review decision. In demo mode, verify health, authentication, and that both upload endpoints clearly reject files. Remove test data after verification. Do not claim Gemini works unless a credential-backed request has succeeded.

## Known limitations

- Draft rule extraction uses source-text cues, not an LLM; a human must review and approve every candidate before it becomes authoritative.
- Guideline versions are retained as separate records and can explicitly link to the version they supersede. Existing rules remain linked to their original source version.
- The embedding provider currently supports Chroma's local `all-MiniLM-L6-v2` embedding function only; it is not provider-pluggable yet. The vector-distance cutoff is a fixed conservative threshold and may need corpus-specific evaluation.
- Scanned/image-only PDFs are not OCR-processed and will return an empty/unreadable extraction error.
- Gemini calls require a valid API key, network connectivity, and a supported model. Provider errors are logged server-side; analysis reports retain deterministic results with partial status, while correction responses identify Gemini, deterministic, or fallback wording.
- Tavily retrieval is optional and is not itself a fact-checking authority. Credibility is a heuristic score, relevance uses keyword overlap, and freshness relies on provider-reported publication dates. URL validation does not prove that a page remains accessible or supports the claim. Gemini classifications of retrieved excerpts are conservative and still require human review.
- Tesseract's executable must be installed for OCR. Gemini and Tesseract requests are optional; model/heuristic findings are not confirmed violations. Approve reference assets first and review findings before acting. Reviewer assignment controls in the review queue currently focus on content submissions; visual and claim assignments can be created through the API and are enforced by review endpoints.
- There is no email verification, password reset, public invitation flow, or publishing integration. Scanned/image-only PDFs are not OCR-processed by the document-text workflow.
- The first administrator can add team users, but this MVP does not yet support changing or disabling existing users.
- Auth rate limiting uses in-process memory and observed client addresses; it is a defense-in-depth control, not a distributed limiter. Platform/gateway throttling is still required, especially for multiple workers or instances.
- Malware scanning depends on the configured ClamAV daemon and its signature freshness. Local development without `CLAMAV_HOST` does not scan files, demo mode disables uploads, and production refuses to start without scanner configuration. Local filesystem uploads and Chroma require a mounted persistent volume in production; object storage is not implemented. On Render, the attached disk limits the service to one instance.
- Tokens are short-lived signed bearer tokens stored in browser `localStorage`; there is no refresh-token or server-side revocation list. Deactivating a user blocks their next API request because the user record is checked on each authenticated request.

## Round 2 report and screenshots

See [ROUND2_AUDIT.md](./ROUND2_AUDIT.md) for the pre-change project audit, [ROUND2_COMPLETION_REPORT.md](./ROUND2_COMPLETION_REPORT.md) for the initial workflow verification, and [FINAL_ROUND2_READINESS.md](./FINAL_ROUND2_READINESS.md) for final security and deployment readiness results. The earlier feature report is [ROUND2_PROJECT_REPORT.md](./ROUND2_PROJECT_REPORT.md); its printable version is [ROUND2_PROJECT_REPORT.pdf](./ROUND2_PROJECT_REPORT.pdf).
