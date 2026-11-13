from datetime import datetime, timezone

from sqlalchemy.dialects import postgresql

from app.api.dashboard import _review_assignment_type_query


def test_review_assignment_type_query_groups_by_selected_case_for_postgresql():
    statement = _review_assignment_type_query(
        organization_id="org-123",
        cutoff=datetime(2026, 1, 1, tzinfo=timezone.utc),
        reviewer_id="reviewer-456",
    )
    compiled = statement.compile(dialect=postgresql.dialect())
    sql = str(compiled)

    selected_resource_type = sql.split("SELECT ", 1)[1].split(
        " AS resource_type", 1
    )[0]
    grouped_resource_type = sql.split(" GROUP BY ", 1)[1].split(
        ", review_assignments.status", 1
    )[0]

    assert selected_resource_type == grouped_resource_type
    assert "review_assignments.organization_id =" in sql
    assert "review_assignments.assigned_at >=" in sql
    assert "review_assignments.reviewer_id =" in sql
    assert {"content", "visual", "claim"}.issubset(set(compiled.params.values()))
