import hashlib
import io
import json
from types import SimpleNamespace
from urllib.error import URLError

from PIL import Image, ImageDraw


def register(client, email, organization):
    response = client.post(
        "/api/auth/register",
        json={
            "organization_name": organization,
            "full_name": "Test Owner",
            "email": email,
            "password": "secure-test-password-987",
        },
    )
    assert response.status_code == 201
    return response.json()["access_token"]


def png_bytes():
    image = Image.new("RGB", (240, 120), "white")
    draw = ImageDraw.Draw(image)
    draw.ellipse((35, 25, 95, 85), fill=(20, 70, 180))
    draw.rectangle((115, 42, 205, 68), fill=(20, 70, 180))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


class SearchResponse:
    def __init__(self, value):
        self.value = value

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self):
        return json.dumps(self.value).encode("utf-8")


def test_visual_provider_fallback_reference_comparison_and_review(client, tmp_path, monkeypatch):
    from app.core.config import settings
    from app.services import visual_brand_compliance

    monkeypatch.setattr(settings, "upload_directory", str(tmp_path / "uploads"))
    monkeypatch.setattr(settings, "gemini_api_key", "")
    monkeypatch.setattr(visual_brand_compliance, "pytesseract", None)
    token = register(client, "visual@northstar.com", "Northstar")
    headers = {"Authorization": f"Bearer {token}"}
    other_headers = {
        "Authorization": f"Bearer {register(client, 'other@northstar.com', 'Other Org')}"
    }

    reference = client.post(
        "/api/brand-assets/upload",
        headers=headers,
        data={"asset_kind": "logo_reference"},
        files={"file": ("reference.png", png_bytes(), "image/png")},
    )
    assert reference.status_code == 201
    reference_id = reference.json()["id"]
    assert reference.json()["approved"] is False
    assert client.put(f"/api/brand-assets/{reference_id}/approve", headers=headers).status_code == 200

    candidate = client.post(
        "/api/brand-assets/upload",
        headers=headers,
        files={"file": ("campaign.png", png_bytes(), "image/png")},
    )
    assert candidate.status_code == 201
    candidate_id = candidate.json()["id"]
    assert client.get(
        f"/api/brand-assets/{candidate_id}", headers=other_headers
    ).status_code == 404

    analysis = client.post(f"/api/brand-assets/{candidate_id}/analyze", headers=headers)
    assert analysis.status_code == 200
    report = analysis.json()
    assert report["provider_status"]["vision"] == "not_configured"
    assert report["provider_status"]["ocr"] == "not_installed"
    assert report["logo_matches"][0]["status"] == "matched"
    assert report["logo_matches"][0]["similarity"] >= 0.88
    assert not any(
        finding["category"] == "logo_compliance"
        for finding in report["findings"]
    )
    assert all(finding["evidence"] for finding in report["findings"])
    assert all(
        finding["verification_status"] != "confirmed_violation"
        for finding in report["findings"]
    )

    review = client.post(
        f"/api/brand-assets/{candidate_id}/analysis/{report['analysis_id']}/review",
        headers=headers,
        json={"decision": "approve"},
    )
    assert review.status_code == 200
    assert review.json()["review_status"] == "approved"
    assert review.json()["review_history"][0]["decision"] == "approve"
    latest = client.get(
        f"/api/brand-assets/{candidate_id}/analysis/latest", headers=headers
    )
    assert latest.status_code == 200
    assert latest.json()["review_history"][0]["new_status"] == "approved"

    monkeypatch.setattr(settings, "gemini_api_key", "test-vision-key")
    from app.ai import gemini

    def failed_vision(*args, **kwargs):
        raise RuntimeError("vision provider unavailable")

    monkeypatch.setattr(gemini, "inspect_visual_with_gemini", failed_vision)
    unavailable = client.post(
        f"/api/brand-assets/{candidate_id}/analyze", headers=headers
    )
    assert unavailable.status_code == 200
    assert unavailable.json()["provider_status"]["vision"] == "unavailable"
    assert all(finding["evidence"] for finding in unavailable.json()["findings"])

    monkeypatch.setattr(
        gemini,
        "inspect_visual_with_gemini",
        lambda *args, **kwargs: gemini.VisualInspectionOutput(
            observations=[
                gemini.VisualObservation(
                    category="logo",
                    description="A logo mark resembles the approved reference.",
                    detected_value="blue circular mark",
                    expected_brand_value="reference.png",
                    confidence=0.96,
                    evidence="The mark silhouette and adjacent wordmark are visible.",
                    bounding_box=[0.1, 0.1, 0.7, 0.6],
                ),
                gemini.VisualObservation(
                    category="typography_analysis",
                    description="Font family is uncertain.",
                    confidence=0.45,
                    evidence="Small text is partially obscured.",
                ),
                gemini.VisualObservation(
                    category="tagline",
                    description="Visible brand text reads Northstar.",
                    detected_value="Northstar",
                    confidence=0.81,
                    evidence="The word Northstar is visible beside the mark.",
                ),
            ],
            recognized_text=["Northstar"],
            typography_summary="One prominent heading and supporting text.",
            layout_summary="Left-aligned logo and headline.",
        ),
    )
    modeled = client.post(
        f"/api/brand-assets/{candidate_id}/analyze", headers=headers
    )
    assert modeled.status_code == 200
    model_report = modeled.json()
    assert model_report["provider_status"]["vision"] == "available"
    model_findings = [
        finding
        for finding in model_report["findings"]
        if finding["id"].startswith("visual-model-")
    ]
    assert model_findings[0]["verification_status"] == "potential_violation"
    assert model_findings[1]["verification_status"] == "needs_verification"
    assert model_findings[0]["category"] == "logo_compliance"
    assert model_findings[2]["category"] == "visible_text"
    assert all(
        finding["verification_status"] != "confirmed_violation"
        for finding in model_findings
    )

    user_response = client.post(
        "/api/auth/users",
        headers=headers,
        json={
            "full_name": "Content Creator",
            "email": "creator@northstar.com",
            "password": "secure-creator-password-987",
            "role": "content_creator",
        },
    )
    assert user_response.status_code == 201
    creator_login = client.post(
        "/api/auth/login",
        json={
            "email": "creator@northstar.com",
            "password": "secure-creator-password-987",
        },
    )
    creator_headers = {
        "Authorization": f"Bearer {creator_login.json()['access_token']}"
    }
    denied_review = client.post(
        f"/api/brand-assets/{candidate_id}/analysis/{report['analysis_id']}/review",
        headers=creator_headers,
        json={"decision": "approve"},
    )
    assert denied_review.status_code == 403

    analytics = client.get("/api/dashboard/analytics?days=30", headers=headers)
    assert analytics.status_code == 200
    assert analytics.json()["visual_compliance_trends"][0]["analyzed_assets"] == 1
    assert any(
        activity["action"] == "visual_analysis.review.approve"
        for activity in client.get("/api/dashboard/overview", headers=headers).json()["recent_activities"]
    )


