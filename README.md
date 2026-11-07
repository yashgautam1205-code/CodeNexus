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
5. Validate generated finding text against the submission and restrict references to retrieved approved rule IDs. Deterministic exact-rule checks can be marked contradicted; AI interpretations remain `needs_verification` until a person reviews them, even when a retrieved rule is cited. A missing source is marked `no_source_found`, not false.
6. If AI or retrieval is unavailable, the report says analysis is partial. Suggestions persist whether they came from Gemini, a deterministic rule, or generic fallback wording.
7. Save findings, evidence references, score, correction suggestions, reviewer decisions, and audit history. Original submissions are not overwritten.

## Implemented MVP

- Organisation registration, JWT login, Argon2 password hashing, role checks, and tenant-scoped API access.
- Admin-managed team accounts for admins, brand managers, content creators, and reviewers.
- PDF/DOCX/TXT guideline upload, safe organisation-specific file storage, text extraction, source preview, version linking, and guideline management.
- Source-derived draft rule extraction plus manual rule creation/edit/deletion. Rules remain non-authoritative until an admin or brand manager explicitly approves them.
- Content PDF/DOCX/TXT upload and extraction, submission history, and file-size/type validation.
- ChromaDB persistent vector index using Chroma's local `all-MiniLM-L6-v2` embedding function. Only approved rules are indexed; collections and query metadata are organisation-scoped.
- Deterministic prohibited-term and explicitly configured disclaimer checks, RAG-backed evidence, and optional Gemini structured analysis.
- Pydantic-validated findings, evidence status, severity-weighted compliance score, correction suggestions, and saved accept/reject/edit decisions.
- Human approve/reject/request-revision workflow, reviewer comments, previous/new status history, audit history, and dashboard analytics from persisted records.
- Dashboard date-range, submission-status, and severity filters. Organisation scope is fixed to the authenticated tenant to prevent cross-organisation disclosure.
- Alembic migrations, PostgreSQL support, SQLite local fallback, Docker configuration, Vercel SPA routing, and Render deployment blueprint.

The app reports **partial analysis** when Gemini or relevant approved evidence is unavailable. "No source found" is not treated as false. The compliance score is a review aid and is not certified legal or factual validation.

## Requirements

- Python 3.11+
- Node.js 20+
- PostgreSQL 15+ for deployment (SQLite is used when `DATABASE_URL` is unset for local development)
- Docker Desktop is optional for local PostgreSQL

## Configuration

Copy `.env.example` to `.env` in the repository root. The file is git-ignored. Set a long random `JWT_SECRET_KEY`; set `DATABASE_URL` to PostgreSQL for a shared or deployed instance. Do not commit `.env` or use placeholder values in production.

Production variables: `ENVIRONMENT=production`; a TLS-enabled PostgreSQL `DATABASE_URL` (SQLAlchemy/psycopg DSN); a unique `JWT_SECRET_KEY` of at least 32 characters; `FRONTEND_URL` and comma-separated `ALLOWED_ORIGINS` set to exact HTTPS origins; and `CLAMAV_HOST` pointing to a private, reachable ClamAV daemon. Production startup rejects SQLite, wildcard or non-HTTPS origins, SQL echo, and a missing scanner. `CLAMAV_PORT` defaults to 3310 and `CLAMAV_TIMEOUT_SECONDS` to 10 seconds. Upload and Chroma directories must use persistent storage in hosted environments.

`GEMINI_API_KEY` is optional. `GEMINI_MODEL` and `GEMINI_TIMEOUT_MS` control the provider/model and request timeout. Copy `frontend/.env.example` to `frontend/.env.local` for Vite settings. Local development may leave `VITE_API_BASE_URL` empty and use the `/api` proxy; production builds require `VITE_API_BASE_URL` to be an HTTPS backend origin without an `/api` suffix. `VITE_API_TIMEOUT_MS` defaults to 15000 ms for normal calls; `VITE_AI_REQUEST_TIMEOUT_MS` defaults to 130000 ms for analysis and correction generation. Set these as Vercel project environment variables for production. Keep `.env` files out of source control.

For local PostgreSQL with Docker Compose, set `POSTGRES_PASSWORD` in your shell and make sure `DATABASE_URL` uses the same user and password. Never use these local credentials in production.

`GEMINI_API_KEY` is optional. Without it, deterministic checks and evidence retrieval remain available and reports are labeled partial. `GEMINI_TIMEOUT_MS` bounds each provider request (default 15000 ms, maximum 120000 ms). Chroma's local default embedding model is `all-MiniLM-L6-v2`; the first indexing operation may download its model files. `UPLOAD_DIRECTORY` and `CHROMA_PERSIST_DIRECTORY` default to ignored local folders under the repository root.

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
- `GET /api/dashboard/overview?days=30&review_status=approved&severity=high` and `GET /api/dashboard/analytics`

