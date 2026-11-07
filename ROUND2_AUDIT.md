# BrandGuard AI — Round 2 Audit

**Audit date:** 2026-11-05  
**Scope:** Existing backend, frontend, persistence/migrations, authentication, guideline extraction and approval, RAG/AI, analysis, review workflow, deployment configuration, and tests.  
**Audit rule:** This report records the code as inspected before implementation changes.

## 1. Existing working features

- React/Vite frontend with authenticated routes, organisation workspace screens, guideline/rule management, content submissions, analysis reports, human review, dashboard analytics, and user settings.
- FastAPI API with SQLAlchemy models, Pydantic request/response validation, JWT authentication, Argon2 password hashing, role checks, audit events, and tenant-scoped queries.
- PDF, DOCX, and UTF-8 TXT extraction for brand guidelines and submitted content. Uploads are size-limited, stored under organisation-specific directories, and original submission text is retained.
- Guideline uploads can link to a prior version. Source-derived candidate rules are drafts, not authoritative policy; managers can edit, approve, and revoke rules.
- ChromaDB collections are selected by organisation, and the index helper only indexes approved rules. Deterministic prohibited-term and missing-disclaimer checks use approved rules.
- Analysis reports persist findings, confidence, severity, evidence status, cited rule text/reference, notes, score, and correction text. Gemini is optional and its finding text is checked against the submitted text; a cited rule ID must be among the retrieved approved rules.
- Suggestions have accept/reject/edit decisions. Reviewer approval, rejection, and revision requests persist previous/new status and comments. No publishing operation exists.
- Dashboard APIs scope data to the authenticated organisation and accept date, review-status, and severity filters.
- Alembic has a single current head; Render, Docker, Docker Compose, and Vercel configuration files exist.
- Baseline verification before changes: backend tests **19 passed**; frontend production build succeeded when run from `frontend`; Python compileall succeeded; `alembic heads` reported `41c6a9c2d103`. Running `npm run build` at repository root fails because the root has no `package.json`; the documented frontend working directory is required.

## 2. Incomplete features and integrations

- Gemini configuration exists, but no real provider request was verified: no API key or external credential was available. Invalid-key, quota, network, and timeout behavior therefore remains unverified against the live service.
- PostgreSQL support is configured but not validated against a live PostgreSQL server. No hosted PostgreSQL, Render, or Vercel deployment was available.
- The candidate-rule extractor is a deterministic directive-line heuristic, not AI rule extraction. It records a section label where available, but candidate metadata does not preserve precise page/line offsets; PDF page markers are skipped by the extractor.
- Chroma retrieval uses local `all-MiniLM-L6-v2` embeddings only; provider choice is fixed, and the model may need to download on first use.
- OCR/scanned-document extraction and external fact checking are not implemented. Analysis is limited to extracted text, configured rules, and optional Gemini review.
- The review queue shows submission text and decisions but does not show the associated analysis findings/evidence inline for the reviewer.
- Rate limiting, email verification, password reset, account invitations/deactivation, production gateway controls, deployment execution, and production backup/restore procedures are not implemented or verified.
- The README contains useful workflow and setup information, but deployment configuration and known limitations still need a consolidated, current deployment runbook after fixes.

## 3. Bugs and technical issues

1. **RAG evidence can be overstated.** `_retrieve_evidence` accepts the nearest Chroma results without a relevance-distance threshold. A collection with any approved rules can therefore return unrelated rules as “relevant”; a Gemini finding that cites one of those retrieved IDs is labelled `supported` without validating that the cited text entails the finding.
2. **Evidence provenance is coarse for extracted candidates.** Candidate rules keep a section label, not a document page/paragraph offset or exact source quotation. PDF page markers are omitted from candidate metadata, weakening traceability.
3. **Review inspection is incomplete.** `ReviewsPage` fetches submissions only; reviewers cannot see the related report/findings there without navigating separately.
4. **Upload/database operations can leave inconsistent artifacts.** Upload files are written before their database transaction commits; a later commit failure can orphan the file. Guideline deletion removes vectors and the file before database commit, so a failed commit can leave a retained database record without its original file/index.
5. **Gemini client behavior is not bounded explicitly in application code.** The synchronous provider call has no configured application-level timeout/retry policy. Correction generation catches all provider exceptions and may fall back to generic wording; the user-facing result should distinguish generated output from a deterministic fallback.
6. **Version links are not enforced as a linear history.** A guideline may be superseded more than once, and there is no cycle/branch validation or current-version marker. Version numbers are derived from only the selected parent.
7. **Health-check behavior differs by endpoint.** `/api/health` is a liveness response and does not check the database; `/api/health/database` does. Render currently uses the liveness endpoint.
8. **Database deployment remains unproven.** SQLite tests and migration head inspection do not establish PostgreSQL migration, foreign-key, or operational behavior.