def test_visual_analysis_flags_distinct_logo_and_palette_as_review_candidates(
    client, tmp_path, monkeypatch
):
    from app.core.config import settings
    from app.services import visual_brand_compliance

    monkeypatch.setattr(settings, "upload_directory", str(tmp_path / "uploads"))
    monkeypatch.setattr(settings, "gemini_api_key", "")
    monkeypatch.setattr(visual_brand_compliance, "pytesseract", None)
    token = register(client, "logo-check@example.com", "Logo Check Org")
    headers = {"Authorization": f"Bearer {token}"}

    reference = client.post(
        "/api/brand-assets/upload",
        headers=headers,
        data={"asset_kind": "logo_reference"},
        files={"file": ("approved-logo.png", png_bytes(), "image/png")},
    )
    assert reference.status_code == 201
    assert client.put(
        f"/api/brand-assets/{reference.json()['id']}/approve", headers=headers
    ).status_code == 200

    incorrect_image = Image.new("RGB", (240, 120), (190, 25, 30))
    incorrect_bytes = io.BytesIO()
    incorrect_image.save(incorrect_bytes, format="PNG")
    candidate = client.post(
        "/api/brand-assets/upload",
        headers=headers,
        files={
            "file": (
                "incorrect-logo.png",
                incorrect_bytes.getvalue(),
                "image/png",
            )
        },
    )
    assert candidate.status_code == 201

    response = client.post(
        f"/api/brand-assets/{candidate.json()['id']}/analyze",
        headers=headers,
        params={"logo_required": "true"},
    )

    assert response.status_code == 200
    report = response.json()
    assert report["logo_matches"][0]["similarity"] < 0.82
    assert any(
        finding["category"] == "logo_compliance"
        and finding["verification_status"] == "needs_verification"
        for finding in report["findings"]
    )
    colour_findings = [
        finding for finding in report["findings"]
        if finding["category"] == "brand_colour"
    ]
    assert colour_findings
    assert colour_findings[0]["evidence"][0]["approved_reference_asset_ids"] == [
        reference.json()["id"]
    ]
    assert report["typography_analysis"]["font_family_estimate"]
    assert report["typography_analysis"]["layout"]
    assert all(
        finding["verification_status"] != "confirmed_violation"
        for finding in report["findings"]
    )


