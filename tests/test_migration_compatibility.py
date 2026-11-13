import os
from pathlib import Path
import subprocess
import sys

from sqlalchemy import create_engine, inspect, text

from app.database.session import Base


BACKEND_ROOT = Path(__file__).resolve().parents[1] / "backend"
PREVIOUS_REVISION = "d8a4c1f76b20"
HEAD_REVISION = "c8716b8c2a15"


def _upgrade_database(database_path: Path, revision: str) -> str:
    database_url = f"sqlite:///{database_path.as_posix()}"
    environment = os.environ.copy()
    environment["DATABASE_URL"] = database_url
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", revision],
        cwd=BACKEND_ROOT,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )
    return database_url


def test_fresh_database_migrates_to_head(tmp_path):
    database_url = _upgrade_database(tmp_path / "fresh.db", "head")

    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            revision = connection.execute(
                text("SELECT version_num FROM alembic_version")
            ).scalar_one()
        assert revision == HEAD_REVISION
    finally:
        engine.dispose()


def test_migration_handles_tables_precreated_by_metadata(tmp_path):
    database_path = tmp_path / "precreated.db"
    database_url = _upgrade_database(database_path, PREVIOUS_REVISION)
    engine = create_engine(database_url)
    try:
        Base.metadata.create_all(bind=engine)
        with engine.begin() as connection:
            connection.execute(
                text(
                    """
                    INSERT INTO claim_verification_records (
                        id, organization_id, verified_by, claim_text, status,
                        confidence, provider_status, reason, evidence_json, created_at
                    ) VALUES
                        ('claim-no-source', 'org', 'user', 'Claim one', 'no_source_found',
                         0.4, 'unknown', 'No source', '[]', '2026-01-01T00:00:00'),
                        ('claim-needs-verification', 'org', 'user', 'Claim two',
                         'needs_verification', 0.6, 'unknown', 'Review', '[]',
                         '2026-01-02T00:00:00')
                    """
                )
            )
    finally:
        engine.dispose()

    database_url = _upgrade_database(database_path, "head")
    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            revision = connection.execute(
                text("SELECT version_num FROM alembic_version")
            ).scalar_one()
            statuses = dict(
                connection.execute(
                    text(
                        "SELECT id, status FROM claim_verification_records "
                        "ORDER BY id"
                    )
                ).all()
            )
            claim_columns = {
                column["name"]
                for column in inspect(connection).get_columns(
                    "claim_verification_records"
                )
            }
            tables = set(
                connection.execute(
                    text(
                        "SELECT name FROM sqlite_master WHERE type = 'table'"
                    )
                ).scalars()
            )

        assert revision == HEAD_REVISION
        assert statuses == {
            "claim-needs-verification": "needs_review",
            "claim-no-source": "insufficient_evidence",
        }
        assert {
            "claim_type",
            "assessment_status",
            "assessment_model",
            "review_status",
            "assessment_source_ids_json",
        }.issubset(claim_columns)
        assert "claim_verification_review_history" in tables
        assert "review_assignments" in tables
    finally:
        engine.dispose()
