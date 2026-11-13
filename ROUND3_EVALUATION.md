# Round 3 Technical Evaluation

**Evaluation date:** 2026-11-13
**Scope:** Advanced Visual Brand Compliance Engine; Evidence-Based Claim Verification; Advanced Brand Governance and Analytics.

## Executive summary

| Feature | Status | Evidence |
|---|---|---|
| Advanced Visual Brand Compliance Engine | **PASS** | A real FastAPI upload/analyze/review run used Gemini Vision, recognized text, returned logo/text observations and persisted a human revision request. Local logo comparison matched the approved synthetic logo at 1.0 similarity. A separate multi-region run returned three palette findings. |
| Evidence-Based Claim Verification | **PASS** | A real Tavily-to-Gemini API assessment persisted a supported outcome, source-backed rationale, and three retrieved citations. The reviewer requested additional evidence; this was not represented as final approval. |
| Advanced Brand Governance and Analytics | **PASS** | Persisted tenant-scoped API data produced assignment, backlog, and completed-decision metrics across content, visual, and claim resources. Reviewer-filter and cross-tenant restrictions are regression-tested. |

Statuses indicate the requested behaviors were demonstrated and tested; they do not mean provider calls are infallible or that machine findings replace human review. Live examples used isolated temporary SQLite databases. They did not alter `backend/brandguard.db`; temporary demo data was removed. No provider credentials were printed or changed.

## Execution evidence

### Tests, build, and migration

| Check | Command/action | Result |
|---|---|---|
| Backend full suite | From repository root, with `EXTERNAL_SEARCH_PROVIDER=disabled` and provider keys set to whitespace: `python -m pytest -q` | **76 passed**, 1 Starlette/AnyIO deprecation warning; 23.26 seconds. |
| Round 3 provider tests | From `backend`: `python -m pytest ..\tests\test_round3_provider_integration.py -q` | **20 passed**, 1 deprecation warning; includes schema compatibility, model-category normalization, OCR geometry, and human-review regressions. |
| Frontend tests | From `frontend`: `npm test` | **8 passed**, 0 failed. |
| Production build | From `frontend`: `npm run build` | **Passed**, Vite transformed 2022 modules. |
| Alembic chain | Disposable SQLite DB; `alembic upgrade head`, `alembic current`, `alembic downgrade base` | Upgrade reached **`c8716b8c2a15 (head)`**; complete downgrade succeeded. |
| Python diagnostics | Pylance diagnostics for `backend/app/ai/gemini.py` and `backend/app/services/visual_brand_compliance.py` | No Gemini diagnostics. Pylance reports unresolved optional `cv2` (`reportMissingImports`) in the visual service; runtime tests and the live logo comparison used OpenCV successfully. |
| Whitespace | `git diff --check` | Passed; Git emitted only LF-to-CRLF working-copy warnings. |

The backend tests use isolated SQLite fixtures and disabled external providers. Real provider behavior is documented separately below; test doubles were not used for those demonstrations.

### Live provider and API demonstrations

**Claim verification — real Tavily and Gemini, no mocks**