def test_visual_ocr_layout_reports_edge_alignment_and_type_scale_for_review():
    from app.services.visual_brand_compliance import _text_layout_findings

    regions = [
        {"text": "Brand", "confidence": 0.95, "bounding_box": [0.01, 0.08, 0.3, 0.04]},
        {"text": "Headline", "confidence": 0.9, "bounding_box": [0.01, 0.28, 0.4, 0.02]},
        {"text": "Body", "confidence": 0.9, "bounding_box": [0.01, 0.5, 0.25, 0.02]},
        {"text": "Footer", "confidence": 0.92, "bounding_box": [0.22, 0.82, 0.3, 0.01]},
    ]

    lines, findings = _text_layout_findings(regions)

    assert len(lines) == 4
    assert {finding["category"] for finding in findings} == {
        "layout",
        "typography_analysis",
    }
    assert all(
        finding["verification_status"] == "needs_verification"
        for finding in findings
    )
    assert any("canvas edge" in finding["description"] for finding in findings)
    assert any("alignment outlier" in finding["description"] for finding in findings)
    assert any("2.5×" in finding["description"] for finding in findings)


def test_gemini_visual_response_uses_provider_compatible_required_fields(monkeypatch):
    from app.ai import gemini

    captured = {}

    def generate_content(*, contents, config):
        captured["contents"] = contents
        captured["config"] = config
        return (
            SimpleNamespace(
                text=json.dumps(
                    {
                        "observations": [
                            {
                                "category": "typography_analysis",
                                "description": "Font family cannot be determined.",
                                "detected_value": "",
                                "expected_brand_value": "",
                                "confidence": 0.4,
                                "evidence": "The lettering is too small to identify.",
                                "bounding_box": [],
                            }
                        ],
                        "recognized_text": ["Northstar"],
                        "typography_summary": "One heading is visible.",
                        "layout_summary": "The heading is centered.",
                    }
                ),
                model_version="gemini-3.6-flash",
            ),
            "gemini-3.5-flash",
        )

    monkeypatch.setattr(gemini, "_generate_content", generate_content)

    result = gemini.inspect_visual_with_gemini(png_bytes(), "image/png", [])

    schema = captured["config"].response_schema.model_json_schema()
    assert "anyOf" not in json.dumps(schema)
    assert result.observations[0].detected_value is None
    assert result.observations[0].expected_brand_value is None
    assert result.observations[0].bounding_box is None
    assert result.recognized_text == ["Northstar"]
    assert result._model_used == "gemini-3.6-flash"


def test_gemini_text_bounds_produce_separate_reviewable_layout_findings(
    monkeypatch,
):
    from app.ai import gemini
    from app.core.config import settings
    from app.services import visual_brand_compliance

    observations = [
        gemini.VisualObservation(
            category="brand text",
            description=f"Visible text: {text}.",
            detected_value=text,
            confidence=0.9,
            evidence=f"The text {text} is visible.",
            bounding_box=box,
        )
        for text, box in (
            ("Brand", [0.01, 0.08, 0.3, 0.04]),
            ("Headline", [0.01, 0.28, 0.4, 0.02]),
            ("Body", [0.01, 0.5, 0.25, 0.02]),
            ("Footer", [0.22, 0.82, 0.3, 0.01]),
        )
    ]
    monkeypatch.setattr(settings, "gemini_api_key", "configured-test-key")
    monkeypatch.setattr(visual_brand_compliance, "pytesseract", None)
    monkeypatch.setattr(
        gemini,
        "inspect_visual_with_gemini",
        lambda *args, **kwargs: gemini.VisualInspectionOutput(
            observations=observations,
            recognized_text=["Brand", "Headline", "Body", "Footer"],
        ),
    )

    report = visual_brand_compliance.analyze_visual_asset_with_providers(
        "campaign.png",
        png_bytes(),
        "image/png",
    )

    geometry_findings = [
        finding
        for finding in report["findings"]
        if finding["category"] in {"layout", "typography_analysis"}
    ]
    assert report["provider_status"]["ocr"] == "vision_model_text_recognition"
    assert len(report["layout_analysis"]["vision_text_line_regions"]) == 4
    assert {finding["category"] for finding in geometry_findings} == {
        "layout",
        "typography_analysis",
    }
    assert all(
        finding["verification_status"] == "needs_verification"
        for finding in geometry_findings
    )
    assert all(
        "Gemini vision" in finding["evidence"][0]["method"]
        for finding in geometry_findings
    )


