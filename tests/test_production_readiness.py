import pytest

from app.core.config import Settings, settings
from app.services import malware_scanner
from app.services.document_extraction import (
    DocumentExtractionError,
    extract_document_text,
)


def _production_settings(**overrides):
    values = {
        "environment": "production",
        "database_url": "postgresql+psycopg://user:password@db.example/brandguard?sslmode=require",
        "jwt_secret_key": "a-production-secret-with-at-least-32-characters",
        "clamav_host": "clamav.internal",
        "frontend_url": "https://brandguard.example",
        "allowed_origins": "https://brandguard.example",
    }
    values.update(overrides)
    return Settings(**values)


def test_login_rate_limit_returns_retry_after(client):
    for _ in range(10):
        response = client.post(
            "/api/auth/login",
            json={"email": "unknown@example.com", "password": "bad-password"},
        )
        assert response.status_code == 401

    limited = client.post(
        "/api/auth/login",
        json={"email": "unknown@example.com", "password": "bad-password"},
    )
    assert limited.status_code == 429
    assert int(limited.headers["Retry-After"]) > 0


def test_registration_rate_limit_is_enforced(client):
    for index in range(5):
        response = client.post(
            "/api/auth/register",
            json={
                "organization_name": f"Rate Limited Org {index}",
                "full_name": "Test Owner",
                "email": f"rate-limited-{index}@example.com",
                "password": "secure-rate-limit-password-123",
            },
        )
        assert response.status_code == 201

    limited = client.post(
        "/api/auth/register",
        json={
            "organization_name": "Rate Limited Org",
            "full_name": "Test Owner",
            "email": "rate-limited-sixth@example.com",
            "password": "secure-rate-limit-password-123",
        },
    )
    assert limited.status_code == 429
    assert int(limited.headers["Retry-After"]) > 0


def test_upload_and_analysis_limits_are_account_scoped():
    from types import SimpleNamespace

    from fastapi import HTTPException

    from app.core.rate_limit import (
        ANALYSIS_LIMIT,
        UPLOAD_LIMIT,
        auth_rate_limiter,
        limit_user_analyses,
        limit_user_uploads,
    )

    auth_rate_limiter.reset()
    user = SimpleNamespace(organization_id="org-a", id="user-a")
    other_user = SimpleNamespace(organization_id="org-a", id="user-b")
    for _ in range(UPLOAD_LIMIT):
        limit_user_uploads(user)
    with pytest.raises(HTTPException) as upload_error:
        limit_user_uploads(user)
    assert upload_error.value.status_code == 429
    limit_user_uploads(other_user)

    for _ in range(ANALYSIS_LIMIT):
        limit_user_analyses(user)
    with pytest.raises(HTTPException) as analysis_error:
        limit_user_analyses(user)
    assert analysis_error.value.status_code == 429
    limit_user_analyses(other_user)


class FakeClamAVSocket:
    def __init__(self, response: bytes):
        self.response = response
        self.sent = bytearray()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def settimeout(self, _timeout):
        pass

    def sendall(self, value):
        self.sent.extend(value)

    def recv(self, _size):
        if not self.response:
            return b""
        result, self.response = self.response[:1], self.response[1:]
        return result


def test_clamav_stream_scan_accepts_clean_result(monkeypatch):
    fake_socket = FakeClamAVSocket(b"stream: OK\0")
    monkeypatch.setattr(settings, "clamav_host", "scanner.internal")
    monkeypatch.setattr(malware_scanner.socket, "create_connection", lambda *_a, **_k: fake_socket)

    malware_scanner.scan_upload(b"safe file bytes")

    assert fake_socket.sent.startswith(b"zINSTREAM\0")
    assert fake_socket.sent.endswith(b"\0\0\0\0")


def test_clamav_stream_scan_rejects_detected_malware(monkeypatch):
    fake_socket = FakeClamAVSocket(b"stream: Eicar-Test-Signature FOUND\0")
    monkeypatch.setattr(settings, "clamav_host", "scanner.internal")
    monkeypatch.setattr(malware_scanner.socket, "create_connection", lambda *_a, **_k: fake_socket)

    with pytest.raises(malware_scanner.MalwareDetectedError):
        malware_scanner.scan_upload(b"infected file bytes")


