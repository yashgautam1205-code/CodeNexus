import io
import random

import fitz
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


def pdf(text):
    document = fitz.open()
    document.new_page().insert_text((72, 72), text)
    return document.tobytes()


def png_bytes():
    image = Image.new("RGB", (200, 100), "white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def test_round3_visual_claim_and_analytics_workflow(client, tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "upload_directory", str(tmp_path / "uploads"))
    monkeypatch.setattr(settings, "chroma_persist_directory", str(tmp_path / "chroma"))
    from app.rag import guideline_index

    guideline_index._client.cache_clear()
    guideline_index._embedding_function.cache_clear()

    token = register(client, "round3@northstar.com", "Northstar")
    headers = {"Authorization": f"Bearer {token}"}

    guideline = client.post(
        "/api/guidelines/upload",
        headers=headers,
        files={"file": ("brand-guidance.pdf", pdf("Avoid guaranteed claims and approve brand-approved colours."), "application/pdf")},
    )
    assert guideline.status_code == 201
    guideline_id = guideline.json()["id"]

    rule = client.post(
        "/api/rules",
        headers=headers,
        json={
            "category": "prohibited_terminology",
            "title": "No guaranteed claims",
            "rule_text": "Do not use guaranteed claims in customer-facing marketing.",
            "term": "guaranteed",
            "guideline_id": guideline_id,
            "source_section": "Claims",
            "source_page": 3,
            "replacement_text": "may help",
        },
    )
    assert rule.status_code == 201
    approved = client.put(f"/api/rules/{rule.json()['id']}", headers=headers, json={"approved": True})
    assert approved.status_code == 200
    assert approved.json()["approved"] is True

    verify = client.post(
        "/api/evidence/verify",
        headers=headers,
        json={
            "text": "This product is guaranteed to be #1.",
            "evidence": [{"title": "Brand policy", "text": "Do not use guaranteed claims in customer-facing marketing.", "source_section": "Claims", "source_page": 3}],
        },
    )
    assert verify.status_code == 200
    payload = verify.json()
    assert payload[0]["status"] == "contradicted"
    assert payload[0]["evidence"]
    claim_id = payload[0]["id"]
    missing_comment = client.post(
        f"/api/evidence/{claim_id}/review",
        headers=headers,
        json={"decision": "reject"},
    )
    assert missing_comment.status_code == 422
    review = client.post(
        f"/api/evidence/{claim_id}/review",
        headers=headers,
        json={"decision": "reject", "comment": "The provided evidence is incomplete."},
    )
    assert review.status_code == 200
    assert review.json()["status"] == "contradicted"
    assert review.json()["review_status"] == "rejected"
    assert review.json()["review_history"][0]["comment"] == "The provided evidence is incomplete."

    asset = client.post(
        "/api/brand-assets/upload",
        headers=headers,
        files={"file": ("brand.png", png_bytes(), "image/png")},
    )
    assert asset.status_code == 201
    asset_id = asset.json()["id"]

    report = client.post(f"/api/brand-assets/{asset_id}/analyze", headers=headers)
    assert report.status_code == 200
    report_json = report.json()
    assert "dominant_colours" in report_json
    assert "findings" in report_json
    assert report_json["summary"]
    assert report_json["image_dimensions"]

    analytics = client.get("/api/dashboard/analytics?days=30", headers=headers)
    assert analytics.status_code == 200
    data = analytics.json()
    assert "recurring_violations" in data
    assert "reviewer_workload" in data
    assert "claim_verification_trends" in data
    assert "visual_compliance_trends" in data
    assert isinstance(data["visual_compliance_trends"], list)
    assert data["reviewer_workload"][0]["claim_decision_count"] == 1

    content = client.post(
        "/api/content/upload",
        headers=headers,
        files={"file": ("campaign.txt", b"Our service is guaranteed.", "text/plain")},
    )
    assert content.status_code == 201
    submission_id = content.json()["id"]

    analysis = client.post(f"/api/analysis/{submission_id}/run", headers=headers)
    assert analysis.status_code == 200
    analysis_json = analysis.json()
    assert analysis_json["findings"]
    assert any(finding["category"] == "prohibited_terminology" for finding in analysis_json["findings"])
    monthly_analytics = client.get(
        "/api/dashboard/analytics?days=30&granularity=monthly",
        headers=headers,
    )
    assert monthly_analytics.status_code == 200
    assert monthly_analytics.json()["trend_granularity"] == "monthly"
    assert len(monthly_analytics.json()["compliance_trend"][0]["date"]) == 7


def test_visual_analysis_uses_approved_rule_palette_and_cites_its_source(
    client, tmp_path, monkeypatch
):
    from app.core.config import settings

    monkeypatch.setattr(settings, "upload_directory", str(tmp_path / "uploads"))
    monkeypatch.setattr(settings, "gemini_api_key", "")
    token = register(client, "palette@northstar.com", "Northstar")
    headers = {"Authorization": f"Bearer {token}"}

    rule = client.post(
        "/api/rules",
        headers=headers,
        json={
            "category": "brand_messaging",
            "title": "Northstar brand palette",
            "rule_text": "Use Northstar blue #123456 and accent #abc for branded design elements.",
            "source_section": "Visual identity",
            "source_page": 4,
        },
    )
    assert rule.status_code == 201
    assert client.put(
        f"/api/rules/{rule.json()['id']}",
        headers=headers,
        json={"approved": True},
    ).status_code == 200

    red_image = Image.new("RGB", (240, 120), "#ff0000")
    image_buffer = io.BytesIO()
    red_image.save(image_buffer, format="PNG")
    asset = client.post(
        "/api/brand-assets/upload",
        headers=headers,
        files={"file": ("campaign.png", image_buffer.getvalue(), "image/png")},
    )
    assert asset.status_code == 201

    response = client.post(
        f"/api/brand-assets/{asset.json()['id']}/analyze", headers=headers
    )

    assert response.status_code == 200
    report = response.json()
    assert report["approved_colours"] == ["#123456", "#abc"]
    assert report["palette_status"] == "checked"
    colour_finding = next(
        finding
        for finding in report["findings"]
        if finding["category"] == "brand_colour"
    )
    assert sum(
        finding["category"] == "brand_colour" for finding in report["findings"]
    ) == 1
    assert colour_finding["evidence"][0]["method"] == "connected palette region with CIELAB Delta E 76"
    assert colour_finding["evidence"][0]["approved_guideline_references"][0]["title"] == "Northstar brand palette"
    assert colour_finding["evidence"][0]["approved_guideline_references"][0]["source_page"] == 4


def test_visual_analysis_skips_palette_findings_for_high_variation_images():
    from app.services.visual_brand_compliance import analyze_visual_asset

    image = Image.frombytes(
        "RGB",
        (160, 120),
        random.Random(7).randbytes(160 * 120 * 3),
    )
    image_buffer = io.BytesIO()
    image.save(image_buffer, format="PNG")

    report = analyze_visual_asset(
        "product-photo.png",
        image_buffer.getvalue(),
        approved_colours=["#123456"],
    )

    assert report["palette_status"] == "needs_verification"
    assert not any(
        finding["category"] == "brand_colour" for finding in report["findings"]
    )
    assert any("photographic colours" in warning for warning in report["warnings"])


def test_visual_analysis_reports_two_distinct_palette_mismatches():
    from app.services.visual_brand_compliance import analyze_visual_asset

    image = Image.new("RGB", (800, 400), "#123488")
    ImageDraw.Draw(image).rectangle((400, 0, 799, 399), fill="#ff0000")
    image_buffer = io.BytesIO()
    image.save(image_buffer, format="PNG")

    report = analyze_visual_asset(
        "two-colour-campaign.png",
        image_buffer.getvalue(),
        approved_colours=["#123456", "#abc"],
    )

    findings = [
        finding
        for finding in report["findings"]
        if finding["category"] == "brand_colour"
    ]
    assert len(findings) == 2
    assert {finding["expected_brand_value"] for finding in findings} == {
        "#123456",
        "#abc",
    }


def test_review_assignments_are_tenant_scoped_and_restrict_assigned_reviewers(
    client, monkeypatch
):
    from app.core.config import settings

    monkeypatch.setattr(settings, "external_search_provider", "disabled")
    admin_token = register(client, "assignment-admin@example.com", "Assignment Org")
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    reviewer_response = client.post(
        "/api/auth/users",
        headers=admin_headers,
        json={
            "full_name": "Assigned Reviewer",
            "email": "assigned-reviewer@example.com",
            "password": "secure-assignment-reviewer-password-123",
            "role": "reviewer",
        },
    )
    assert reviewer_response.status_code == 201
    reviewer_login = client.post(
        "/api/auth/login",
        json={
            "email": "assigned-reviewer@example.com",
            "password": "secure-assignment-reviewer-password-123",
        },
    )
    reviewer_headers = {
        "Authorization": f"Bearer {reviewer_login.json()['access_token']}"
    }
    other_reviewer_response = client.post(
        "/api/auth/users",
        headers=admin_headers,
        json={
            "full_name": "Other Reviewer",
            "email": "other-reviewer@example.com",
            "password": "secure-other-reviewer-password-123",
            "role": "reviewer",
        },
    )
    other_reviewer_login = client.post(
        "/api/auth/login",
        json={
            "email": "other-reviewer@example.com",
            "password": "secure-other-reviewer-password-123",
        },
    )
    other_reviewer_headers = {
        "Authorization": f"Bearer {other_reviewer_login.json()['access_token']}"
    }

    submission = client.post(
        "/api/content/upload",
        headers=admin_headers,
        files={"file": ("pending.txt", b"Approved for review.", "text/plain")},
    )
    assert submission.status_code == 201
    assignment = client.post(
        "/api/review-assignments",
        headers=admin_headers,
        json={
            "resource_type": "content",
            "resource_id": submission.json()["id"],
            "reviewer_id": reviewer_response.json()["id"],
        },
    )
    assert assignment.status_code == 201
    assert assignment.json()["status"] == "pending"
    assert assignment.json()["reviewer_name"] == "Assigned Reviewer"

    reviewer_assignments = client.get(
        "/api/review-assignments?status=pending",
        headers=reviewer_headers,
    )
    assert reviewer_assignments.status_code == 200
    assert [item["id"] for item in reviewer_assignments.json()] == [
        assignment.json()["id"]
    ]
    denied = client.post(
        f"/api/reviews/{submission.json()['id']}/approve",
        headers=other_reviewer_headers,
        json={"comment": ""},
    )
    assert denied.status_code == 403
    approved = client.post(
        f"/api/reviews/{submission.json()['id']}/approve",
        headers=reviewer_headers,
        json={"comment": ""},
    )
    assert approved.status_code == 200

    analytics = client.get(
        "/api/dashboard/analytics?days=30&granularity=weekly",
        headers=admin_headers,
    )
    assert analytics.status_code == 200
    assert analytics.json()["trend_granularity"] == "weekly"
    assert analytics.json()["review_assignment_statistics"]["completed"] == 1
    assert analytics.json()["review_assignment_statistics"]["by_resource_type"][
        "content"
    ]["completed"] == 1
    workload = next(
        reviewer
        for reviewer in analytics.json()["reviewer_workload"]
        if reviewer["reviewer_id"] == reviewer_response.json()["id"]
    )
    assert workload["completed_assignments"] == 1

    other_org_token = register(client, "assignment-other@example.com", "Other Org")
    other_org_headers = {"Authorization": f"Bearer {other_org_token}"}
    other_org_assignments = client.get(
        "/api/review-assignments", headers=other_org_headers
    )
    assert other_org_assignments.status_code == 200
    assert other_org_assignments.json() == []
    cross_tenant_assignment = client.post(
        "/api/review-assignments",
        headers=other_org_headers,
        json={
            "resource_type": "content",
            "resource_id": submission.json()["id"],
            "reviewer_id": reviewer_response.json()["id"],
        },
    )
    assert cross_tenant_assignment.status_code == 404


def test_visual_and_claim_assignments_are_enforced_and_completed(
    client, tmp_path, monkeypatch
):
    from app.core.config import settings

    monkeypatch.setattr(settings, "upload_directory", str(tmp_path / "uploads"))
    monkeypatch.setattr(settings, "external_search_provider", "disabled")
    admin_token = register(client, "multi-assignment-admin@example.com", "Multi Assignment Org")
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    reviewer_response = client.post(
        "/api/auth/users",
        headers=admin_headers,
        json={
            "full_name": "Multi Resource Reviewer",
            "email": "multi-resource-reviewer@example.com",
            "password": "secure-multi-resource-reviewer-123",
            "role": "reviewer",
        },
    )
    assert reviewer_response.status_code == 201
    reviewer_login = client.post(
        "/api/auth/login",
        json={
            "email": "multi-resource-reviewer@example.com",
            "password": "secure-multi-resource-reviewer-123",
        },
    )
    reviewer_headers = {
        "Authorization": f"Bearer {reviewer_login.json()['access_token']}"
    }

    asset = client.post(
        "/api/brand-assets/upload",
        headers=admin_headers,
        files={"file": ("assignment.png", png_bytes(), "image/png")},
    )
    assert asset.status_code == 201
    visual_report = client.post(
        f"/api/brand-assets/{asset.json()['id']}/analyze",
        headers=admin_headers,
    )
    assert visual_report.status_code == 200
    claim = client.post(
        "/api/evidence/verify",
        headers=admin_headers,
        json={"text": "Our product provides reliable results to customers."},
    )
    assert claim.status_code == 200

    for resource_type, resource_id in (
        ("visual", visual_report.json()["analysis_id"]),
        ("claim", claim.json()[0]["id"]),
    ):
        created = client.post(
            "/api/review-assignments",
            headers=admin_headers,
            json={
                "resource_type": resource_type,
                "resource_id": resource_id,
                "reviewer_id": reviewer_response.json()["id"],
            },
        )
        assert created.status_code == 201
        assert created.json()["resource_type"] == resource_type

    reviewer_id = reviewer_response.json()["id"]
    pending_metrics = client.get(
        f"/api/dashboard/analytics?reviewer_id={reviewer_id}",
        headers=admin_headers,
    )
    assert pending_metrics.status_code == 200
    pending_analytics = pending_metrics.json()
    assert pending_analytics["review_backlog"]["pending_claims"] == 1
    assert pending_analytics["review_backlog"]["pending_visual_analyses"] == 1
    assert pending_analytics["review_backlog"]["total_action_required"] == 2
    assert pending_analytics["review_backlog"]["pending_assignment_records"] == 2
    assert pending_analytics["review_assignment_statistics"]["by_resource_type"] == {
        "content": {"pending": 0, "completed": 0, "cancelled": 0},
        "visual": {"pending": 1, "completed": 0, "cancelled": 0},
        "claim": {"pending": 1, "completed": 0, "cancelled": 0},
    }

    claim_review = client.post(
        f"/api/evidence/{claim.json()[0]['id']}/review",
        headers=reviewer_headers,
        json={"decision": "approve"},
    )
    visual_review = client.post(
        f"/api/brand-assets/{asset.json()['id']}/analysis/{visual_report.json()['analysis_id']}/review",
        headers=reviewer_headers,
        json={"decision": "approve"},
    )
    assert claim_review.status_code == 200
    assert visual_review.status_code == 200

    completed = client.get(
        "/api/review-assignments?status=completed",
        headers=admin_headers,
    )
    assert completed.status_code == 200
    assert {item["resource_type"] for item in completed.json()} == {"visual", "claim"}
    completed_metrics = client.get(
        f"/api/dashboard/analytics?reviewer_id={reviewer_id}&review_status=approved",
        headers=admin_headers,
    )
    assert completed_metrics.status_code == 200
    completed_analytics = completed_metrics.json()
    assert completed_analytics["review_backlog"]["total_action_required"] == 0
    assert completed_analytics["review_assignment_statistics"]["completed"] == 2
    assert completed_analytics["review_decision_statistics"]["total_completed_decisions"] == 2
    assert completed_analytics["review_decision_statistics"]["claim_decisions"] == 1
    assert completed_analytics["review_decision_statistics"]["visual_decisions"] == 1
    assert {
            "reviewer_id": reviewer_id,
            "reviewer_name": "Multi Resource Reviewer",
        } in completed_analytics["reviewers"]
