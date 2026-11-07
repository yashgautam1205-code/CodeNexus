# BrandGuard AI — Phase 2 Implementation Report

## 1. Prioritised task list

1. Fix evidence strictness and retrieval fail-closed behavior.
2. Remove unsupported or fabricated AI evidence references from findings and suggestions.
3. Preserve a conservative source-status model: supported, contradicted, no_source_found, needs_verification.
4. Validate review and approval paths remain scoped to the organisation and use approved rules only.
5. Confirm the frontend/backend contract remains intact and no regression was introduced.
6. Capture remaining external deployment blockers as manual configuration requirements only.

## 2. Issues fixed

### 2.1 Retrieval and evidence strictness
- Hardened retrieval filtering in `backend/app/rag/guideline_index.py`.
- Retrieval now rejects non-numeric or non-finite distance values and ignores metadata that does not match the active organisation.
- Results are only kept when they fall within the configured relevance threshold and are structurally valid.

### 2.2 Unsupported AI evidence handling
- Updated `backend/app/services/compliance.py` so AI-generated findings without a valid approved-source match are marked as `no_source_found` instead of masquerading as a validated rule reference.
- Findings with a valid source are still marked `needs_verification` until a human review confirms them.
- This preserves the requirement that AI interpretations remain provisional and never claim a fabricated source.

### 2.3 Evidence provenance discipline
- The fix keeps evidence attribution conservative: absent or invalid source IDs do not become a real rule reference.
- This prevents unsupported claims from being recorded as if they were brand-approved evidence.

## 3. Root causes

- Retrieval could accept weak or malformed Chroma results without enough structural validation.
- AI findings could retain an invalid `evidence_rule_id` and still be treated as if they had a valid source.
- The distinction between `no_source_found` and `needs_verification` was too loose for findings that had no real approved rule association.

## 4. Files modified

- `backend/app/rag/guideline_index.py`
- `backend/app/services/compliance.py`
- `tests/test_evidence_status.py`

## 5. Features verified

The following workflow effects were validated locally:

- Organisation-level rule filtering remains enforced.
- Approved guideline rules are the only source of organisational retrieval evidence.
- Findings created without a valid source are now marked `no_source_found`.
- AI findings with a valid source remain `needs_verification` until human review.
- Retrieval now fail-closes when a hit is irrelevant or malformed.
- Existing Round 2 workflow tests still pass with the stricter evidence handling.

## 6. Tests executed and results

Executed:

- `cd C:\CodeNexus; .\backend\.venv\Scripts\python.exe -m pytest -q tests/test_evidence_status.py`
- `cd C:\CodeNexus; .\backend\.venv\Scripts\python.exe -m pytest -q`

Results:

- `tests/test_evidence_status.py`: 5 passed
- Full backend suite: 38 passed
- Warning: one upstream Starlette/AnyIO deprecation warning from the test client, but no test failures

## 7. Remaining issues

These are not fixed because they are external-service or deployment-level concerns, and no live external validation was performed:

- Real Gemini API verification
- Live PostgreSQL migration and connection validation
- Hosted Render deployment
- Hosted Vercel deployment
- Live ClamAV service validation
- Production autoscaling or gateway-level rate limiting

## 8. Manual configuration requirements

Before any production or staging deployment, the following must be provisioned and configured:

- TLS-enabled PostgreSQL instance with valid `DATABASE_URL`
- Real `GEMINI_API_KEY` and corresponding production model config
- Private ClamAV host and port configuration
- Exact HTTPS frontend and backend origins in environment variables
- Secret manager for `JWT_SECRET_KEY` and other production credentials
- Persistent upload and Chroma storage on the hosting platform
- Render/Vercel environment verification and smoke tests

## 9. Next recommended phase

The next phase should be a genuine staging deployment and live integration exercise, not a code rewrite. The focus should be:

1. deploy to Render with PostgreSQL and persistent storage,
2. configure a real ClamAV service,
3. validate the complete workflow with actual uploaded documents,
4. run one real Gemini-backed analysis with a valid key,
5. verify final review, approval, and audit records in a real hosted environment.

Do not claim live service success until those external checks are actually run.
