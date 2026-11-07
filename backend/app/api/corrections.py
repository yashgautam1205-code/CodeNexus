import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.gemini import suggest_with_gemini
from app.api.dependencies import get_current_user
from app.core.config import settings
from app.database.session import get_db
from app.models.entities import (
    BrandRule,
    ContentSubmission,
    CorrectionSuggestion,
    User,
    Violation,
)
from app.schemas.analysis import SuggestionDecision
from app.schemas.corrections import SuggestionRead
from app.services.audit import record_audit

logger = logging.getLogger(__name__)
router = APIRouter(tags=["corrections"])


@router.post("/api/findings/{finding_id}/suggest", response_model=SuggestionRead, status_code=201)
def create_suggestion(
    finding_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    finding = db.scalar(
        select(Violation).where(
            Violation.id == finding_id,
            Violation.organization_id == user.organization_id,
        )
    )
    if finding is None:
        raise HTTPException(status_code=404, detail="Finding not found.")
    submission = db.scalar(
        select(ContentSubmission).where(
            ContentSubmission.id == finding.submission_id,
            ContentSubmission.organization_id == user.organization_id,
        )
    )
    source_rule = None
    if finding.source_rule_id:
        source_rule = db.scalar(
            select(BrandRule).where(
                BrandRule.id == finding.source_rule_id,
                BrandRule.organization_id == user.organization_id,
                BrandRule.approved.is_(True),
            )
        )
    approved_evidence = (
        {
            "id": source_rule.id,
            "title": source_rule.title,
            "text": source_rule.rule_text,
            "source_section": source_rule.source_section,
            "source_page": source_rule.source_page,
        }
        if source_rule
        else None
    )

    suggested_text = finding.suggested_correction
    generation_source = "deterministic" if suggested_text else "fallback"
    if (
        source_rule
        and source_rule.category == "prohibited_terminology"
        and source_rule.term
        and source_rule.replacement_text
        and finding.affected_text
    ):
        suggested_text = source_rule.replacement_text
        generation_source = "deterministic"
    if settings.gemini_api_key and submission:
        try:
            suggested_text = suggest_with_gemini(
                submission.extracted_text,
                finding.affected_text,
                approved_evidence,
            )
            generation_source = "gemini"
        except Exception:
            logger.exception("Gemini correction failed for finding %s", finding.id)
            if not suggested_text:
                suggested_text = "Revise this text and verify any associated claims before approval."
                generation_source = "fallback"
    if not suggested_text:
        suggested_text = "Review this text against the supporting evidence before approval."
        generation_source = "fallback"

    suggestion = CorrectionSuggestion(
        organization_id=user.organization_id,
        violation_id=finding.id,
        created_by=user.id,
        original_text=finding.affected_text or finding.explanation,
        suggested_text=suggested_text,
        generation_source=generation_source,
    )
    db.add(suggestion)
    db.flush()
    record_audit(db, user, "suggestion.create", "correction_suggestion", suggestion.id)
    db.commit()
    db.refresh(suggestion)
    return suggestion


@router.post("/api/suggestions/{suggestion_id}/decision", response_model=SuggestionRead)
def decide_suggestion(
    suggestion_id: str,
    payload: SuggestionDecision,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    suggestion = db.scalar(
        select(CorrectionSuggestion).where(
            CorrectionSuggestion.id == suggestion_id,
            CorrectionSuggestion.organization_id == user.organization_id,
        )
    )
    if suggestion is None:
        raise HTTPException(status_code=404, detail="Correction suggestion not found.")
    if payload.decision == "edited":
        if not payload.suggested_text or not payload.suggested_text.strip():
            raise HTTPException(status_code=422, detail="Provide edited text when selecting edited.")
        suggestion.suggested_text = payload.suggested_text
    suggestion.decision = payload.decision
    record_audit(db, user, f"suggestion.{payload.decision}", "correction_suggestion", suggestion.id)
    db.commit()
    db.refresh(suggestion)
    return suggestion
