# BrandGuard AI — Final Round 2 Production Readiness

**Assessment date:** 2026-11-05  
**Readiness:** Local workflow and the checks listed below pass. **Not production-certified:** live PostgreSQL, a real ClamAV service, hosted deployment, and Gemini are not available/verified in this environment.

## Completed features

- Preserved the existing React/FastAPI application, APIs, schema, and approval workflow.
- Added in-process limits: 10 login attempts per minute and 5 registrations per hour per observed client address; 20 uploads and 30 analyses per hour per account. Rejections return HTTP 429 with `Retry-After`.
- Added ClamAV TCP `INSTREAM` upload scanning. Production requires `CLAMAV_HOST`; detected malware is rejected, and scanner errors/timeouts fail closed with HTTP 503. Local development skips scanning if no host is configured.
- Tightened PDF/DOCX/TXT processing: upload byte cap and extension/signature validation remain; DOCX archives are checked for structure, entry count, encryption, and expanded-size limits; PDFs have an upper page limit and encrypted PDFs are rejected; text files reject NUL bytes and invalid UTF-8.
- Added production configuration validation: PostgreSQL/psycopg DSN with TLS `sslmode`, non-placeholder JWT secret, configured ClamAV, exact HTTPS frontend/CORS origins, and disabled SQL echo are required.
- Removed the default Compose database password. Updated Render configuration to require a private ClamAV host and to use the database health check. Documented Vercel API origin configuration, migrations, scanning, and rate-limit requirements.
- Confirmed existing Argon2 password hashing, one-hour expiring HS256 bearer tokens, active-user lookup on authenticated requests, role checks, and organisation-scoped API queries remain in place. Tokens are held in browser `localStorage`; no refresh-token or revocation-list mechanism was added.
- Added regression coverage for login/registration/account-level limits, ClamAV outcomes, upload rejection on scanner outage, maximum size, DOCX expansion, production configuration, and Gemini failure/fallback reporting.

## Security improvements and limitations

- Authentication, uploads, and AI analysis now have application-level throttles. Counters are process-local and reset on restart; configure platform/gateway throttles for multi-worker or multi-instance deployment. Rate limits use the ASGI-observed client address, whose correctness depends on trusted proxy configuration.
- Production uploads are blocked unless a ClamAV host is configured and responds successfully. Provision a private daemon, keep its signatures current, and do not expose its port publicly. A host value is validated at startup, but scanner connectivity and signature freshness are not health-checked at startup.
- Upload scanning and parser limits reduce risk but do not replace operating-system isolation, malware-signature operations, a retention policy, or review of new parser vulnerabilities.
- `.env` is ignored by Git; production settings reject placeholder JWT secrets and unsafe origins. Keep database and Gemini credentials in the hosting provider's secret store. Compose requires an explicitly set local `POSTGRES_PASSWORD`.
- Existing tenant isolation and permission checks were reviewed; regression tests cover cross-organisation access. The relational schema does not enforce composite organisation ownership across every foreign key, so tenant filters remain an application responsibility.
- Auth rate limiting is not distributed. Account recovery, email verification, and server-side token revocation remain unimplemented.

## Test results

- `.\backend\.venv\Scripts\python.exe -m pytest -q`: **36 passed**, one upstream Starlette/AnyIO deprecation warning.
- From `frontend`, `npm run build`: **passed**.
- `.\backend\.venv\Scripts\python.exe -m compileall -q backend\app backend\alembic`: **passed**.
- Alembic `upgrade head`, `check`, and `heads` against a disposable SQLite database: **passed**, no schema drift; current head is `b78a23e01f64`.
- Alembic generated the complete migration SQL with the PostgreSQL dialect in offline mode: **passed**. This only checks SQL generation; it is not a database migration test.
- `npm audit`: **0 vulnerabilities**.
- `python -m pip check`: **no broken requirements**. `pip-audit` and Bandit were not installed, so no Python dependency-vulnerability database scan or Bandit scan was run.
- Tests simulate ClamAV clean, infected, and unavailable responses. No external ClamAV service was contacted.

## PostgreSQL verification status

**Not verified against a live PostgreSQL server.** Docker, `psql`, and `pg_isready` were unavailable, and `localhost:5432` was unreachable. The SQLAlchemy models use standard portable string, integer, boolean, float, text, timestamp, and foreign-key types; migrations use Alembic/SQLAlchemy operations. The PostgreSQL dialect could generate offline migration SQL, but that does not prove a live migration, connection, transaction, or hosted-provider behavior.

Use a TLS-enabled SQLAlchemy URL such as `postgresql+psycopg://USER:PASSWORD@HOST:5432/brandguard?sslmode=require`; URL-encode reserved characters in credentials. On the first real staging deployment, run `alembic upgrade head`, check `/api/health/database`, and exercise registration, upload, review, and tenant-isolation paths.

## Gemini verification status

**Not verified against Gemini.** No `GEMINI_API_KEY` was configured, so no external request was sent. Tests simulate provider failures and confirm analysis is marked partial and the correction response retains deterministic provenance. A real request, invalid key, quota, network, and timeout behavior still require an authorized credential and live provider access.

## Deployment readiness

- **Render:** `render.yaml` configures the Docker backend, persistent upload/vector storage, database readiness health check, and migration-before-Uvicorn startup. Production now also requires a private ClamAV host and TLS PostgreSQL URL. No service was deployed.
- **Vercel:** SPA fallback routing is present. Set `VITE_API_BASE_URL` to the deployed HTTPS API origin (without `/api`) and set the matching exact HTTPS `FRONTEND_URL` and `ALLOWED_ORIGINS` on Render. No build was deployed or tested on Vercel.
- **Health checks:** `/api/health` is liveness; `/api/health/database` checks database access and is configured for Render.
- **Migrations:** startup runs `alembic upgrade head`; review Render logs and validate the resulting database before accepting traffic.
- **Secrets and operations:** use provider secret settings, enable HTTPS, configure backups/restore, monitoring, persistent storage, and gateway limits. Deployment is not automatic and was not performed.

## Remaining manual tasks

1. Provision PostgreSQL and a private ClamAV service; set TLS `DATABASE_URL`, `CLAMAV_HOST`, exact frontend origins, persistent paths, and an independent random `JWT_SECRET_KEY` in Render.
2. Set Vercel `VITE_API_BASE_URL` to the Render API origin. Confirm CORS preflight and API calls from the deployed site.
3. Run migrations and the complete workflow on the real PostgreSQL-backed staging deployment. Verify tenant separation and file persistence across restarts.
4. With an authorized Gemini key, perform a real structured analysis request and verify invalid-key, quota, timeout, and network-failure handling. Record the observed results; do not treat simulated tests as live verification.
5. Configure rate limits at the hosting edge/gateway, trusted proxy handling, monitoring, database backup/restore, and malware-signature updates before public exposure.
6. Consider installing/running `pip-audit` and Bandit in CI; they were unavailable locally and were not installed as part of this task.

## Known limitations

- Local development with no `CLAMAV_HOST` intentionally skips malware scanning. Production refuses to start without scanner configuration and returns 503 for uploads if the configured service is unavailable.
- Application counters are process-local. Edge throttling is necessary for reliable multi-instance limits.
- No production PostgreSQL, Render, Vercel, or Gemini integration was exercised.
- Browser bearer tokens remain in `localStorage`; account recovery, email verification, and server-side session revocation are not provided.
- Scanned PDFs have no OCR support; external claim verification and automatic publishing are not implemented.
