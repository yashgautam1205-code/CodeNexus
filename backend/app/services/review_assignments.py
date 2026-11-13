from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models.entities import ReviewAssignment


RESOURCE_COLUMNS = {
    "content": ReviewAssignment.content_submission_id,
    "visual": ReviewAssignment.visual_analysis_id,
    "claim": ReviewAssignment.claim_verification_id,
}


def complete_pending_assignments(
    db: Session,
    organization_id: str,
    resource_type: str,
    resource_id: str,
) -> None:
    resource_column = RESOURCE_COLUMNS[resource_type]
    db.execute(
        update(ReviewAssignment)
        .where(
            ReviewAssignment.organization_id == organization_id,
            resource_column == resource_id,
            ReviewAssignment.status == "pending",
        )
            .values(
                status="completed",
                completed_at=datetime.now(timezone.utc),
            )
        )


def can_review_assignment(
        db: Session,
        organization_id: str,
        resource_type: str,
        resource_id: str,
        reviewer_id: str,
) -> bool:
        resource_column = RESOURCE_COLUMNS[resource_type]
        assigned_reviewers = db.scalars(
            select(ReviewAssignment.reviewer_id).where(
                ReviewAssignment.organization_id == organization_id,
                resource_column == resource_id,
                ReviewAssignment.status == "pending",
        )
        ).all()
        return not assigned_reviewers or reviewer_id in assigned_reviewers