def test_tesseract_adapter_preserves_detected_text_and_confidence(monkeypatch):
    from app.services import visual_brand_compliance

    fake_tesseract = SimpleNamespace(
        pytesseract=SimpleNamespace(tesseract_cmd=None),
        Output=SimpleNamespace(DICT="dict"),
        image_to_data=lambda *args, **kwargs: {
            "text": ["Northstar", "helps"],
            "conf": ["92", "84"],
            "block_num": [1, 1],
            "par_num": [1, 1],
            "line_num": [1, 1],
        },
    )
    monkeypatch.setattr(visual_brand_compliance, "pytesseract", fake_tesseract)
    findings = visual_brand_compliance.analyze_visual_asset(
        "campaign.png",
        png_bytes(),
    )
    typography_finding = next(
        item for item in findings["findings"] if item["category"] == "typography_analysis"
    )
    assert findings["ocr_text"] == ["Northstar helps"]
    assert typography_finding["confidence"] == 0.88
    assert typography_finding["evidence"][0]["recognized_text"] == ["Northstar helps"]


def test_external_search_no_results_is_not_a_contradiction(client, monkeypatch):
    from app.core.config import settings
    from app.services import external_search

    monkeypatch.setattr(settings, "external_search_provider", "tavily")
    monkeypatch.setattr(settings, "tavily_api_key", "test-token")
    monkeypatch.setattr(settings, "gemini_api_key", "")
    monkeypatch.setattr(external_search, "urlopen", lambda *args, **kwargs: SearchResponse({"results": []}))
    token = register(client, "empty-search@example.com", "Search Org")
    headers = {"Authorization": f"Bearer {token}"}

    response = client.post(
        "/api/evidence/verify",
        headers=headers,
        json={"text": "Our service guarantees consistent revenue results."},
    )
    assert response.status_code == 200
    result = response.json()[0]
    assert result["status"] == "insufficient_evidence"
    assert result["status"] != "contradicted"
    assert result["provider_status"] == "no_results"
    assert result["retrieval_timestamp"]
    assert result["evidence"] == []

    analytics = client.get("/api/dashboard/analytics?days=30", headers=headers)
    assert analytics.json()["claim_verification_trends"][0]["insufficient_evidence"] == 1
    overview = client.get("/api/dashboard/overview", headers=headers).json()
    assert any(
        activity["action"] == "claim_verification.run"
        for activity in overview["recent_activities"]
    )


def test_claim_reviewer_filter_includes_each_historical_reviewer(client, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "external_search_provider", "disabled")
    admin_token = register(client, "claim-review-admin@example.com", "Claim Review Org")
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    admin_id = client.get("/api/auth/me", headers=admin_headers).json()["id"]

    created = client.post(
        "/api/auth/users",
        headers=admin_headers,
        json={
            "full_name": "Second Reviewer",
            "email": "second-claim-reviewer@example.com",
            "password": "secure-second-reviewer-password-123",
            "role": "reviewer",
        },
    )
    assert created.status_code == 201
    reviewer_login = client.post(
        "/api/auth/login",
        json={
            "email": "second-claim-reviewer@example.com",
            "password": "secure-second-reviewer-password-123",
        },
    )
    reviewer_headers = {
        "Authorization": f"Bearer {reviewer_login.json()['access_token']}"
    }

    result = client.post(
        "/api/evidence/verify",
        headers=admin_headers,
        json={"text": "Our service guarantees consistent revenue results."},
    ).json()[0]
    admin_decision = client.post(
        f"/api/evidence/{result['id']}/review",
        headers=admin_headers,
        json={"decision": "approve"},
    )
    reviewer_decision = client.post(
        f"/api/evidence/{result['id']}/review",
        headers=reviewer_headers,
        json={
            "decision": "request_additional_evidence",
            "comment": "Please attach the underlying study.",
        },
    )
    assert admin_decision.status_code == 200
    assert reviewer_decision.status_code == 200
    assert reviewer_decision.json()["status"] == result["status"]

    admin_analytics = client.get(
        f"/api/dashboard/analytics?reviewer_id={admin_id}",
        headers=admin_headers,
    )
    reviewer_analytics = client.get(
        f"/api/dashboard/analytics?reviewer_id={created.json()['id']}",
        headers=admin_headers,
    )

    assert admin_analytics.status_code == 200
    assert reviewer_analytics.status_code == 200
    assert admin_analytics.json()["claim_verification_trends"][0][
        "needs_review"
    ] == 1
    assert reviewer_analytics.json()["claim_verification_trends"][0][
        "needs_review"
    ] == 1


def test_prohibitive_rule_does_not_support_assertion_and_is_not_duplicated():
    from app.services.evidence_verification import verify_claims

    rule = {
        "id": "approved-claims-rule",
        "guideline_id": "approved-guideline",
        "source_type": "internal",
        "title": "Claims standard",
        "text": "Do not use the phrase clinically proven unless supporting evidence is approved.",
        "created_at": "2026-01-01T00:00:00+00:00",
    }

    result = verify_claims(
        "Our serum is clinically proven to cure all skin conditions.",
        [rule],
    )[0]

    assert result["status"] == "contradicted"
    assert len(result["evidence"]) == 1


