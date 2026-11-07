from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user
from app.database.session import get_db
from app.models.entities import (
    AnalysisResult,
    AuditLog,
    ContentSubmission,
    User,
    Violation,
)
from app.schemas.dashboard import DashboardOverview

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


def _count(db: Session, model, *conditions) -> int:
    return db.scalar(select(func.count()).select_from(model).where(*conditions)) or 0


@router.get("/overview", response_model=DashboardOverview)
def dashboard_overview(
    days: int = Query(default=30, ge=1, le=365),
    review_status: str | None = Query(
        default=None, pattern="^(pending|approved|rejected|revision_requested)$"
    ),
    severity: str | None = Query(default=None, pattern="^(critical|high|medium|low)$"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    org_id = user.organization_id
    organization_filter = lambda model: model.organization_id == org_id
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    submission_conditions = [
        organization_filter(ContentSubmission),
        ContentSubmission.created_at >= cutoff,
    ]
    if review_status:
        submission_conditions.append(ContentSubmission.review_status == review_status)
    submission_ids = select(ContentSubmission.id).where(*submission_conditions)
    violation_conditions = [
        organization_filter(Violation),
        Violation.created_at >= cutoff,
        Violation.submission_id.in_(submission_ids),
    ]
    if severity:
        violation_conditions.append(Violation.severity == severity)

    total_submissions = _count(db, ContentSubmission, *submission_conditions)
    analyzed_submissions = _count(
        db,
        ContentSubmission,
        *submission_conditions,
        ContentSubmission.status == "analyzed",
    )
    pending_reviews = _count(
        db,
        ContentSubmission,
        *submission_conditions,
        ContentSubmission.review_status == "pending",
    )
    approved_content = _count(
        db,
        ContentSubmission,
        *submission_conditions,
        ContentSubmission.review_status == "approved",
    )
    rejected_content = _count(
        db,
        ContentSubmission,
        *submission_conditions,
        ContentSubmission.review_status == "rejected",
    )
    total_violations = _count(db, Violation, *violation_conditions)

    severities = db.execute(
        select(Violation.severity, func.count())
        .where(*violation_conditions)
        .group_by(Violation.severity)
    ).all()
    severity_distribution = {severity: count for severity, count in severities}
    for severity in ("critical", "high", "medium", "low"):
        severity_distribution.setdefault(severity, 0)

    analyses = db.scalars(
        select(AnalysisResult)
        .where(
            organization_filter(AnalysisResult),
            AnalysisResult.created_at >= cutoff,
            AnalysisResult.submission_id.in_(submission_ids),
        )
        .order_by(AnalysisResult.created_at.asc())
    ).all()
    daily_scores: dict[str, list[float]] = {}
    for analysis in analyses:
        day = analysis.created_at.date().isoformat()
        daily_scores.setdefault(day, []).append(analysis.compliance_score)
    compliance_trend = [
        {"date": day, "average_score": round(sum(scores) / len(scores), 1)}
        for day, scores in sorted(daily_scores.items())
    ]

    activity_rows = db.execute(
        select(AuditLog, User.full_name)
        .join(User, User.id == AuditLog.actor_id)
        .where(AuditLog.organization_id == org_id, AuditLog.created_at >= cutoff)
        .order_by(AuditLog.created_at.desc())
        .limit(10)
    ).all()
    recent_activities = [
        {
            "id": activity.id,
            "action": activity.action,
            "entity_type": activity.entity_type,
            "entity_id": activity.entity_id,
            "actor_name": actor_name,
            "created_at": activity.created_at.isoformat(),
        }
        for activity, actor_name in activity_rows
    ]
    return DashboardOverview(
        total_submissions=total_submissions,
        analyzed_submissions=analyzed_submissions,
        pending_reviews=pending_reviews,
        approved_content=approved_content,
        rejected_content=rejected_content,
        total_violations=total_violations,
        severity_distribution=severity_distribution,
        compliance_trend=compliance_trend,
        recent_activities=recent_activities,
    )


@router.get("/analytics")
def dashboard_analytics(
    days: int = Query(default=30, ge=1, le=365),
    review_status: str | None = Query(
        default=None, pattern="^(pending|approved|rejected|revision_requested)$"
    ),
    severity: str | None = Query(default=None, pattern="^(critical|high|medium|low)$"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    overview = dashboard_overview(days, review_status, severity, user, db)
    submission_ids = select(ContentSubmission.id).where(
        ContentSubmission.organization_id == user.organization_id,
        ContentSubmission.created_at >= datetime.now(timezone.utc) - timedelta(days=days),
    )
    if review_status:
        submission_ids = submission_ids.where(ContentSubmission.review_status == review_status)
    conditions = [
        Violation.organization_id == user.organization_id,
        Violation.created_at >= datetime.now(timezone.utc) - timedelta(days=days),
        Violation.submission_id.in_(submission_ids),
    ]
    if severity:
        conditions.append(Violation.severity == severity)
    category_rows = db.execute(
        select(Violation.category, func.count()).where(*conditions).group_by(Violation.category)
    ).all()
    return {
        "issue_categories": {category: count for category, count in category_rows},
        "severity_distribution": overview.severity_distribution,
        "compliance_trend": overview.compliance_trend,
    }