## 4. Security risks

- Public registration creates a new organisation administrator, and login/registration have no application-level rate limits. Public deployment needs edge/API throttling and abuse monitoring.
- JWTs are stored in browser `localStorage`, so a successful same-origin script injection can expose active bearer tokens. There is no refresh/revocation mechanism.
- Upload checks rely primarily on filename extension and small magic-prefix checks; TXT content is not meaningfully type-checked, and archive expansion/resource limits for DOCX/PDF parsing are not explicit. Keep the byte cap and add robust content/processing limits before accepting untrusted public uploads.
- There is no configured upload cleanup/retention policy, malware scanning, or operational secret rotation workflow.
- Application-level tenant filters are consistently used in the reviewed business queries, and the vector collection is organisation-specific. These are useful controls, but the schema does not enforce composite organisation ownership across every foreign-key relationship; continue testing cross-tenant access whenever routes/models change.
- Production CORS origins and secrets are deployment inputs. The example secret is a placeholder and must not be used in production; hosted credentials must be configured outside source control.
- No request rate limiting, production WAF/gateway configuration, or deployed security test was present. A full production penetration/security assessment remains outstanding.

## 5. Missing integrations

- Gemini live API key and a real request/response verification, including invalid key, quota, timeout, and network failure cases.
- Hosted PostgreSQL connection and production migration verification.
- Render API and Vercel deployment, including configured CORS origin, environment variables, persistent file/index storage, and post-deploy health/workflow checks.
- Operational logging/monitoring, rate limiting, backups, restore validation, and upload lifecycle controls.

## 6. Recommended fixes in priority order

| Priority | Recommendation | Reason |
|---|---|---|
| P0 | Make evidence retrieval fail closed for irrelevant hits and ensure only defensible evidence states/citations are persisted. Preserve exact rule provenance and never call a finding `supported` solely because an ID was returned. | Prevents false authority/citations in the central AI workflow. |
| P0 | Complete review findings visibility and keep approval a human action; preserve the immutable original content. | Enables reviewers to make informed approval decisions. |
| P1 | Bound Gemini request time, surface unavailable/partial states, and clearly distinguish provider-generated suggestions from deterministic fallback wording. | Avoids hanging requests and misleading AI status. |
| P1 | Make upload/delete side effects transactional or compensating; validate paths and parser resource limits. | Prevents data/index/file inconsistencies and limits untrusted-file risk. |
| P1 | Add regression tests for evidence relevance/citation behavior, unavailable AI, tenant isolation, and the full reviewer workflow. | Protects key guarantees against regressions. |
| P1 | Verify migrations and the complete workflow on PostgreSQL; document migration/health behavior for Render. | The target deployment database has not been exercised. |
| P2 | Add rate limiting at the application or deployment edge and document token, CORS, secret, and upload-retention controls. | Required before exposing registration and login publicly. |
| P2 | Preserve page/paragraph provenance and validate guideline version-chain semantics. | Improves auditability of extracted draft rules and citations. |
| P2 | Run a credential-backed Gemini smoke test and Render/Vercel staging deployment, then record only verified results. | Resolves the external verification gaps without inventing success. |

## Baseline test results

- `.\backend\.venv\Scripts\python.exe -m pytest -q`: **19 passed**, one upstream Starlette/AnyIO deprecation warning.
- From `frontend`, `npm run build`: **passed**.
- `.\backend\.venv\Scripts\python.exe -m compileall -q backend\app backend\alembic`: **passed**.
- `alembic heads`: one head, `41c6a9c2d103`. No live PostgreSQL or hosted deployment was tested.