def test_internal_claim_support_rejects_incidental_keyword_overlap():
    from app.services.evidence_verification import verify_claims

    unrelated_rule = {
        "id": "unrelated-service-rule",
        "guideline_id": "approved-guideline",
        "title": "Approved policy",
        "text": "Approved service guidance describes the safe warehouse access process.",
        "source_type": "internal",
    }
    relevant_rule = {
        "id": "relevant-service-rule",
        "guideline_id": "approved-guideline",
        "title": "Approved policy",
        "text": "Our service helps small teams process orders 30% faster.",
        "source_type": "internal",
    }
    claim = "Our service works well for small teams every day."

    unrelated_result = verify_claims(claim, [unrelated_rule])[0]
    relevant_result = verify_claims(
        "Our service helps small teams process orders 30% faster.",
        [relevant_rule],
    )[0]

    assert unrelated_result["status"] == "needs_review"
    assert relevant_result["status"] == "supported"


def test_claim_taxonomy_detects_percentages_and_subjective_copy():
    from app.services.evidence_verification import extract_claims

    claims = extract_claims(
        "Our product improves results by 20%. A beautiful experience awaits."
    )

    assert claims[0]["claim_type"] == "statistical"
    assert claims[0]["time_sensitive"] is False
    assert claims[1]["claim_type"] == "subjective_marketing"


def test_time_sensitive_claim_does_not_accept_stale_sources(client, monkeypatch):
    from app.core.config import settings
    from app.services import external_search
    from app.ai import gemini

    source_url = "https://research.example.org/current-rate"
    source_id = hashlib.sha256(source_url.encode("utf-8")).hexdigest()[:24]
    monkeypatch.setattr(settings, "external_search_provider", "tavily")
    monkeypatch.setattr(settings, "tavily_api_key", "test-token")
    monkeypatch.setattr(settings, "gemini_api_key", "configured-test-key")
    monkeypatch.setattr(
        external_search,
        "urlopen",
        lambda *args, **kwargs: SearchResponse(
            {
                "results": [
                    {
                        "title": "Historical rate study",
                        "url": source_url,
                        "content": "The current market rate is 20 percent based on the annual study.",
                        "published_date": "2000-01-01",
                        "score": 0.99,
                    }
                ]
            }
        ),
    )
    monkeypatch.setattr(
        gemini,
        "assess_claim_with_gemini",
        lambda *_args, **_kwargs: SimpleNamespace(
            supporting_source_ids=[source_id],
            contradicting_source_ids=[],
            confidence=0.99,
            rationale="The old source appears to support the claim.",
        ),
    )
    token = register(client, "stale-source@example.com", "Freshness Org")
    headers = {"Authorization": f"Bearer {token}"}

    response = client.post(
        "/api/evidence/verify",
        headers=headers,
        json={"text": "The current market rate is 20 percent."},
    )

    assert response.status_code == 200
    claim = response.json()[0]
    assert claim["claim_type"] == "statistical"
    assert claim["time_sensitive"] is True
    assert claim["status"] == "needs_review"
    assert claim["last_verified_at"]
    assert claim["assessment_status"] == "available"
    assert claim["evidence"][0]["freshness_status"] == "stale"
    assert claim["evidence"][0]["evidence_relation"] == "unassessed"


def test_external_search_rejects_non_public_or_invalid_source_urls(monkeypatch):
    from app.core.config import settings
    from app.services import external_search

    monkeypatch.setattr(settings, "external_search_provider", "tavily")
    monkeypatch.setattr(settings, "tavily_api_key", "test-token")
    monkeypatch.setattr(
        external_search,
        "urlopen",
        lambda *args, **kwargs: SearchResponse(
            {
                "results": [
                    {"title": "Insecure", "url": "http://example.org/page", "content": "excerpt"},
                    {"title": "Local", "url": "https://127.0.0.1/private", "content": "excerpt"},
                    {"title": "Credentials", "url": "https://user:pass@example.org/page", "content": "excerpt"},
                    {"title": "Valid", "url": "https://example.org/study", "content": "verified excerpt"},
                ]
            }
        ),
    )

    retrieval = external_search.search_claim_sources("a sufficiently detailed claim")

    assert retrieval["status"] == "results_found"
    assert len(retrieval["sources"]) == 1
    assert retrieval["sources"][0]["source_url"] == "https://example.org/study"
    assert retrieval["sources"][0]["retrieved_at"]


