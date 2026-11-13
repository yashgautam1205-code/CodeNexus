from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, require_roles
from app.database.session import get_db
from app.models.entities import (
    BrandGuideline,
    BrandRule,
    ClaimVerificationRecord,
    ClaimVerificationReviewHistory,
    ContentSubmission,
    User,
)
from app.schemas.evidence import (
    ClaimExtractionRequest,
    ClaimReviewDecision,
    ClaimResult,
    ClaimVerificationRequest,
)
from app.services.audit import record_audit
from app.services.evidence_verification import extract_claims, verify_claims_with_external_sources
from app.services.review_assignments import (
    can_review_assignment,
    complete_pending_assignments,
)
from app.services.verification_persistence import (
    persist_claim_verifications,
    serialize_claim_verification,
)

router = APIRouter(prefix="/api/evidence", tags=["evidence"])


def _fetch_org_evidence(db: Session, user: User) -> list[dict]:
    rows = db.scalars(
        select(BrandRule)
        .where(
            BrandRule.organization_id == user.organization_id,
            BrandRule.approved.is_(True),
        )
        .order_by(BrandRule.created_at.desc())
    ).all()
    evidence: list[dict] = []
    guideline_ids = {rule.guideline_id for rule in rows if rule.guideline_id}
    guidelines = {
        guideline.id: guideline
        for guideline in db.scalars(
            select(BrandGuideline).where(
                BrandGuideline.organization_id == user.organization_id,
                BrandGuideline.id.in_(list(guideline_ids)) if guideline_ids else False,
            )
        )
    }
    for rule in rows:
        guideline = guidelines.get(rule.guideline_id)
        evidence.append(
            {
                "id": rule.id,
                "title": rule.title,
                "text": rule.rule_text,
                "source_section": rule.source_section,
                "source_page": rule.source_page,
                "guideline_id": rule.guideline_id,
                "created_at": guideline.created_at.isoformat() if guideline else None,
                "source_title": guideline.title if guideline else None,
                "source_type": "internal",
            }
        )
    return evidence


@router.post("/extract-claims")
def extract_claims_route(payload: ClaimExtractionRequest):
    return {"claims": extract_claims(payload.text)}


@router.post("/verify", response_model=list[ClaimResult])
def verify_claims_route(
    payload: ClaimVerificationRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.submission_id is not None:
        submission_exists = db.scalar(
            select(ContentSubmission.id).where(
                ContentSubmission.id == payload.submission_id,
                ContentSubmission.organization_id == user.organization_id,
            )
        )
        if submission_exists is None:
            raise HTTPException(status_code=404, detail="Content submission not found.")

    evidence = [
        {
            **entry.model_dump(exclude_none=True),
            "source_type": "user_supplied",
            "citation_valid": False,
        }
        for entry in payload.evidence
    ]
    evidence.extend(_fetch_org_evidence(db, user))
    results = verify_claims_with_external_sources(payload.text, evidence)
    try:
        records = persist_claim_verifications(
            db, user, results, submission_id=payload.submission_id
        )
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    db.commit()
    for record in records:
        db.refresh(record)
    return [serialize_claim_verification(db, record) for record in records]


@router.post("/{claim_id}/review", response_model=ClaimResult)
def review_claim_verification(
    claim_id: str,
    payload: ClaimReviewDecision,
    user: User = Depends(require_roles("admin", "brand_manager", "reviewer")),
    db: Session = Depends(get_db),
):
    record = db.scalar(
        select(ClaimVerificationRecord).where(
            ClaimVerificationRecord.id == claim_id,
            ClaimVerificationRecord.organization_id == user.organization_id,
        )
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Claim verification not found.")
    if user.role == "reviewer" and not can_review_assignment(
        db, user.organization_id, "claim", record.id, user.id
    ):
        raise HTTPException(status_code=403, detail="This item is assigned to another reviewer.")
    if payload.decision != "approve" and not (payload.comment and payload.comment.strip()):
        raise HTTPException(
            status_code=422,
            detail="A reviewer comment is required when rejecting or requesting additional evidence.",
        )
    new_status = {
        "approve": "approved",
        "reject": "rejected",
        "request_additional_evidence": "additional_evidence_requested",
    }[payload.decision]
    previous_status = record.review_status
    comment = payload.comment.strip() if payload.comment else None
    db.add(
        ClaimVerificationReviewHistory(
            organization_id=user.organization_id,
            claim_verification_id=record.id,
            reviewer_id=user.id,
            decision=payload.decision,
            previous_status=previous_status,
            new_status=new_status,
            comment=comment,
        )
    )
    record.review_status = new_status
    record.reviewed_by = user.id
    record.reviewed_at = datetime.now(timezone.utc)
    record.review_comment = comment
    record_audit(
        db,
        user,
        f"claim_verification.review.{payload.decision}",
        "claim_verification",
        record.id,
    )
    complete_pending_assignments(db, user.organization_id, "claim", record.id)
    db.commit()
    db.refresh(record)
    return serialize_claim_verification(db, record)
