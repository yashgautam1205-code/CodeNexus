from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user
from app.database.session import get_db
from app.core.rate_limit import limit_user_analyses
from app.models.entities import AnalysisResult, ContentSubmission, User
from app.schemas.analysis import AnalysisRead
from app.services.compliance import run_analysis, serialize_analysis

router = APIRouter(prefix="/api/analysis", tags=["analysis"])


def _find_analysis(analysis_id: str, user: User, db: Session) -> AnalysisResult:
    analysis = db.scalar(
        select(AnalysisResult).where(
            AnalysisResult.id == analysis_id,
            AnalysisResult.organization_id == user.organization_id,
        )
    )
    if analysis is None:
        raise HTTPException(status_code=404, detail="Analysis report not found.")
    return analysis


@router.post("/{content_id}/run", response_model=AnalysisRead)
def analyze_submission(
    content_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    limit_user_analyses(user)
    submission = db.scalar(
        select(ContentSubmission).where(
            ContentSubmission.id == content_id,
            ContentSubmission.organization_id == user.organization_id,
        )
    )
    if submission is None:
        raise HTTPException(status_code=404, detail="Content submission not found.")
    if not submission.extracted_text.strip():
        raise HTTPException(status_code=422, detail="Content submission has no readable text.")
    analysis = run_analysis(db, user, submission)
    return serialize_analysis(db, analysis)


@router.get("", response_model=list[AnalysisRead])
def analysis_history(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    reports = db.scalars(
        select(AnalysisResult)
        .where(AnalysisResult.organization_id == user.organization_id)
        .order_by(AnalysisResult.created_at.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    return [serialize_analysis(db, report) for report in reports]


@router.get("/{analysis_id}", response_model=AnalysisRead)
def get_analysis(
    analysis_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return serialize_analysis(db, _find_analysis(analysis_id, user, db))


@router.get("/{analysis_id}/report", response_model=AnalysisRead)
def get_analysis_report(
    analysis_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return serialize_analysis(db, _find_analysis(analysis_id, user, db))
