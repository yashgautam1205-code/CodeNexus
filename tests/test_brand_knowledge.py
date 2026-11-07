import fitz

from app.core.config import settings


def register(client, email="brand@example.com", org="Acme"):
    response = client.post(
        "/api/auth/register",
        json={
            "organization_name": org,
            "full_name": "Brand Owner",
            "email": email,
            "password": "a-very-long-password-123",
        },
    )
    assert response.status_code == 201
    return response.json()["access_token"]


def make_pdf(text):
    document = fitz.open()
    page = document.new_page()
    page.insert_text((72, 72), text)
    return document.tobytes()


def test_auth_register_login_and_profile(client):
    register_response = client.post(
        "/api/auth/register",
        json={
            "organization_name": "Acme",
            "full_name": "Brand Owner",
            "email": "brand@example.com",
            "password": "a-very-long-password-123",
        },
    )
    assert register_response.status_code == 201
    token = register_response.json()["access_token"]
    assert register_response.json()["user"]["role"] == "admin"

    profile = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert profile.status_code == 200
    assert profile.json()["organization_name"] == "Acme"

    login_response = client.post(
        "/api/auth/login",
        json={"email": "brand@example.com", "password": "a-very-long-password-123"},
    )
    assert login_response.status_code == 200
    assert client.post(
        "/api/auth/login",
        json={"email": "brand@example.com", "password": "wrong-password"},
    ).status_code == 401


def test_guideline_upload_extracts_text_as_unreviewed(client, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "upload_directory", str(tmp_path))
    token = register(client)
    response = client.post(
        "/api/guidelines/upload",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("voice.pdf", make_pdf("Use clear, helpful language."), "application/pdf")},
    )

    assert response.status_code == 201
    assert "clear, helpful language" in response.json()["extracted_text"]
    assert response.json()["status"] == "needs_review"
    assert len(list(tmp_path.rglob("*.pdf"))) == 1


def test_pdf_candidate_rule_preserves_its_page_reference(client):
    token = register(client)
    headers = {"Authorization": f"Bearer {token}"}
    guideline = client.post(
        "/api/guidelines/upload",
        headers=headers,
        files={
            "file": (
                "voice.pdf",
                make_pdf("Always use clear, helpful language."),
                "application/pdf",
            )
        },
    )
    assert guideline.status_code == 201

    candidates = client.post(
        f"/api/guidelines/{guideline.json()['id']}/extract-rules",
        headers=headers,
    )

    assert candidates.status_code == 201
    assert candidates.json()[0]["source_page"] == 1


def test_rule_requires_explicit_approval_and_is_tenant_scoped(client):
    owner_token = register(client, "owner@example.com", "Acme")
    other_token = register(client, "other@example.com", "Other Org")
    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    other_headers = {"Authorization": f"Bearer {other_token}"}

    created = client.post(
        "/api/rules",
        headers=owner_headers,
        json={
            "category": "prohibited_terminology",
            "title": "Avoid guaranteed",
            "rule_text": "Do not use the word 'guaranteed'.",
            "replacement_text": "designed to help",
        },
    )
    assert created.status_code == 201
    rule = created.json()
    assert rule["approved"] is False
    assert client.get("/api/rules?approved=true", headers=owner_headers).json() == []
    assert client.put(
        f"/api/rules/{rule['id']}",
        headers=owner_headers,
        json={"approved": True},
    ).json()["approved"] is True
    assert client.get("/api/rules?approved=true", headers=owner_headers).json()[0]["id"] == rule["id"]
    assert client.put(
        f"/api/rules/{rule['id']}",
        headers=other_headers,
        json={"approved": True},
    ).status_code == 404


def test_upload_rejects_unsupported_and_corrupt_files(client, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "upload_directory", str(tmp_path))
    token = register(client)
    headers = {"Authorization": f"Bearer {token}"}

    unsupported = client.post(
        "/api/guidelines/upload",
        headers=headers,
        files={"file": ("notes.csv", b"not a supported guideline type", "text/csv")},
    )
    assert unsupported.status_code == 415

    corrupted = client.post(
        "/api/guidelines/upload",
        headers=headers,
        files={"file": ("broken.pdf", b"%PDF- but incomplete", "application/pdf")},
    )
    assert corrupted.status_code == 422