def test_production_upload_scan_fails_closed_when_scanner_is_unavailable(monkeypatch):
    monkeypatch.setattr(settings, "clamav_host", "scanner.internal")

    def fail_connect(*_args, **_kwargs):
        raise OSError("connection refused")

    monkeypatch.setattr(malware_scanner.socket, "create_connection", fail_connect)

    with pytest.raises(malware_scanner.MalwareScannerUnavailableError):
        malware_scanner.scan_upload(b"file bytes")


def test_docx_expansion_is_bounded():
    import io
    from zipfile import ZIP_DEFLATED, ZipFile

    buffer = io.BytesIO()
    with ZipFile(buffer, "w", ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", "x")
        archive.writestr("word/document.xml", "x" * (65 * 1024 * 1024))

    with pytest.raises(DocumentExtractionError, match="processing limit"):
        extract_document_text("large.docx", buffer.getvalue())


def test_txt_upload_extraction_rejects_binary_nul_bytes():
    with pytest.raises(DocumentExtractionError, match="binary data"):
        extract_document_text("binary.txt", b"content\0payload")


def test_production_configuration_requires_scanner_and_exact_https_origins():
    with pytest.raises(ValueError, match="CLAMAV_HOST"):
        _production_settings(clamav_host="")
    with pytest.raises(ValueError, match="HTTPS origins"):
        _production_settings(allowed_origins="*")
    with pytest.raises(ValueError, match="PostgreSQL"):
        _production_settings(database_url="sqlite:///./brandguard.db")
    with pytest.raises(ValueError, match="sslmode"):
        _production_settings(
            database_url="postgresql+psycopg://user:password@db.example/brandguard"
        )


def test_demo_configuration_does_not_require_clamav():
    demo_settings = Settings(
        environment="DEMO",
        database_url="sqlite:///./brandguard.db",
        jwt_secret_key="a-demo-secret-with-at-least-32-characters",
        clamav_host="",
    )

    assert demo_settings.environment == "demo"
    assert demo_settings.clamav_host == ""


def test_demo_uploads_are_rejected_without_scanning_or_storage(
    client, monkeypatch, tmp_path
):
    from app.core.rate_limit import auth_rate_limiter

    monkeypatch.setattr(settings, "environment", "demo")
    monkeypatch.setattr(settings, "clamav_host", "")
    upload_directory = tmp_path / "uploads"
    monkeypatch.setattr(settings, "upload_directory", str(upload_directory))
    monkeypatch.setattr(
        malware_scanner,
        "scan_upload",
        lambda _content: pytest.fail("Demo uploads must not reach the scanner."),
    )
    auth_rate_limiter.reset()
    registration = client.post(
        "/api/auth/register",
        json={
            "organization_name": "Demo Org",
            "full_name": "Demo Owner",
            "email": "demo-upload@example.com",
            "password": "secure-demo-upload-password-123",
        },
    )
    headers = {"Authorization": f"Bearer {registration.json()['access_token']}"}

    for endpoint in ("/api/content/upload", "/api/guidelines/upload"):
        response = client.post(
            endpoint,
            headers=headers,
            files={"file": ("sample.txt", b"Demo upload content.", "text/plain")},
        )
        assert response.status_code == 503
        assert response.json()["detail"] == (
            "File uploads are disabled in demo mode to avoid accepting files without antivirus scanning."
        )

    assert client.get("/api/content", headers=headers).json() == []
    assert not upload_directory.exists()


def test_production_scan_without_clamav_fails_closed(monkeypatch):
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "clamav_host", "")

    with pytest.raises(
        malware_scanner.MalwareScannerUnavailableError,
        match="required in production",
    ):
        malware_scanner.scan_upload(b"file bytes")


