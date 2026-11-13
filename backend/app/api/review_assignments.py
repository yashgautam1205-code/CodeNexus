from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import require_roles
from app.database.session import get_db
from app.models.entities import (
    BrandAsset,
    ClaimVerificationRecord,
    ContentSubmission,
    ReviewAssignment,
    User,
    VisualAnalysisRecord,
)
from app.schemas.review_assignments import (
    ReviewAssignmentCreate,
    ReviewAssignmentRead,
)
from app.services.audit import record_audit
from app.services.review_assignments import RESOURCE_COLUMNS

router = APIRouter(prefix="/api/review-assignments", tags=["review assignments"])
ASSIGNMENT_ROLES = ("admin", "brand_manager", "reviewer")
RESOURCE_MODELS = {
    "content": (ContentSubmission, ContentSubmission.review_status),
    "visual": (VisualAnalysisRecord, VisualAnalysisRecord.review_status),
    "claim": (ClaimVerificationRecord, ClaimVerificationRecord.review_status),
}


def _resource_name(db: Session, assignment: ReviewAssignment) -> tuple[str, str, str]:
    if assignment.content_submission_id:
        resource = db.scalar(
            select(ContentSubmission).where(
                ContentSubmission.id == assignment.content_submission_id,
                ContentSubmission.organization_id == assignment.organization_id,
            )
        )
        return (
            "content",
            assignment.content_submission_id,
            resource.filename if resource else "Unavailable content",
        )
    if assignment.visual_analysis_id:
        resource = db.scalar(
            select(VisualAnalysisRecord).where(
                VisualAnalysisRecord.id == assignment.visual_analysis_id,
                VisualAnalysisRecord.organization_id == assignment.organization_id,
            )
        )
        asset = db.scalar(
            select(BrandAsset).where(
                BrandAsset.id == resource.asset_id,
                BrandAsset.organization_id == assignment.organization_id,
            )
        ) if resource is not None else None
        return (
            "visual",
            assignment.visual_analysis_id,
            asset.filename if asset else "Unavailable visual asset",
        )
    resource = db.scalar(
        select(ClaimVerificationRecord).where(
            ClaimVerificationRecord.id == assignment.claim_verification_id,
            ClaimVerificationRecord.organization_id == assignment.organization_id,
        )
    )
    return (
        "claim",
        assignment.claim_verification_id,
        resource.claim_text[:120] if resource else "Unavailable claim",
    )


def _serialize_assignment(
    db: Session,
    assignment: ReviewAssignment,
    reviewer_name: str | None = None,
) -> dict:
    resource_type, resource_id, resource_name = _resource_name(db, assignment)
    reviewer = db.get(User, assignment.reviewer_id)
    return {
        "id": assignment.id,
        "resource_type": resource_type,
        "resource_id": resource_id,
        "resource_name": resource_name,
        "reviewer_id": assignment.reviewer_id,
        "reviewer_name": reviewer_name or (reviewer.full_name if reviewer else "Unavailable reviewer"),
        "assigned_by": assignment.assigned_by,
        "status": assignment.status,
        "assigned_at": assignment.assigned_at,
        "completed_at": assignment.completed_at,
    }


@router.post("", response_model=ReviewAssignmentRead, status_code=201)
def create_review_assignment(
    payload: ReviewAssignmentCreate,
    user: User = Depends(require_roles("admin", "brand_manager")),
    db: Session = Depends(get_db),
):
    reviewer = db.scalar(
        select(User).where(
            User.id == payload.reviewer_id,
            User.organization_id == user.organization_id,
            User.is_active.is_(True),
            User.role.in_(ASSIGNMENT_ROLES),
        )
    )
    if reviewer is None:
        raise HTTPException(status_code=404, detail="Eligible reviewer not found.")

    model, status_column = RESOURCE_MODELS[payload.resource_type]
    resource = db.scalar(
        select(model).where(
            model.id == payload.resource_id,
            model.organization_id == user.organization_id,
        )
    )
    if resource is None:
        raise HTTPException(status_code=404, detail="Review item not found.")
    if status_column is not None and resource.review_status != "pending":
        raise HTTPException(
            status_code=409,
            detail="Only pending review items can be assigned.",
        )

    resource_column = RESOURCE_COLUMNS[payload.resource_type]
    previous_assignments = db.scalars(
        select(ReviewAssignment).where(
            ReviewAssignment.organization_id == user.organization_id,
            resource_column == resource.id,
            ReviewAssignment.status == "pending",
        )
    ).all()
    for previous in previous_assignments:
        previous.status = "cancelled"

    assignment = ReviewAssignment(
        organization_id=user.organization_id,
        reviewer_id=reviewer.id,
        assigned_by=user.id,
        **{resource_column.key: resource.id},
    )
    db.add(assignment)
    db.flush()
    record_audit(
        db,
        user,
        "review.assignment.create",
        payload.resource_type,
        resource.id,
    )
    db.commit()
    db.refresh(assignment)
    return _serialize_assignment(db, assignment, reviewer.full_name)


@router.get("/reviewers")
def list_eligible_reviewers(
    user: User = Depends(require_roles("admin", "brand_manager")),
    db: Session = Depends(get_db),
):
    reviewers = db.scalars(
        select(User)
        .where(
            User.organization_id == user.organization_id,
            User.is_active.is_(True),
            User.role.in_(ASSIGNMENT_ROLES),
        )
        .order_by(User.full_name.asc())
    ).all()
    return [{"id": reviewer.id, "full_name": reviewer.full_name, "role": reviewer.role} for reviewer in reviewers]


@router.get("", response_model=list[ReviewAssignmentRead])
def list_review_assignments(
    status: str | None = Query(default=None, pattern="^(pending|completed|cancelled)$"),
    limit: int = Query(default=100, ge=1, le=500),
    user: User = Depends(require_roles(*ASSIGNMENT_ROLES)),
    db: Session = Depends(get_db),
):
    conditions = [ReviewAssignment.organization_id == user.organization_id]
    if status:
        conditions.append(ReviewAssignment.status == status)
    if user.role == "reviewer":
        conditions.append(ReviewAssignment.reviewer_id == user.id)
    rows = db.execute(
        select(ReviewAssignment, User.full_name)
        .join(User, User.id == ReviewAssignment.reviewer_id)
        .where(*conditions, User.organization_id == user.organization_id)
        .order_by(ReviewAssignment.assigned_at.desc())
        .limit(limit)
    ).all()
    return [
        _serialize_assignment(db, assignment, reviewer_name)
        for assignment, reviewer_name in rows
    ]
