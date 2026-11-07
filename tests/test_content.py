from app.core.config import settings


def register(client, email, organization):
    response = client.post(
        "/api/auth/register",
        json={
            "organization_name": organization,
            "full_name": "Content User",
            "email": email,
            "password": "another-long-password-456",
        },
    )
    assert response.status_code == 201
    return response.json()["access_token"]


def test_text_upload_extracts_and_stores_submission(client, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "upload_directory", str(tmp_path))
    token = register(client, "creator@example.com", "Northwind")
    response = client.post(
        "/api/content/upload",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("campaign.txt", b"Thoughtful products for everyday life.", "text/plain")},
    )

    assert response.status_code == 201
    submission = response.json()
    assert submission["status"] == "ready"
    assert submission["review_status"] == "pending"
    assert submission["extracted_text"] == "Thoughtful products for everyday life."
    assert len(list(tmp_path.rglob("*.txt"))) == 1


def test_content_history_is_isolated_by_organization(client, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "upload_directory", str(tmp_path))
    first_token = register(client, "one@example.com", "Org One")
    second_token = register(client, "two@example.com", "Org Two")
    first_headers = {"Authorization": f"Bearer {first_token}"}
    second_headers = {"Authorization": f"Bearer {second_token}"}
    uploaded = client.post(
        "/api/content/upload",
        headers=first_headers,
        files={"file": ("draft.txt", b"Only for the first organization.", "text/plain")},
    )
    assert uploaded.status_code == 201
    submission_id = uploaded.json()["id"]

    assert client.get("/api/content", headers=second_headers).json() == []
    assert client.get(f"/api/content/{submission_id}", headers=second_headers).status_code == 404


def test_content_upload_rejects_empty_and_unsupported_documents(client):
    token = register(client, "creator@example.com", "Northwind")
    headers = {"Authorization": f"Bearer {token}"}

    unsupported = client.post(
        "/api/content/upload",
        headers=headers,
        files={"file": ("brief.rtf", b"Some text", "text/rtf")},
    )
    assert unsupported.status_code == 415

    empty = client.post(
        "/api/content/upload",
        headers=headers,
        files={"file": ("empty.txt", b"", "text/plain")},
    )
    assert empty.status_code == 422