def test_conflicting_external_evidence_remains_for_human_review(client, monkeypatch):
    from datetime import date

    from app.core.config import settings
    from app.services import external_search

    supporting_url = "https://research.example.org/studies/sleep"
    contradicting_url = "https://health.example.org/reports/sleep"
    supporting_id = hashlib.sha256(supporting_url.encode("utf-8")).hexdigest()[:24]
    contradicting_id = hashlib.sha256(contradicting_url.encode("utf-8")).hexdigest()[:24]
    monkeypatch.setattr(settings, "external_search_provider", "tavily")
    monkeypatch.setattr(settings, "tavily_api_key", "test-token")
    monkeypatch.setattr(settings, "gemini_api_key", "test-assessor-key")
    monkeypatch.setattr(
        external_search,
        "urlopen",
        lambda *args, **kwargs: SearchResponse(
            {
                "results": [
                    {
                        "title": "Controlled supporting excerpt",
                        "url": supporting_url,
                        "content": "The supplement improves adult sleep duration in a controlled trial.",
                        "published_date": date.today().isoformat(),
                        "score": 0.95,
                    },
                    {
                        "title": "Controlled contradicting excerpt",
                        "url": contradicting_url,
                        "content": "The supplement does not improve adult sleep duration in a controlled trial.",
                        "published_date": date.today().isoformat(),
                        "score": 0.95,
                    },
                ]
            }
        ),
    )
    from app.ai import gemini

    monkeypatch.setattr(
        gemini,
        "assess_claim_with_gemini",
        lambda *_args, **_kwargs: SimpleNamespace(
            supporting_source_ids=[supporting_id],
            contradicting_source_ids=[contradicting_id],
            confidence=0.96,
            rationale="The retrieved evidence conflicts.",
        ),
    )
    token = register(client, "conflict@example.com", "Conflicting Evidence Org")
    headers = {"Authorization": f"Bearer {token}"}

    response = client.post(
        "/api/evidence/verify",
        headers=headers,
        json={"text": "The supplement improves adult sleep duration."},
    )

    assert response.status_code == 200
    result = response.json()[0]
    assert result["status"] == "needs_review"
    assert "conflicting" in result["reason"].lower()
    assert {item["evidence_relation"] for item in result["evidence"]} == {
        "supporting",
        "contradicting",
    }


def test_client_supplied_citations_are_not_trusted_as_retrieved_sources(client, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "external_search_provider", "disabled")
    token = register(client, "provided@example.com", "Provided Evidence")
    headers = {"Authorization": f"Bearer {token}"}
    response = client.post(
        "/api/evidence/verify",
        headers=headers,
        json={
            "text": "The comet is green in every picture today.",
            "evidence": [
                {
                    "title": "Unverified source",
                    "text": "The comet is green in every picture today.",
                    "source_url": "https://unverified.example/source",
                    "source_type": "external",
                    "citation_valid": True,
                }
            ],
        },
    )
    assert response.status_code == 200
    result = response.json()[0]
    assert result["status"] == "needs_review"
    assert result["evidence"][0]["source_type"] == "user_supplied"
    assert result["evidence"][0]["citation_valid"] is False


def test_external_sources_are_citation_checked_and_fail_closed_when_assessor_is_uncertain(
    client, monkeypatch
):
    from app.core.config import settings
    from app.services import external_search

    source_url = "https://example.org/study/claim"
    source_id = hashlib.sha256(source_url.encode("utf-8")).hexdigest()[:24]
    monkeypatch.setattr(settings, "external_search_provider", "tavily")
    monkeypatch.setattr(settings, "tavily_api_key", "test-token")
    monkeypatch.setattr(settings, "gemini_api_key", "configured-test-key")
    monkeypatch.setattr(
        external_search,
        "urlopen",
        lambda *args, **kwargs: SearchResponse(
            {
                "results": [
                    {
                        "title": "Study excerpt",
                        "url": source_url,
                        "content": "The report examines consistent revenue outcomes.",
                        "published_date": "2025-01-02",
                        "score": 0.9,
                    }
                ]
            }
        ),
    )
    from app.ai import gemini

    assessment = SimpleNamespace(
        supporting_source_ids=["unretrieved-id"],
        contradicting_source_ids=[],
        confidence=0.99,
        rationale="The test assessment cites an unreturned source.",
    )
    monkeypatch.setattr(gemini, "assess_claim_with_gemini", lambda claim, sources: assessment)
    token = register(client, "source-check@example.com", "Evidence Org")
    headers = {"Authorization": f"Bearer {token}"}

    response = client.post(
        "/api/evidence/verify",
        headers=headers,
        json={"text": "Our service guarantees consistent revenue results."},
    )
    assert response.status_code == 200
    result = response.json()[0]
    external = next(item for item in result["evidence"] if item["source_type"] == "external")
    assert result["status"] == "needs_review"
    assert external["evidence_relation"] == "unassessed"
    assert external["citation_valid"] is True
    assert result["assessment_rationale"] is None
    assert result["assessment_source_ids"] == []

    assessment.contradicting_source_ids = [source_id]
    response = client.post(
        "/api/evidence/verify",
        headers=headers,
        json={"text": "Our service guarantees consistent revenue results."},
    )
    result = response.json()[0]
    external = next(item for item in result["evidence"] if item["source_type"] == "external")
    assert result["status"] == "contradicted"
    assert result["provider_status"] == "results_found"
    assert external["source_url"] == source_url
    assert external["citation_valid"] is True
    assert external["evidence_relation"] == "contradicting"
    assert external["published_at"] == "2025-01-02"
    assert external["retrieved_at"]
    assert external["freshness_days"] > 0
    assert external["relevance_score"] > 0
    assert external["credibility_score"] > 0
    assert result["assessment_rationale"] == assessment.rationale
    assert result["assessment_source_ids"] == [source_id]
    assert result["assessment_model"] == settings.gemini_model


