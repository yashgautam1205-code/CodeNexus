def register_admin(client):
    response = client.post(
        "/api/auth/register",
        json={
            "organization_name": "Acme",
            "full_name": "Administrator",
            "email": "admin@acme.com",
            "password": "secure-admin-password-123",
        },
    )
    assert response.status_code == 201
    return response.json()["access_token"]


def test_admin_can_create_tenant_user_and_assign_reviewer_role(client):
    admin_token = register_admin(client)
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    created = client.post(
        "/api/auth/users",
        headers=admin_headers,
        json={
            "full_name": "Content Reviewer",
            "email": "reviewer@acme.com",
            "password": "secure-reviewer-password-123",
            "role": "reviewer",
        },
    )
    assert created.status_code == 201
    assert created.json()["role"] == "reviewer"
    assert created.json()["organization_name"] == "Acme"
    assert len(client.get("/api/auth/users", headers=admin_headers).json()) == 2

    reviewer_login = client.post(
        "/api/auth/login",
        json={"email": "reviewer@acme.com", "password": "secure-reviewer-password-123"},
    )
    assert reviewer_login.status_code == 200
    reviewer_headers = {
        "Authorization": f"Bearer {reviewer_login.json()['access_token']}"
    }
    assert client.get("/api/auth/users", headers=reviewer_headers).status_code == 403
    assert client.post(
        "/api/rules",
        headers=reviewer_headers,
        json={
            "category": "tone_of_voice",
            "title": "Keep it clear",
            "rule_text": "Use clear and direct language.",
        },
    ).status_code == 403
