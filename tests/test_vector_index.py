from app.core.config import settings
from app.rag import guideline_index


def test_retrieval_rejects_distant_vector_hits(monkeypatch):
    class FakeCollection:
        def count(self):
            return 1

        def query(self, **_kwargs):
            return {
                "documents": [["A rule unrelated to this content."]],
                "metadatas": [[{"organization_id": "org-id", "rule_id": "rule-id"}]],
                "distances": [[guideline_index.MAX_RETRIEVAL_DISTANCE + 0.1]],
            }

    class FakeClient:
        def get_or_create_collection(self, **_kwargs):
            return FakeCollection()

    monkeypatch.setattr(guideline_index, "_client", lambda: FakeClient())
    monkeypatch.setattr(guideline_index, "_embedding_function", lambda: None)

    assert guideline_index.retrieve_guideline_chunks("org-id", "unrelated query") == []


def register(client, email, organization):
    response = client.post(
        "/api/auth/register",
        json={
            "organization_name": organization,
            "full_name": "Brand Manager",
            "email": email,
            "password": "secure-vector-password-123",
        },
    )
    assert response.status_code == 201
    return response.json()["access_token"]


def test_only_approved_rule_vectors_are_retrieved_within_tenant(client, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "chroma_persist_directory", str(tmp_path / "vectors"))
    guideline_index._client.cache_clear()
    guideline_index._embedding_function.cache_clear()
    try:
        first_token = register(client, "first@vector.com", "First Tenant")
        first_headers = {"Authorization": f"Bearer {first_token}"}
        org_id = client.get("/api/auth/me", headers=first_headers).json()["organization_id"]
        rule = client.post(
            "/api/rules",
            headers=first_headers,
            json={
                "category": "prohibited_terminology",
                "title": "Avoid guarantees",
                "rule_text": "Do not guarantee product outcomes.",
                "term": "guaranteed",
            },
        ).json()

        assert guideline_index.retrieve_guideline_chunks(org_id, "guaranteed outcomes") == []
        approved = client.put(
            f"/api/rules/{rule['id']}",
            headers=first_headers,
            json={"approved": True},
        )
        assert approved.status_code == 200
        retrieved = guideline_index.retrieve_guideline_chunks(org_id, "guaranteed outcomes")
        assert retrieved
        assert retrieved[0]["metadata"]["rule_id"] == rule["id"]
        assert retrieved[0]["metadata"]["organization_id"] == org_id

        second_token = register(client, "second@vector.com", "Second Tenant")
        second_org_id = client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {second_token}"},
        ).json()["organization_id"]
        assert guideline_index.retrieve_guideline_chunks(
            second_org_id, "guaranteed outcomes"
        ) == []

        unapproved = client.put(
            f"/api/rules/{rule['id']}",
            headers=first_headers,
            json={"approved": False},
        )
        assert unapproved.status_code == 200
        assert guideline_index.retrieve_guideline_chunks(org_id, "guaranteed outcomes") == []
    finally:
        guideline_index._client.cache_clear()
        guideline_index._embedding_function.cache_clear()