def test_gemini_provider_error_is_persisted_without_claiming_an_assessment(
    client, monkeypatch
):
    from app.core.config import settings
    from app.services import external_search
    from app.ai import gemini

    source_url = "https://www.ftc.gov/about-ftc"
    monkeypatch.setattr(settings, "external_search_provider", "tavily")
    monkeypatch.setattr(settings, "tavily_api_key", "test-token")
    monkeypatch.setattr(settings, "gemini_api_key", "configured-test-key")
    monkeypatch.setattr(
        external_search,
        "urlopen",
        lambda *args, **kwargs: SearchResponse(
            {
                "results": [
                    {
                        "title": "About the FTC",
                        "url": source_url,
                        "content": "The Federal Trade Commission is an independent agency of the United States government.",
                        "score": 0.99,
                    }
                ]
            }
        ),
    )

    class ProviderUnavailable(Exception):
        code = 503

    def fail_assessment(*_args, **_kwargs):
        raise ProviderUnavailable()

    monkeypatch.setattr(gemini, "assess_claim_with_gemini", fail_assessment)
    token = register(client, "provider-error@example.com", "Provider Error Org")
    response = client.post(
        "/api/evidence/verify",
        headers={"Authorization": f"Bearer {token}"},
        json={"text": "The Federal Trade Commission is a United States government agency."},
    )

    assert response.status_code == 200
    result = response.json()[0]
    assert result["provider_status"] == "results_found"
    assert result["assessment_status"] == "unavailable"
    assert result["assessment_error_type"] == "ProviderUnavailable"
    assert result["assessment_error_code"] == 503
    assert result["assessment_model"] is None
    assert result["assessment_rationale"] is None
    assert result["status"] == "needs_review"
    external = next(item for item in result["evidence"] if item["source_type"] == "external")
    assert external["source_url"] == source_url
    assert external["evidence_relation"] == "unassessed"
    assert external["freshness_days"] is None
    assert external["relevance_score"] > 0
    assert external["credibility_score"] > 0


def test_missing_credentials_and_search_errors_remain_unverified(client, monkeypatch):
    from app.core.config import settings
    from app.services import external_search

    monkeypatch.setattr(settings, "external_search_provider", "tavily")
    monkeypatch.setattr(settings, "tavily_api_key", "")
    token = register(client, "unavailable@example.com", "Unavailable Org")
    headers = {"Authorization": f"Bearer {token}"}

    missing_key = client.post(
        "/api/evidence/verify",
        headers=headers,
        json={"text": "Our service is available to every customer."},
    )
    assert missing_key.status_code == 200
    assert missing_key.json()[0]["status"] == "needs_review"
    assert missing_key.json()[0]["provider_status"] == "missing_credentials"

    monkeypatch.setattr(settings, "tavily_api_key", "test-token")

    def fail_search(*args, **kwargs):
        raise URLError("temporary outage")

    monkeypatch.setattr(external_search, "urlopen", fail_search)
    failed = client.post(
        "/api/evidence/verify",
        headers=headers,
        json={"text": "Our service is available to every customer."},
    )
    assert failed.status_code == 200
    assert failed.json()[0]["status"] == "needs_review"
    assert failed.json()[0]["provider_status"] == "unavailable"