def test_upload_fails_closed_when_malware_scanner_is_unavailable(
    client, monkeypatch, tmp_path
):
    from app.core.rate_limit import auth_rate_limiter

    monkeypatch.setattr(settings, "clamav_host", "scanner.internal")
    monkeypatch.setattr(settings, "upload_directory", str(tmp_path / "uploads"))

    def fail_connect(*_args, **_kwargs):
        raise OSError("connection refused")

    monkeypatch.setattr(malware_scanner.socket, "create_connection", fail_connect)
    auth_rate_limiter.reset()
    registration = client.post(
        "/api/auth/register",
        json={
            "organization_name": "Scanner Org",
            "full_name": "Test Owner",
            "email": "scanner@example.com",
            "password": "secure-scanner-password-123",
        },
    )
    headers = {"Authorization": f"Bearer {registration.json()['access_token']}"}

    response = client.post(
        "/api/content/upload",
        headers=headers,
        files={"file": ("campaign.txt", b"Safe marketing content.", "text/plain")},
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "Upload scanning is unavailable. Try again later."
    assert client.get("/api/content", headers=headers).json() == []


def test_upload_size_limit_and_malware_detection_are_enforced(
    client, monkeypatch, tmp_path
):
    from app.core.config import settings

    monkeypatch.setattr(settings, "max_upload_size_bytes", 4)
    monkeypatch.setattr(settings, "upload_directory", str(tmp_path / "uploads"))
    registration = client.post(
        "/api/auth/register",
        json={
            "organization_name": "Upload Validation Org",
            "full_name": "Test Owner",
            "email": "upload-validation@example.com",
            "password": "secure-upload-validation-password-123",
        },
    )
    headers = {"Authorization": f"Bearer {registration.json()['access_token']}"}

    oversized = client.post(
        "/api/content/upload",
        headers=headers,
        files={"file": ("large.txt", b"12345", "text/plain")},
    )
    assert oversized.status_code == 413

    monkeypatch.setattr(settings, "max_upload_size_bytes", 1024)

    def reject_file(_content):
        raise malware_scanner.MalwareDetectedError("test signature")

    monkeypatch.setattr("app.services.file_storage.scan_upload", reject_file)
    infected = client.post(
        "/api/content/upload",
        headers=headers,
        files={"file": ("infected.txt", b"bad file", "text/plain")},
    )
    assert infected.status_code == 422
    assert client.get("/api/content", headers=headers).json() == []


def test_gemini_failures_preserve_partial_analysis_and_suggestion_provenance(
    client, monkeypatch
):
    from app.ai import gemini
    from app.core.config import settings
    from app.services import compliance

    registration = client.post(
        "/api/auth/register",
        json={
            "organization_name": "AI Fallback Org",
            "full_name": "Test Owner",
            "email": "ai-fallback@example.com",
            "password": "secure-ai-fallback-password-123",
        },
    )
    headers = {"Authorization": f"Bearer {registration.json()['access_token']}"}
    rule = client.post(
        "/api/rules",
        headers=headers,
        json={
            "category": "tone_of_voice",
            "title": "Use clear language",
            "rule_text": "Use clear, direct language.",
        },
    )
    assert rule.status_code == 201
    approved = client.put(
        f"/api/rules/{rule.json()['id']}",
        headers=headers,
        json={"approved": True},
    )
    assert approved.status_code == 200
    monkeypatch.setattr(settings, "gemini_api_key", "test-key-not-used")
    monkeypatch.setattr(
        compliance,
        "retrieve_guideline_chunks",
        lambda org_id, _query: [
            {
                "metadata": {
                    "organization_id": org_id,
                    "rule_id": rule.json()["id"],
                },
                "distance": 0.1,
            }
        ],
    )

    def fail_analysis(*_args):
        raise RuntimeError("simulated provider failure")

    monkeypatch.setattr(compliance, "analyze_with_gemini", fail_analysis)
    submission = client.post(
        "/api/content/upload",
        headers=headers,
        files={
            "file": (
                "campaign.txt",
                b"Our product is guaranteed.",
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
    assert analysis.json()["analysis_status"] == "partial"
    assert "Gemini analysis was unavailable" in analysis.json()["analysis_note"]
    finding = analysis.json()["findings"][0]

    def fail_suggestion(*_args):
        raise RuntimeError("simulated correction provider failure")

    monkeypatch.setattr("app.api.corrections.suggest_with_gemini", fail_suggestion)
    suggestion = client.post(
        f"/api/findings/{finding['id']}/suggest",
        headers=headers,
    )

    assert suggestion.status_code == 201
    assert suggestion.json()["generation_source"] == "deterministic"
    assert suggestion.json()["suggested_text"] == "Provide a verifiable source or qualify the claim."
