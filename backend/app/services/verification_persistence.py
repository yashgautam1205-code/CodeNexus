import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import (
    ClaimVerificationRecord,
    ClaimVerificationReviewHistory,
    ContentSubmission,
    User,
)
from app.services.audit import record_audit


def persist_claim_verifications(
    db: Session,
    user: User,
    results: list[dict],
    submission_id: str | None = None,
    analysis_id: str | None = None,
) -> list[ClaimVerificationRecord]:
    if submission_id is not None:
        submission = db.scalar(
            select(ContentSubmission.id).where(
                ContentSubmission.id == submission_id,
                ContentSubmission.organization_id == user.organization_id,
            )
        )
        if submission is None:
            raise ValueError("Content submission was not found in this organisation.")

    records = [
        ClaimVerificationRecord(
            organization_id=user.organization_id,
            submission_id=submission_id,
            analysis_id=analysis_id,
            verified_by=user.id,
            claim_text=result["claim_text"],
            claim_type=result.get("claim_type", "objective_factual"),
            time_sensitive=result.get("time_sensitive", False),
            status=result["status"],
            confidence=result["confidence"],
            provider_status=result.get("provider_status", "not_configured"),
            assessment_status=result.get("assessment_status", "not_attempted"),
            assessment_model=result.get("assessment_model"),
            assessment_rationale=result.get("assessment_rationale"),
            assessment_source_ids_json=json.dumps(
                result.get("assessment_source_ids", []), ensure_ascii=False
            ),
            assessment_error_type=result.get("assessment_error_type"),
            assessment_error_code=result.get("assessment_error_code"),
            reason=result["reason"],
            retrieval_timestamp=result.get("retrieval_timestamp"),
            last_verified_at=result.get("last_verified_at"),
            evidence_json=json.dumps(result.get("evidence", []), ensure_ascii=False),
        )
        for result in results
    ]
    db.add_all(records)
    if records:
        db.flush()
        record_audit(
            db,
            user,
            "claim_verification.run",
            "content_submission" if submission_id else "claim_verification",
            submission_id or records[0].id,
        )
    return records


def serialize_claim_verification(db: Session, record: ClaimVerificationRecord) -> dict:
    history_rows = db.execute(
        select(ClaimVerificationReviewHistory, User.full_name)
        .join(User, User.id == ClaimVerificationReviewHistory.reviewer_id)
        .where(
            ClaimVerificationReviewHistory.claim_verification_id == record.id,
            ClaimVerificationReviewHistory.organization_id == record.organization_id,
        )
        .order_by(ClaimVerificationReviewHistory.created_at.asc())
    ).all()
    return {
        "id": record.id,
        "claim_text": record.claim_text,
        "claim_type": record.claim_type,
        "time_sensitive": record.time_sensitive,
        "status": record.status,
        "confidence": record.confidence,
        "provider_status": record.provider_status,
        "assessment_status": record.assessment_status,
        "assessment_model": record.assessment_model,
        "assessment_rationale": record.assessment_rationale,
        "assessment_source_ids": json.loads(record.assessment_source_ids_json),
        "assessment_error_type": record.assessment_error_type,
        "assessment_error_code": record.assessment_error_code,
        "reason": record.reason,
        "retrieval_timestamp": record.retrieval_timestamp,
        "last_verified_at": record.last_verified_at,
        "evidence": json.loads(record.evidence_json),
        "review_status": record.review_status,
        "review_comment": record.review_comment,
        "review_history": [
            {
                "decision": history.decision,
                "previous_status": history.previous_status,
                "new_status": history.new_status,
                "reviewer_id": history.reviewer_id,
                "reviewer_name": reviewer_name,
                "comment": history.comment,
                "created_at": history.created_at,
            }
            for history, reviewer_name in history_rows
        ],
        "created_at": record.created_at,
    }
