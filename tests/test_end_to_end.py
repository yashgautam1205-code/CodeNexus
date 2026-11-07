import fitz


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


def test_full_reviewable_analysis_workflow(client, tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "upload_directory", str(tmp_path / "uploads"))
    monkeypatch.setattr(settings, "chroma_persist_directory", str(tmp_path / "chroma"))
    from app.rag import guideline_index

    guideline_index._client.cache_clear()
    guideline_index._embedding_function.cache_clear()

    token = register(client, "owner@northstar.com", "Northstar")
    headers = {"Authorization": f"Bearer {token}"}
    guideline = client.post(
        "/api/guidelines/upload",
        headers=headers,
        files={
            "file": (
                "voice-guide.pdf",
                pdf("Avoid absolute promises in marketing."),
                "application/pdf",
            )
        },
    )
    assert guideline.status_code == 201
    guideline_id = guideline.json()["id"]

    updated_guideline = client.put(
        f"/api/guidelines/{guideline_id}",
        headers=headers,
        json={"title": "Northstar voice guide"},
    )
    assert updated_guideline.status_code == 200
    assert updated_guideline.json()["title"] == "Northstar voice guide"

    rule = client.post(
        "/api/rules",
        headers=headers,
        json={
            "category": "prohibited_terminology",
            "title": "No guaranteed outcomes",
            "rule_text": "Do not use guaranteed for product outcomes.",
            "term": "guaranteed",
            "guideline_id": guideline_id,
            "source_section": "Claims",
            "source_page": 3,
            "replacement_text": "designed to help",
        },
    )
    assert rule.status_code == 201
    assert rule.json()["approved"] is False
    approved = client.put(
        f"/api/rules/{rule.json()['id']}",
        headers=headers,
        json={"approved": True},
    )
    assert approved.status_code == 200
    assert approved.json()["approved"] is True

    content = client.post(
        "/api/content/upload",
        headers=headers,
        files={"file": ("campaign.txt", b"Our service is guaranteed.", "text/plain")},
    )
    assert content.status_code == 201
    submission_id = content.json()["id"]

    analysis = client.post(f"/api/analysis/{submission_id}/run", headers=headers)
    assert analysis.status_code == 200
    report = analysis.json()
    assert report["analysis_status"] == "partial"
    assert report["compliance_score"] == 85
    finding = report["findings"][0]
    assert finding["evidence_status"] == "contradicted"
    assert finding["evidence_text"] == "Do not use guaranteed for product outcomes."
    assert finding["guideline_title"] == "Northstar voice guide"
    assert finding["source_section"] == "Claims"
    assert finding["source_page"] == 3

    suggestion = client.post(
        f"/api/findings/{finding['id']}/suggest",
        headers=headers,
    )
    assert suggestion.status_code == 201
    assert suggestion.json()["suggested_text"] == "designed to help"
    assert suggestion.json()["generation_source"] == "deterministic"
    edited = client.post(
        f"/api/suggestions/{suggestion.json()['id']}/decision",
        headers=headers,
        json={"decision": "edited", "suggested_text": "may help"},
    )
    assert edited.status_code == 200
    assert edited.json()["suggested_text"] == "may help"

    approval = client.post(
        f"/api/reviews/{submission_id}/approve",
        headers=headers,
        json={"comment": "Reviewed after editing."},
    )
    assert approval.status_code == 200
    assert approval.json()["decision"] == "approve"
    assert approval.json()["previous_status"] == "pending"
    assert approval.json()["new_status"] == "approved"
    assert client.get(
        f"/api/reviews/{submission_id}/history", headers=headers
    ).json()[0]["comment"] == "Reviewed after editing."
    assert client.get(f"/api/content/{submission_id}", headers=headers).json()[
        "extracted_text"
    ] == "Our service is guaranteed."

    other_token = register(client, "owner@elsewhere.com", "Elsewhere")
    other_headers = {"Authorization": f"Bearer {other_token}"}
    assert client.get(
        f"/api/analysis/{report['id']}", headers=other_headers
    ).status_code == 404
    assert client.get("/api/rules", headers=other_headers).json() == []
    assert client.get("/api/content", headers=other_headers).json() == []

    overview = client.get("/api/dashboard/overview", headers=headers)
    assert overview.status_code == 200
    assert overview.json()["total_submissions"] == 1
    assert overview.json()["analyzed_submissions"] == 1
    assert overview.json()["approved_content"] == 1
    assert overview.json()["total_violations"] == 1
    assert overview.json()["severity_distribution"]["high"] == 1
    filtered = client.get(
        "/api/dashboard/overview?days=30&review_status=approved&severity=high",
        headers=headers,
    )
    assert filtered.status_code == 200
    assert filtered.json()["total_submissions"] == 1
    assert filtered.json()["total_violations"] == 1
    empty_filter = client.get(
        "/api/dashboard/overview?review_status=rejected",
        headers=headers,
    )
    assert empty_filter.json()["total_submissions"] == 0
    assert empty_filter.json()["total_violations"] == 0
    analytics = client.get(
        "/api/dashboard/analytics?days=30&review_status=approved&severity=high",
        headers=headers,
    )
    assert analytics.status_code == 200
    assert analytics.json()["issue_categories"]["prohibited_terminology"] == 1
