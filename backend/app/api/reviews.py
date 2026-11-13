from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, require_roles
from app.database.session import get_db
from app.models.entities import ApprovalHistory, ContentSubmission, User
from app.schemas.reviews import ReviewDecision, ReviewRead
from app.services.audit import record_audit
from app.services.review_assignments import (
    can_review_assignment,
    complete_pending_assignments,
)

router = APIRouter(prefix="/api/reviews", tags=["human review"])
REVIEW_ROLES = ("admin", "brand_manager", "reviewer")
DECISION_STATUS = {
    "approve": "approved",
    "reject": "rejected",
    "request-revision": "revision_requested",
}


def _record_decision(
    content_id: str,
    decision: str,
    payload: ReviewDecision | None,
    user: User,
    db: Session,
) -> ReviewRead:
    submission = db.scalar(
        select(ContentSubmission).where(
            ContentSubmission.id == content_id,
            ContentSubmission.organization_id == user.organization_id,
        )
    )
    if submission is None:
        raise HTTPException(status_code=404, detail="Content submission not found.")
    if user.role == "reviewer" and not can_review_assignment(
        db, user.organization_id, "content", submission.id, user.id
    ):
        raise HTTPException(status_code=403, detail="This item is assigned to another reviewer.")
    previous_status = submission.review_status
    submission.review_status = DECISION_STATUS[decision]
    history = ApprovalHistory(
        organization_id=user.organization_id,
        submission_id=submission.id,
        reviewer_id=user.id,
        decision=decision.replace("-", "_"),
        previous_status=previous_status,
        new_status=submission.review_status,
        comment=payload.comment.strip() if payload and payload.comment else None,
    )
    db.add(history)
    db.flush()
    record_audit(db, user, f"review.{decision}", "content_submission", submission.id)
    complete_pending_assignments(db, user.organization_id, "content", submission.id)
    db.commit()
    db.refresh(history)
    return history


@router.post("/{content_id}/approve", response_model=ReviewRead)
def approve_content(
    content_id: str,
    payload: ReviewDecision | None = None,
    user: User = Depends(require_roles(*REVIEW_ROLES)),
    db: Session = Depends(get_db),
):
    return _record_decision(content_id, "approve", payload, user, db)


@router.post("/{content_id}/reject", response_model=ReviewRead)
def reject_content(
    content_id: str,
    payload: ReviewDecision | None = None,
    user: User = Depends(require_roles(*REVIEW_ROLES)),
    db: Session = Depends(get_db),
):
    if payload is None or not payload.comment or not payload.comment.strip():
        raise HTTPException(status_code=422, detail="A reviewer comment is required to reject content.")
    return _record_decision(content_id, "reject", payload, user, db)


@router.post("/{content_id}/request-revision", response_model=ReviewRead)
def request_revision(
    content_id: str,
    payload: ReviewDecision | None = None,
    user: User = Depends(require_roles(*REVIEW_ROLES)),
    db: Session = Depends(get_db),
):
    if payload is None or not payload.comment or not payload.comment.strip():
        raise HTTPException(
            status_code=422,
            detail="A reviewer comment is required when requesting revisions.",
        )
    return _record_decision(content_id, "request-revision", payload, user, db)


@router.get("/{content_id}/history", response_model=list[ReviewRead])
def review_history(
    content_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    submission = db.scalar(
        select(ContentSubmission.id).where(
            ContentSubmission.id == content_id,
            ContentSubmission.organization_id == user.organization_id,
        )
    )
    if submission is None:
        raise HTTPException(status_code=404, detail="Content submission not found.")
    return list(
        db.scalars(
            select(ApprovalHistory)
            .where(
                ApprovalHistory.submission_id == content_id,
                ApprovalHistory.organization_id == user.organization_id,
            )
            .order_by(ApprovalHistory.created_at.desc())
        )
    )