All non-health endpoints require a bearer token. Organisation ownership is enforced in API queries and vector collection selection.

## Deployment

- **Vercel:** configure the project root as `frontend`; set `VITE_API_BASE_URL` to the deployed API HTTPS origin (scheme and host only, no `/api` suffix). Set `VITE_API_TIMEOUT_MS` (default 15000) and `VITE_AI_REQUEST_TIMEOUT_MS` (default 130000) if needed. Vite rejects a production build with missing, non-HTTPS, localhost, or path-bearing API origins. Deploy only after the backend is reachable from the selected frontend origin.
- **Render:** use `render.yaml` and the backend Dockerfile. Configure PostgreSQL `DATABASE_URL` with TLS, the exact Vercel HTTPS origin(s) in both `ALLOWED_ORIGINS` and `FRONTEND_URL`, and a private ClamAV service address in `CLAMAV_HOST`. Production startup fails without these requirements. Render generates `JWT_SECRET_KEY`; do not reuse the example value. The blueprint mounts persistent storage for uploads and Chroma data.
- The container applies `alembic upgrade head` before starting Uvicorn. Confirm this migration step succeeds in Render logs, then check `GET /api/health` (liveness) and `GET /api/health/database` (database connectivity).
- The app limits authentication to 10 login attempts per minute and 5 registrations per hour per observed client address, and limits each account to 20 uploads and 30 analyses per hour. These in-memory counters are per process; configure equivalent or stricter platform/gateway rate limits and do not rely on them as a distributed limiter.
- ClamAV uses the daemon's TCP `INSTREAM` protocol; connect it over a private network, keep signatures updated, and do not expose its port publicly. Every accepted upload is scanned; infected files return 422 and scanner errors/timeouts return 503 without saving the file. Local development skips scanning when `CLAMAV_HOST` is unset.
- Set `ENVIRONMENT=production`; the backend refuses SQLite and the built-in development JWT secret in production mode. Keep SQL echo disabled, use HTTPS, and configure platform/gateway request limits, logs, database backups, and restore validation.
- After deployment, register a test organisation, upload and approve a guideline rule, submit content, inspect the analysis and references, and make a human review decision. Remove test data after verification. Do not claim Gemini works unless a credential-backed request has succeeded.

## Known limitations

- Draft rule extraction uses source-text cues, not an LLM; a human must review and approve every candidate before it becomes authoritative.
- Guideline versions are retained as separate records and can explicitly link to the version they supersede. Existing rules remain linked to their original source version.
- The embedding provider currently supports Chroma's local `all-MiniLM-L6-v2` embedding function only; it is not provider-pluggable yet. The vector-distance cutoff is a fixed conservative threshold and may need corpus-specific evaluation.
- Scanned/image-only PDFs are not OCR-processed and will return an empty/unreadable extraction error.
- Gemini calls require a valid API key, network connectivity, and a supported model. Provider errors are logged server-side; analysis reports retain deterministic results with partial status, while correction responses identify Gemini, deterministic, or fallback wording.
- There is no email verification, password reset, public invitation flow, publishing integration, or claim verification against external fact databases.
- The first administrator can add team users, but this MVP does not yet support changing or disabling existing users.
- Auth rate limiting uses in-process memory and observed client addresses; it is a defense-in-depth control, not a distributed limiter. Platform/gateway throttling is still required, especially for multiple workers or instances.
- Malware scanning depends on the configured ClamAV daemon and its signature freshness. Local development without `CLAMAV_HOST` does not scan files; production refuses to start without scanner configuration.
- Tokens are short-lived signed bearer tokens stored in browser `localStorage`; there is no refresh-token or server-side revocation list. Deactivating a user blocks their next API request because the user record is checked on each authenticated request.

## Round 2 report and screenshots

See [ROUND2_AUDIT.md](./ROUND2_AUDIT.md) for the pre-change project audit, [ROUND2_COMPLETION_REPORT.md](./ROUND2_COMPLETION_REPORT.md) for the initial workflow verification, and [FINAL_ROUND2_READINESS.md](./FINAL_ROUND2_READINESS.md) for final security and deployment readiness results. The earlier feature report is [ROUND2_PROJECT_REPORT.md](./ROUND2_PROJECT_REPORT.md); its printable version is [ROUND2_PROJECT_REPORT.pdf](./ROUND2_PROJECT_REPORT.pdf).