- Submitted: “The Federal Trade Commission is a United States government agency.”
- Tavily returned five actual results. Gemini assessed the supplied retrieved excerpts; after a primary-model 503, the configured fallback completed the assessment. The API returned `supported`, assessment status `available`, and served-model metadata `gemini-3.6-flash` (requested fallback: `gemini-3.5-flash`).
- The returned rationale stated that retrieved excerpts describe the FTC as an independent U.S. government/federal agency. The assessment cited three retrieved sources: [Federal Trade Commission - Wikipedia](https://en.wikipedia.org/wiki/Federal_Trade_Commission), [About the FTC](https://www.ftc.gov/about-ftc), and [Cornell Legal Information Institute - FTC](https://www.law.cornell.edu/wex/ftc).
- The result and citations were persisted. A human reviewer selected `additional_evidence_requested`; the machine status was not changed into a human approval. The API run took about **85 seconds**.

**Visual compliance — real Gemini Vision through the FastAPI API**

- Uploaded and approved a synthetic logo reference, uploaded an 800×400 campaign creative, analyzed it, requested revision, then fetched the persisted latest report.
- The first request-format investigation isolated the former 400 to Gemini rejecting the optional-field response schema: image-only input succeeded, the optional Pydantic schema failed, and a required-field schema succeeded. The implementation now uses a provider-compatible required-field schema and maps empty wire values back to the optional application model.
- In the post-fix API run, the configured primary returned 503 and the real fallback succeeded. The report marked Vision `available`, identified the served model as `gemini-3.6-flash`, recognized `NORTHSTAR` and `Glow with confidence`, and persisted separate `logo_compliance` and `visible_text` findings. Typography and layout summaries were saved; two model-derived text lines were recorded.
- OpenCV matched the approved synthetic logo at **1.0 similarity**. Findings remained potential/reviewable rather than confirmed violations. The persisted review status was `revision_requested`, with a `request_revision` entry in review history. This API run took about **71 seconds**.
- A separate isolated multi-region visual API demonstration returned **three distinct `brand_colour` findings** for connected palette regions, rather than collapsing the multiple-issues case into one palette finding. The reviewer decision was also persisted.

**Governance — persisted tenant-scoped API data**

- The isolated live API demonstration created and completed one assignment each for content, visual, and claim resources: **3 completed, 0 pending, 0 cancelled**.
- Persisted backlog metrics were: 0 strictly pending content/claim/visual resources, 1 claim awaiting additional evidence, 1 visual awaiting revision, **0 total pending resources**, **2 resources requiring action**, and 0 pending assignment records.
- Persisted decision metrics were one content approval, one visual revision request, and one claim request for additional evidence: **3 completed decisions**. Reviewer workload showed all three decisions and assignments.
- Regression tests cover tenant isolation, reviewer assignment enforcement, reviewer-filter consistency, and persisted cross-resource metrics.

## Feature evaluations and limitations

### 1. Advanced Visual Brand Compliance Engine — PASS

**Request/data path:** [ContentPage.jsx](frontend/src/pages/ContentPage.jsx) uploads creative/reference files and requests analysis. [brand_assets.py](backend/app/api/brand_assets.py) validates organisation ownership, loads only approved logo references and rules, and persists reports and review history. [visual_brand_compliance.py](backend/app/services/visual_brand_compliance.py) performs connected-region palette analysis, local logo matching, OCR/layout checks, and optional Gemini Vision inspection.

The real provider API demonstration verifies image request formatting, text recognition, logo observations, persisted summaries, and human review. A compatible wire schema avoids the optional-field `anyOf` form rejected by the provider. Provider labels such as `logo`, `text`, and `tagline` are normalized into application finding categories. When local OCR is unavailable, valid model-provided text bounds feed the layout/typography geometry checks; uncertain geometry findings are marked `needs_verification`.

**Limitations:** the Tesseract executable is absent in this environment, so text recognition used Gemini Vision rather than local Tesseract. Two observed text lines did not cross the alignment or scale-anomaly thresholds; synthetic regression coverage exercises separate edge, alignment, and text-scale findings. Font-family identity cannot be inferred reliably without an approved font/reference sample. ORB/template matching is not a general-purpose logo detector. Automated findings are not confirmed violations and remain subject to human review. Gemini can still return transient 503/504 responses; bounded retries and the configured real fallback do not guarantee availability.

### 2. Evidence-Based Claim Verification — PASS

**Request/data path:** [AnalysisPage.jsx](frontend/src/pages/AnalysisPage.jsx) displays claim type, outcome, retrieval/assessment state, timestamps, evidence relations, rationale, citations, and provider status. [evidence.py](backend/app/api/evidence.py) combines user-supplied evidence (untrusted) with approved organisation rules and external search. [evidence_verification.py](backend/app/services/evidence_verification.py) applies relevance and freshness gates; [external_search.py](backend/app/services/external_search.py) retrieves Tavily results; [gemini.py](backend/app/ai/gemini.py) assesses bounded excerpts; [verification_persistence.py](backend/app/services/verification_persistence.py) persists the result independently of human review history.

The live example demonstrates a real provider-backed result with rationale and citations restricted to retrieved source IDs. The source excerpts, not provider connectivity or URLs alone, informed the assessment.

**Limitations:** claim extraction, relevance, authority, and freshness scoring include heuristics. Unknown publication dates remain unknown; a citation is not proof that the linked page is authoritative or supports every wording of a claim. Provider failure remains an unverified outcome, never a mock or success-shaped fallback. Human review remains necessary; the demonstrated reviewer requested additional evidence.

### 3. Advanced Brand Governance and Analytics — PASS

**Request/data path:** [DashboardPage.jsx](frontend/src/pages/DashboardPage.jsx) requests date, trend granularity, review status, severity/category, and reviewer filters. [dashboard.py](backend/app/api/dashboard.py) calculates tenant-scoped metrics from persisted content, claim, visual, decision-history, and assignment records. [review_assignments.py](backend/app/api/review_assignments.py) and [review_assignments.py](backend/app/services/review_assignments.py) enforce organisation and reviewer scope.

The API demonstration verified separate counts for strict pending records, items requiring reviewer action, pending assignment records, completed assignments, and decisions across all three resource types. Automated tests verify reviewer filters and cross-tenant denial/isolation.

**Limitations:** browser assignment creation controls currently focus on content submissions; visual and claim assignments are supported through the API. Severity/category filters are violation-specific, while date/status/reviewer filters scope broader resources. The migration chain was demonstrated on disposable SQLite, not production PostgreSQL.

## Exact local launch commands

Configure provider credentials locally in `backend\.env` for a live-provider demonstration. Do not commit credentials. Set `EXTERNAL_SEARCH_PROVIDER=tavily`, `TAVILY_API_KEY`, `GEMINI_API_KEY`, and, if needed, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `GEMINI_TIMEOUT_MS`, and `GEMINI_RETRY_ATTEMPTS`.

In a PowerShell terminal:

```powershell
cd C:\CodeNexus\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

In a second PowerShell terminal:

```powershell
cd C:\CodeNexus\frontend
npm install
npm run dev
```

Open `http://localhost:5173`, register an organisation administrator, and create/approve brand rules and logo references. The live API evaluations used temporary SQLite databases rather than the existing local database.

## Recommended five-minute live demonstration

1. **0:00–0:25 — State provider availability.** Show configured provider names/status only; never expose keys. Explain that Gemini had a transient primary 503 and the real fallback succeeded in the recorded run.
2. **0:25–1:35 — Visual checks.** Upload a campaign containing multiple palette regions and an approved logo reference. Show separate palette findings, logo similarity, recognized text, typography/layout summaries, model provenance, and the rule that uncertain findings require review. Allow up to about 70 seconds for a live Vision call; use the persisted result if provider latency is longer.
3. **1:35–3:00 — Claim verification.** Submit the FTC example or another source-checkable claim. Show retrieval status, source-backed rationale, cited URLs, freshness metadata, and the served-model name. Allow for provider latency; if the request fails, show the explicit unavailable state rather than treating retrieval as verification.
4. **3:00–3:50 — Human decisions.** Request visual revision and additional claim evidence. Show persisted review history separately from machine assessment status.
5. **3:50–5:00 — Governance.** Show reviewer-filtered workload, completed assignments, strict pending backlog, resources requiring action, and decision totals across content/visual/claim. Explain tenant isolation and the current content-focused browser assignment controls.

## Relevant implementation and regression coverage

- [Visual compliance service](backend/app/services/visual_brand_compliance.py)
- [Gemini provider integration](backend/app/ai/gemini.py)
- [Claim verification service](backend/app/services/evidence_verification.py)
- [External retrieval service](backend/app/services/external_search.py)
- [Dashboard API](backend/app/api/dashboard.py)
- [Review assignment API](backend/app/api/review_assignments.py)
- [Round 3 feature tests](tests/test_round3_features.py)
- [Provider/integration tests](tests/test_round3_provider_integration.py)
- [Local setup and configuration](README.md)
