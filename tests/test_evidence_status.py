def test_missing_source_is_reported_as_unverified_not_false(client, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "gemini_api_key", "")
    registration = client.post(
        "/api/auth/register",
        json={
            "organization_name": "Evidence Org",
            "full_name": "Reviewer",
            "email": "evidence@example.com",
            "password": "secure-evidence-password-123",
        },
    )
    headers = {"Authorization": f"Bearer {registration.json()['access_token']}"}
    upload = client.post(
        "/api/content/upload",
        headers=headers,
        files={"file": ("claim.txt", b"Our service is 100% effective.", "text/plain")},
    )
    assert upload.status_code == 201

    analysis = client.post(f"/api/analysis/{upload.json()['id']}/run", headers=headers)
    assert analysis.status_code == 200
    assert analysis.json()["analysis_status"] == "partial"
    assert "Gemini is not configured" in analysis.json()["analysis_note"]
    finding = analysis.json()["findings"][0]
    assert finding["evidence_status"] == "no_source_found"
    assert finding["evidence_text"] is None
    assert "does not establish that it is false" in finding["explanation"]


def test_ai_citation_remains_needs_verification_until_human_review():
    from app.schemas.analysis import LLMAnalysisOutput
    from app.services.compliance import _safe_llm_findings

    evidence = [
        {
            "id": "approved-rule-id",
            "text": "Use clear and direct language.",
            "title": "Writing style",
        }
    ]
    output = LLMAnalysisOutput.model_validate(
        {
            "findings": [
                {
                    "category": "tone_of_voice",
                    "affected_text": "The product changes everything.",
                    "explanation": "The phrase may be inconsistent with the brand voice.",
                    "severity": "medium",
                    "confidence": 0.8,
                    "evidence_rule_id": "approved-rule-id",
                }
            ]
        }
    )

    finding = _safe_llm_findings(
        "The product changes everything.", output, evidence
    )[0]
    assert finding["source_rule"] == evidence[0]
    assert finding["evidence_status"] == "needs_verification"


def test_ai_citation_without_valid_rule_id_is_reported_as_no_source_found():
    from app.schemas.analysis import LLMAnalysisOutput
    from app.services.compliance import _safe_llm_findings

    evidence = [
        {
            "id": "approved-rule-id",
            "text": "Use clear and direct language.",
            "title": "Writing style",
        }
    ]
    output = LLMAnalysisOutput.model_validate(
        {
            "findings": [
                {
                    "category": "tone_of_voice",
                    "affected_text": "The product changes everything.",
                    "explanation": "The phrase may be inconsistent with the brand voice.",
                    "severity": "medium",
                    "confidence": 0.8,
                    "evidence_rule_id": "missing-rule-id",
                }
            ]
        }
    )

    finding = _safe_llm_findings(
        "The product changes everything.", output, evidence
    )[0]
    assert finding["source_rule"] is None
    assert finding["evidence_status"] == "no_source_found"


def test_retrieval_rejects_irrelevant_hits(monkeypatch):
    from app.rag import guideline_index

    class FakeCollection:
        def count(self):
            return 1

        def query(self, **kwargs):
            return {
                "documents": [["not relevant"]],
                "metadatas": [[{"organization_id": "org-1", "rule_id": "rule-1"}]],
                "distances": [[9.5]],
            }

    monkeypatch.setattr(guideline_index, "_collection", lambda organization_id: FakeCollection())

    assert guideline_index.retrieve_guideline_chunks("org-1", "only relevant text") == []


def test_gemini_client_uses_configured_request_timeout(monkeypatch):
    from app.ai import gemini
    from app.core.config import settings

    captured = {}

    def fake_client(**kwargs):
        captured.update(kwargs)
        return object()

    monkeypatch.setattr(settings, "gemini_api_key", "test-key")
    monkeypatch.setattr(settings, "gemini_timeout_ms", 2345)
    monkeypatch.setattr(gemini.genai, "Client", fake_client)

    gemini._client()

    assert captured["http_options"].timeout == 2345
    assert captured["http_options"].retry_options.attempts == settings.gemini_retry_attempts
    assert 503 in captured["http_options"].retry_options.http_status_codes


def test_gemini_retries_transient_transport_error_with_real_fallback_model(monkeypatch):
    from httpx import TimeoutException

    from app.ai import gemini
    from app.core.config import settings

    calls = []

    class FakeModels:
        def generate_content(self, *, model, contents, config):
            calls.append(model)
            if model == "primary-model":
                raise TimeoutException("request timed out")
            return object()

    class FakeClient:
        models = FakeModels()

        def close(self):
            pass

    monkeypatch.setattr(settings, "gemini_api_key", "test-key")
    monkeypatch.setattr(settings, "gemini_model", "primary-model")
    monkeypatch.setattr(settings, "gemini_fallback_model", "fallback-model")
    monkeypatch.setattr(gemini, "_client", lambda: FakeClient())

    response, model = gemini._generate_content("claim and retrieved sources", config={})

    assert response is not None
    assert model == "fallback-model"
    assert calls == ["primary-model", "fallback-model"]
