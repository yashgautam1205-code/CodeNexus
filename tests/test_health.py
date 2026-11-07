from app.database.session import get_db
from app.main import app


def test_root_reports_api_metadata(client):
    response = client.get("/")

    assert response.status_code == 200
    assert response.json()["name"] == "BrandGuard AI"
    assert response.json()["health"] == "/api/health"


def test_health_endpoint_reports_liveness(client):
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "brandguard-api"}


def test_database_health_checks_configured_database(client):
    response = client.get("/api/health/database")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "connected"}


def test_database_health_reports_unavailable_database(client):
    class UnavailableSession:
        def execute(self, _statement):
            raise RuntimeError("simulated database outage")

    def unavailable_db():
        yield UnavailableSession()

    previous_override = app.dependency_overrides[get_db]
    app.dependency_overrides[get_db] = unavailable_db
    try:
        response = client.get("/api/health/database")
    finally:
        app.dependency_overrides[get_db] = previous_override

    assert response.status_code == 503
    assert response.json()["detail"].startswith("Database is unavailable.")
