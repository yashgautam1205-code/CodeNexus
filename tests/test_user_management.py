import logging
import time

import pytest

from app.api import auth
from app.database.session import get_db
from app.main import app

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


def test_login_succeeds_and_logs_no_credentials_or_tokens(client, caplog):
    email = "admin@acme.com"
    password = "secure-admin-password-123"
    register_admin(client)

    with caplog.at_level(logging.INFO):
        response = client.post(
            "/api/auth/login",
            json={"email": email, "password": password},
        )

    assert response.status_code == 200
    assert response.json()["user"]["email"] == email
    assert "login_started" in caplog.text
    assert "login_request_received" in caplog.text
    assert "login_response_returned status_code=200" in caplog.text
    assert "login_database_connection_acquired" in caplog.text
    assert "login_user_lookup_completed" in caplog.text
    assert "login_password_verification_completed" in caplog.text
    assert "login_jwt_generation_completed" in caplog.text
    assert "login_response_payload_completed" in caplog.text
    assert "login_succeeded" in caplog.text
    assert email not in caplog.text
    assert password not in caplog.text
    assert response.json()["access_token"] not in caplog.text


def test_login_logs_incorrect_credentials_without_sensitive_data(client, caplog):
    register_admin(client)

    with caplog.at_level(logging.INFO):
        response = client.post(
            "/api/auth/login",
            json={"email": "admin@acme.com", "password": "do-not-log-this"},
        )

    assert response.status_code == 401
    assert "login_user_lookup_completed" in caplog.text
    assert "login_password_verification_completed" in caplog.text
    assert "login_response_returned status_code=401" in caplog.text
    assert "admin@acme.com" not in caplog.text
    assert "do-not-log-this" not in caplog.text


def test_login_logs_database_connection_failure_with_stack_trace(client, caplog):
    class UnavailableSession:
        def connection(self):
            raise RuntimeError("simulated database outage")

    def unavailable_db():
        yield UnavailableSession()

    app.dependency_overrides[get_db] = unavailable_db
    try:
        with caplog.at_level(logging.ERROR), pytest.raises(
            RuntimeError, match="simulated database outage"
        ):
            client.post(
                "/api/auth/login",
                json={"email": "user@example.com", "password": "do-not-log-this"},
            )
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert "event=login_database_connection_failed" in caplog.text
    assert "exception_type=RuntimeError" in caplog.text
    assert "in login" in caplog.text
    assert "user@example.com" not in caplog.text
    assert "do-not-log-this" not in caplog.text


def test_login_logs_slow_password_verification_duration(client, monkeypatch, caplog):
    register_admin(client)

    def slow_verification(_password, _password_hash):
        time.sleep(0.03)
        return True

    monkeypatch.setattr(auth, "verify_password", slow_verification)
    with caplog.at_level(logging.INFO):
        response = client.post(
            "/api/auth/login",
            json={"email": "admin@acme.com", "password": "secure-admin-password-123"},
        )

    assert response.status_code == 200
    verification_log = next(
        line for line in caplog.text.splitlines()
        if "login_password_verification_completed" in line
    )
    duration_ms = int(verification_log.rsplit("=", 1)[1])
    assert duration_ms >= 20
    assert "admin@acme.com" not in caplog.text
    assert "secure-admin-password-123" not in caplog.text
    assert response.json()["access_token"] not in caplog.text


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