def test_unified_analysis_persists_claim_results_with_submission_scope(
    client, tmp_path, monkeypatch
):
    from app.core.config import settings
    from app.rag import guideline_index

    monkeypatch.setattr(settings, "upload_directory", str(tmp_path / "uploads"))
    monkeypatch.setattr(settings, "chroma_persist_directory", str(tmp_path / "chroma"))
    monkeypatch.setattr(settings, "external_search_provider", "disabled")
    monkeypatch.setattr(settings, "gemini_api_key", "")
    guideline_index._client.cache_clear()
    guideline_index._embedding_function.cache_clear()
    token = register(client, "unified@example.com", "Unified Org")
    headers = {"Authorization": f"Bearer {token}"}
    submission = client.post(
        "/api/content/upload",
        headers=headers,
        files={"file": ("draft.txt", b"Our service is guaranteed.", "text/plain")},
    )
    assert submission.status_code == 201

    analysis = client.post(
        f"/api/analysis/{submission.json()['id']}/run", headers=headers
    )
    assert analysis.status_code == 200
    claims = analysis.json()["claim_verifications"]
    assert claims
    assert claims[0]["status"] == "needs_review"
    assert claims[0]["provider_status"] == "not_configured"
    assert claims[0]["created_at"]

    analytics = client.get("/api/dashboard/analytics?days=30", headers=headers)
    assert analytics.json()["claim_verification_trends"][0]["needs_review"] >= 1


def test_visual_analysis_joins_unified_report_and_governance_analytics(
    client, tmp_path, monkeypatch
):
    from app.core.config import settings

    monkeypatch.setattr(settings, "upload_directory", str(tmp_path / "uploads"))
    monkeypatch.setattr(settings, "external_search_provider", "disabled")
    monkeypatch.setattr(settings, "gemini_api_key", "")
    token = register(client, "unified-visual@example.com", "Unified Visual Org")
    headers = {"Authorization": f"Bearer {token}"}

    submission = client.post(
        "/api/content/upload",
        headers=headers,
        files={"file": ("campaign.txt", b"Our service guarantees consistent revenue results.", "text/plain")},
    )
    assert submission.status_code == 201
    content_analysis = client.post(
        f"/api/analysis/{submission.json()['id']}/run", headers=headers
    )
    assert content_analysis.status_code == 200

    asset = client.post(
        "/api/brand-assets/upload",
        headers=headers,
        files={"file": ("creative.png", png_bytes(), "image/png")},
    )
    assert asset.status_code == 201
    visual_analysis = client.post(
        f"/api/brand-assets/{asset.json()['id']}/analyze",
        headers=headers,
        params={"submission_id": submission.json()["id"]},
    )
    assert visual_analysis.status_code == 200
    assert visual_analysis.json()["submission_id"] == submission.json()["id"]

    unified_report = client.get(
        f"/api/analysis/{content_analysis.json()['id']}", headers=headers
    )
    assert unified_report.status_code == 200
    visual_results = unified_report.json()["visual_analyses"]
    assert len(visual_results) == 1
    assert visual_results[0]["analysis_id"] == visual_analysis.json()["analysis_id"]
    assert visual_results[0]["review_status"] == "pending"

    decision = client.post(
        f"/api/brand-assets/{asset.json()['id']}/analysis/"
        f"{visual_analysis.json()['analysis_id']}/review",
        headers=headers,
        json={"decision": "approve"},
    )
    assert decision.status_code == 200
    refreshed_report = client.get(
        f"/api/analysis/{content_analysis.json()['id']}", headers=headers
    ).json()
    assert refreshed_report["visual_analyses"][0]["review_status"] == "approved"
    assert refreshed_report["visual_analyses"][0]["review_history"][0]["decision"] == "approve"

    other_token = register(client, "other-visual@example.com", "Other Visual Org")
    other_headers = {"Authorization": f"Bearer {other_token}"}
    other_submission = client.post(
        "/api/content/upload",
        headers=other_headers,
        files={"file": ("other.txt", b"Independent organization content.", "text/plain")},
    )
    assert other_submission.status_code == 201
    cross_org = client.post(
        f"/api/brand-assets/{asset.json()['id']}/analyze",
        headers=headers,
        params={"submission_id": other_submission.json()["id"]},
    )
    assert cross_org.status_code == 404
    other_analytics = client.get(
        "/api/dashboard/analytics?days=30", headers=other_headers
    ).json()
    assert other_analytics["visual_compliance_trends"] == []
    assert other_analytics["visual_review_statistics"]["approve"] == 0

    analytics = client.get("/api/dashboard/analytics?days=30", headers=headers).json()
    assert analytics["visual_review_statistics"]["approve"] == 1
    reviewer = next(
        item for item in analytics["reviewer_workload"]
        if item["reviewer_name"] == "Test Owner"
    )
    assert reviewer["decision_count"] == 1
    assert reviewer["visual_decision_count"] == 1
