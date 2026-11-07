def register(client, email, organization):
    response = client.post(
        "/api/auth/register",
        json={
            "organization_name": organization,
            "full_name": "Brand Manager",
            "email": email,
            "password": "secure-round2-password-123",
        },
    )
    assert response.status_code == 201
    return response.json()["access_token"]


def test_txt_guideline_candidate_rules_and_version_linking(client, tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "upload_directory", str(tmp_path / "uploads"))
    token = register(client, "manager@round2.com", "Round Two")
    headers = {"Authorization": f"Bearer {token}"}
    source = (
        "[Section: Voice]\n"
        "Use clear, friendly language.\n"
        "Never promise guaranteed outcomes.\n"
        "Always include the results may vary disclaimer.\n"
        "This paragraph describes the organisation."
    ).encode()

    first = client.post(
        "/api/guidelines/upload",
        headers=headers,
        files={"file": ("voice.txt", source, "text/plain")},
    )
    assert first.status_code == 201
    assert first.json()["version_number"] == 1
    assert first.json()["supersedes_guideline_id"] is None

    extracted = client.post(
        f"/api/guidelines/{first.json()['id']}/extract-rules",
        headers=headers,
    )
    assert extracted.status_code == 201
    candidates = extracted.json()
    assert len(candidates) == 3
    assert all(not candidate["approved"] for candidate in candidates)
    assert all(candidate["source_section"] == "Voice" for candidate in candidates)
    assert candidates[-1]["category"] == "required_disclaimers"

    repeated = client.post(
        f"/api/guidelines/{first.json()['id']}/extract-rules",
        headers=headers,
    )
    assert repeated.status_code == 201
    assert repeated.json() == []

    second = client.post(
        "/api/guidelines/upload",
        headers=headers,
        data={"supersedes_guideline_id": first.json()["id"]},
        files={"file": ("voice-v2.txt", b"Use clear, concise language.", "text/plain")},
    )
    assert second.status_code == 201
    assert second.json()["version_number"] == 2
    assert second.json()["supersedes_guideline_id"] == first.json()["id"]

    other_token = register(client, "other@round2.com", "Other Round Two")
    other = client.post(
        "/api/guidelines/upload",
        headers={"Authorization": f"Bearer {other_token}"},
        data={"supersedes_guideline_id": first.json()["id"]},
        files={"file": ("voice.txt", b"Use clear language.", "text/plain")},
    )
    assert other.status_code == 404


def test_candidate_rule_extraction_requires_manager_role(client):
    owner_token = register(client, "owner@round2.com", "Role Org")
    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    created = client.post(
        "/api/auth/users",
        headers=owner_headers,
        json={
            "full_name": "Content Creator",
            "email": "creator@round2.com",
            "password": "secure-round2-password-123",
            "role": "content_creator",
        },
    )
    assert created.status_code == 201
    login = client.post(
        "/api/auth/login",
        json={"email": "creator@round2.com", "password": "secure-round2-password-123"},
    )
    assert login.status_code == 200
    guideline = client.post(
        "/api/guidelines/upload",
        headers=owner_headers,
        files={"file": ("voice.txt", b"Always use plain language.", "text/plain")},
    )
    assert guideline.status_code == 201
    response = client.post(
        f"/api/guidelines/{guideline.json()['id']}/extract-rules",
        headers={"Authorization": f"Bearer {login.json()['access_token']}"},
    )
    assert response.status_code == 403


def test_extracted_draft_to_human_approval_workflow(client, tmp_path, monkeypatch):
    from app.core.config import settings
    from app.rag import guideline_index

    monkeypatch.setattr(settings, "upload_directory", str(tmp_path / "uploads"))
    monkeypatch.setattr(settings, "chroma_persist_directory", str(tmp_path / "chroma"))
    monkeypatch.setattr(settings, "gemini_api_key", "")
    guideline_index._client.cache_clear()
    guideline_index._embedding_function.cache_clear()
    try:
        token = register(client, "workflow@round2.com", "Workflow Org")
        headers = {"Authorization": f"Bearer {token}"}
        guideline = client.post(
            "/api/guidelines/upload",
            headers=headers,
            files={
                "file": (
                    "claims.txt",
                    b"[Section: Claims]\nNever use guaranteed outcomes.",
                    "text/plain",
                )
            },
        )
        assert guideline.status_code == 201

        candidates = client.post(
            f"/api/guidelines/{guideline.json()['id']}/extract-rules",
            headers=headers,
        )
        assert candidates.status_code == 201
        draft = candidates.json()[0]
        assert draft["approved"] is False
        assert draft["source_section"] == "Claims"

        approved = client.put(
            f"/api/rules/{draft['id']}",
            headers=headers,
            json={
                "category": "prohibited_terminology",
                "term": "guaranteed",
                "replacement_text": "designed to help",
                "approved": True,
            },
        )
        assert approved.status_code == 200
        assert approved.json()["approved"] is True

        submission = client.post(
            "/api/content/upload",
            headers=headers,
            files={
                "file": (
                    "campaign.txt",
                    b"Our outcomes are guaranteed.",
                    "text/plain",
                )
            },
        )
        assert submission.status_code == 201
        analysis = client.post(
            f"/api/analysis/{submission.json()['id']}/run",
            headers=headers,
        )
        assert analysis.status_code == 200
        finding = analysis.json()["findings"][0]
        assert finding["evidence_status"] == "contradicted"
        assert finding["evidence_text"] == "Never use guaranteed outcomes."
        assert finding["source_section"] == "Claims"

        suggestion = client.post(
            f"/api/findings/{finding['id']}/suggest",
            headers=headers,
        )
        assert suggestion.status_code == 201
        assert suggestion.json()["suggested_text"] == "designed to help"
        assert suggestion.json()["generation_source"] == "deterministic"

        decision = client.post(
            f"/api/reviews/{submission.json()['id']}/approve",
            headers=headers,
            json={"comment": "Reviewed the cited source and final copy."},
        )
        assert decision.status_code == 200
        assert decision.json()["previous_status"] == "pending"
        assert decision.json()["new_status"] == "approved"
        assert client.get(
            f"/api/content/{submission.json()['id']}", headers=headers
        ).json()["extracted_text"] == "Our outcomes are guaranteed."
    finally:
        guideline_index._client.cache_clear()
        guideline_index._embedding_function.cache_clear()
