import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user
from app.database.session import get_db
from app.models.entities import (
    AnalysisResult,
    ApprovalHistory,
    AuditLog,
    ClaimVerificationRecord,
    ClaimVerificationReviewHistory,
    ContentSubmission,
    ReviewAssignment,
    User,
    Violation,
    VisualAnalysisRecord,
    VisualReviewHistory,
)
from app.schemas.dashboard import DashboardOverview

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

GRANULARITIES = ("daily", "weekly", "monthly")


def _period_key(value: datetime, granularity: str) -> str:
    if granularity == "monthly":
        return value.strftime("%Y-%m")
    if granularity == "weekly":
        return (value.date() - timedelta(days=value.weekday())).isoformat()
    return value.date().isoformat()


def _count(db: Session, model, *conditions) -> int:
    return db.scalar(select(func.count()).select_from(model).where(*conditions)) or 0


def _reviewer_resource_ids(
    history_model,
    history_resource_column,
    assignment_resource_column,
    organization_id: str,
    reviewer_id: str,
    cutoff: datetime,
):
    return select(history_resource_column).where(
        history_model.organization_id == organization_id,
        history_model.reviewer_id == reviewer_id,
        history_model.created_at >= cutoff,
    ).union(
        select(assignment_resource_column).where(
            ReviewAssignment.organization_id == organization_id,
            ReviewAssignment.reviewer_id == reviewer_id,
            ReviewAssignment.assigned_at >= cutoff,
            assignment_resource_column.is_not(None),
        )
    )


def _review_assignment_type_query(
    organization_id: str,
    cutoff: datetime,
    reviewer_id: str | None,
):
    resource_type = case(
        (ReviewAssignment.content_submission_id.is_not(None), "content"),
        (ReviewAssignment.visual_analysis_id.is_not(None), "visual"),
        else_="claim",
    )
    conditions = [
        ReviewAssignment.organization_id == organization_id,
        ReviewAssignment.assigned_at >= cutoff,
    ]
    if reviewer_id:
        conditions.append(ReviewAssignment.reviewer_id == reviewer_id)

    return (
        select(
            resource_type.label("resource_type"),
            ReviewAssignment.status,
            func.count(),
        )
        .where(*conditions)
        .group_by(resource_type, ReviewAssignment.status)
    )


@router.get("/overview", response_model=DashboardOverview)
def dashboard_overview(
    days: int = Query(default=30, ge=1, le=365),
    granularity: str = Query(default="daily", pattern="^(daily|weekly|monthly)$"),
    review_status: str | None = Query(
        default=None, pattern="^(pending|approved|rejected|revision_requested)$"
    ),
    severity: str | None = Query(default=None, pattern="^(critical|high|medium|low)$"),
    category: str | None = Query(default=None, max_length=48),
    reviewer_id: str | None = Query(default=None, max_length=36),
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
    if reviewer_id:
        submission_conditions.append(
            ContentSubmission.id.in_(
                _reviewer_resource_ids(
                    ApprovalHistory,
                    ApprovalHistory.submission_id,
                    ReviewAssignment.content_submission_id,
                    org_id,
                    reviewer_id,
                    cutoff,
                )
            )
        )
    submission_ids = select(ContentSubmission.id).where(*submission_conditions)
    violation_conditions = [
        organization_filter(Violation),
        Violation.created_at >= cutoff,
        Violation.submission_id.in_(submission_ids),
    ]
    if severity:
        violation_conditions.append(Violation.severity == severity)
    if category:
        violation_conditions.append(Violation.category == category)

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
        period = _period_key(analysis.created_at, granularity)
        daily_scores.setdefault(period, []).append(analysis.compliance_score)
    compliance_trend = [
        {"date": period, "average_score": round(sum(scores) / len(scores), 1)}
        for period, scores in sorted(daily_scores.items())
    ]

    activity_conditions = [
        AuditLog.organization_id == org_id,
        AuditLog.created_at >= cutoff,
    ]
    if reviewer_id:
        activity_conditions.append(AuditLog.actor_id == reviewer_id)
    activity_rows = db.execute(
        select(AuditLog, User.full_name)
        .join(User, User.id == AuditLog.actor_id)
        .where(*activity_conditions, User.organization_id == org_id)
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
    granularity: str = Query(default="daily", pattern="^(daily|weekly|monthly)$"),
    review_status: str | None = Query(
        default=None, pattern="^(pending|approved|rejected|revision_requested)$"
    ),
    severity: str | None = Query(default=None, pattern="^(critical|high|medium|low)$"),
    category: str | None = Query(default=None, max_length=48),
    reviewer_id: str | None = Query(default=None, max_length=36),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    overview = dashboard_overview(
        days=days,
        granularity=granularity,
        review_status=review_status,
        severity=severity,
        category=category,
        reviewer_id=reviewer_id,
        user=user,
        db=db,
    )
    reviewer_options = db.execute(
        select(User.id, User.full_name)
        .where(
            User.organization_id == user.organization_id,
            User.is_active.is_(True),
            User.role.in_(("reviewer", "admin", "brand_manager")),
        )
        .order_by(User.full_name.asc())
    ).all()
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    claim_review_status = (
        "additional_evidence_requested"
        if review_status == "revision_requested"
        else review_status
    )
    submission_ids = select(ContentSubmission.id).where(
        ContentSubmission.organization_id == user.organization_id,
        ContentSubmission.created_at >= cutoff,
    )
    if review_status:
        submission_ids = submission_ids.where(ContentSubmission.review_status == review_status)
    if reviewer_id:
        submission_ids = submission_ids.where(
            ContentSubmission.id.in_(
                _reviewer_resource_ids(
                    ApprovalHistory,
                    ApprovalHistory.submission_id,
                    ReviewAssignment.content_submission_id,
                    user.organization_id,
                    reviewer_id,
                    cutoff,
                )
            )
        )
    conditions = [
        Violation.organization_id == user.organization_id,
        Violation.created_at >= cutoff,
        Violation.submission_id.in_(submission_ids),
    ]
    if severity:
        conditions.append(Violation.severity == severity)
    if category:
        conditions.append(Violation.category == category)
    category_rows = db.execute(
        select(Violation.category, func.count()).where(*conditions).group_by(Violation.category)
    ).all()
    recurring_violations = [
        {"category": issue_category, "count": count}
        for issue_category, count in sorted(category_rows, key=lambda row: row[1], reverse=True)
    ]

    reviewer_rows = db.execute(
        select(
            User.id,
            User.full_name,
            func.count(ApprovalHistory.id),
            func.sum(case((ApprovalHistory.decision == "approve", 1), else_=0)),
        )
        .join(ApprovalHistory, ApprovalHistory.reviewer_id == User.id)
        .join(ContentSubmission, ContentSubmission.id == ApprovalHistory.submission_id)
        .where(
            ApprovalHistory.organization_id == user.organization_id,
            ApprovalHistory.created_at >= cutoff,
            User.organization_id == user.organization_id,
            ContentSubmission.organization_id == user.organization_id,
            *(
                [ContentSubmission.review_status == review_status]
                if review_status
                else []
            ),
            *(
                [ApprovalHistory.reviewer_id == reviewer_id]
                if reviewer_id
                else []
            ),
        )
        .group_by(User.id, User.full_name)
        .order_by(func.count(ApprovalHistory.id).desc())
    ).all()
    visual_reviewer_rows = db.execute(
        select(
            User.id,
            User.full_name,
            func.count(VisualReviewHistory.id),
        )
        .join(VisualReviewHistory, VisualReviewHistory.reviewer_id == User.id)
        .join(
            VisualAnalysisRecord,
            VisualAnalysisRecord.id == VisualReviewHistory.visual_analysis_id,
        )
        .where(
            VisualReviewHistory.organization_id == user.organization_id,
            VisualReviewHistory.created_at >= cutoff,
            User.organization_id == user.organization_id,
            VisualAnalysisRecord.organization_id == user.organization_id,
            *(
                [VisualAnalysisRecord.review_status == review_status]
                if review_status
                else []
            ),
            *(
                [VisualReviewHistory.reviewer_id == reviewer_id]
                if reviewer_id
                else []
            ),
        )
        .group_by(User.id, User.full_name)
    ).all()
    reviewer_workload_by_id = {
        reviewer_id: {
            "reviewer_id": reviewer_id,
            "reviewer_name": full_name,
            "decision_count": count,
            "approvals": approvals or 0,
            "visual_decision_count": 0,
        }
        for reviewer_id, full_name, count, approvals in reviewer_rows
    }
    for visual_reviewer_id, full_name, count in visual_reviewer_rows:
        workload = reviewer_workload_by_id.setdefault(
            visual_reviewer_id,
            {
                "reviewer_id": visual_reviewer_id,
                "reviewer_name": full_name,
                "decision_count": 0,
                "approvals": 0,
                "visual_decision_count": 0,
            },
        )
        workload["decision_count"] += count
        workload["visual_decision_count"] = count
    claim_reviewer_rows = db.execute(
        select(
            User.id,
            User.full_name,
            func.count(ClaimVerificationReviewHistory.id),
        )
        .join(
            ClaimVerificationReviewHistory,
            ClaimVerificationReviewHistory.reviewer_id == User.id,
        )
        .join(
            ClaimVerificationRecord,
            ClaimVerificationRecord.id
            == ClaimVerificationReviewHistory.claim_verification_id,
        )
        .where(
            ClaimVerificationReviewHistory.organization_id == user.organization_id,
            ClaimVerificationReviewHistory.created_at >= cutoff,
            User.organization_id == user.organization_id,
            ClaimVerificationRecord.organization_id == user.organization_id,
            *(
                [ClaimVerificationRecord.review_status == claim_review_status]
                if claim_review_status
                else []
            ),
            *(
                [ClaimVerificationReviewHistory.reviewer_id == reviewer_id]
                if reviewer_id
                else []
            ),
        )
        .group_by(User.id, User.full_name)
    ).all()
    for claim_reviewer_id, full_name, count in claim_reviewer_rows:
        workload = reviewer_workload_by_id.setdefault(
            claim_reviewer_id,
            {
                "reviewer_id": claim_reviewer_id,
                "reviewer_name": full_name,
                "decision_count": 0,
                "approvals": 0,
                "visual_decision_count": 0,
                "claim_decision_count": 0,
            },
        )
        workload["decision_count"] += count
        workload["claim_decision_count"] = count
    for workload in reviewer_workload_by_id.values():
        workload.setdefault("claim_decision_count", 0)
    assignment_workload_rows = db.execute(
        select(
            User.id,
            User.full_name,
            func.sum(case((ReviewAssignment.status == "pending", 1), else_=0)),
            func.sum(case((ReviewAssignment.status == "completed", 1), else_=0)),
            func.sum(case((ReviewAssignment.status == "cancelled", 1), else_=0)),
        )
        .join(ReviewAssignment, ReviewAssignment.reviewer_id == User.id)
        .where(
            ReviewAssignment.organization_id == user.organization_id,
            ReviewAssignment.assigned_at >= cutoff,
            User.organization_id == user.organization_id,
            *(
                [ReviewAssignment.reviewer_id == reviewer_id]
                if reviewer_id
                else []
            ),
        )
        .group_by(User.id, User.full_name)
    ).all()
    for (
        assigned_reviewer_id,
        full_name,
        pending_count,
        completed_count,
        cancelled_count,
    ) in assignment_workload_rows:
        workload = reviewer_workload_by_id.setdefault(
            assigned_reviewer_id,
            {
                "reviewer_id": assigned_reviewer_id,
                "reviewer_name": full_name,
                "decision_count": 0,
                "approvals": 0,
                "visual_decision_count": 0,
                "claim_decision_count": 0,
            },
        )
        workload["pending_assignments"] = int(pending_count or 0)
        workload["completed_assignments"] = int(completed_count or 0)
        workload["cancelled_assignments"] = int(cancelled_count or 0)
    for workload in reviewer_workload_by_id.values():
        workload.setdefault("pending_assignments", 0)
        workload.setdefault("completed_assignments", 0)
        workload.setdefault("cancelled_assignments", 0)
    reviewer_workload = sorted(
        reviewer_workload_by_id.values(),
        key=lambda item: item["decision_count"],
        reverse=True,
    )

    approval_rows = db.execute(
        select(ApprovalHistory.decision, func.count())
        .join(ContentSubmission, ContentSubmission.id == ApprovalHistory.submission_id)
        .where(
            ApprovalHistory.organization_id == user.organization_id,
            ApprovalHistory.created_at >= cutoff,
            ContentSubmission.organization_id == user.organization_id,
            *(
                [ContentSubmission.review_status == review_status]
                if review_status
                else []
            ),
            *(
                [ApprovalHistory.reviewer_id == reviewer_id]
                if reviewer_id
                else []
            ),
        )
        .group_by(ApprovalHistory.decision)
    ).all()
    approval_statistics = {decision: count for decision, count in approval_rows}
    for decision in ("approve", "reject", "request_revision"):
        approval_statistics.setdefault(decision, 0)

    total_approvals = approval_statistics.get("approve", 0)
    total_decisions = sum(approval_statistics.values())
    approval_statistics["approval_rate"] = round((total_approvals / total_decisions * 100) if total_decisions else 0, 1)
    review_time_rows = db.execute(
        select(ApprovalHistory.created_at, ContentSubmission.created_at)
        .join(ContentSubmission, ContentSubmission.id == ApprovalHistory.submission_id)
        .where(
            ApprovalHistory.organization_id == user.organization_id,
            ApprovalHistory.created_at >= cutoff,
            ContentSubmission.organization_id == user.organization_id,
            *(
                [ContentSubmission.review_status == review_status]
                if review_status
                else []
            ),
            *(
                [ApprovalHistory.reviewer_id == reviewer_id]
                if reviewer_id
                else []
            ),
        )
    ).all()
    visual_review_time_rows = db.execute(
        select(VisualReviewHistory.created_at, VisualAnalysisRecord.created_at)
        .join(
            VisualAnalysisRecord,
            VisualAnalysisRecord.id == VisualReviewHistory.visual_analysis_id,
        )
        .where(
            VisualReviewHistory.organization_id == user.organization_id,
            VisualReviewHistory.created_at >= cutoff,
            VisualAnalysisRecord.organization_id == user.organization_id,
            *(
                [VisualAnalysisRecord.review_status == review_status]
                if review_status
                else []
            ),
            *(
                [VisualReviewHistory.reviewer_id == reviewer_id]
                if reviewer_id
                else []
            ),
        )
    ).all()
    claim_review_time_rows = db.execute(
        select(
            ClaimVerificationReviewHistory.created_at,
            ClaimVerificationRecord.created_at,
        )
        .join(
            ClaimVerificationRecord,
            ClaimVerificationRecord.id
            == ClaimVerificationReviewHistory.claim_verification_id,
        )
        .where(
            ClaimVerificationReviewHistory.organization_id == user.organization_id,
            ClaimVerificationReviewHistory.created_at >= cutoff,
            ClaimVerificationRecord.organization_id == user.organization_id,
            *(
                [ClaimVerificationRecord.review_status == claim_review_status]
                if claim_review_status
                else []
            ),
            *(
                [ClaimVerificationReviewHistory.reviewer_id == reviewer_id]
                if reviewer_id
                else []
            ),
        )
    ).all()
    review_time_rows.extend(visual_review_time_rows)
    review_time_rows.extend(claim_review_time_rows)
    review_durations = []
    for reviewed_at, submitted_at in review_time_rows:
        if reviewed_at.tzinfo is None:
            reviewed_at = reviewed_at.replace(tzinfo=timezone.utc)
        if submitted_at.tzinfo is None:
            submitted_at = submitted_at.replace(tzinfo=timezone.utc)
        duration_hours = (reviewed_at - submitted_at).total_seconds() / 3600
        if duration_hours >= 0:
            review_durations.append(duration_hours)
    average_review_time_hours = round(
        sum(review_durations) / len(review_durations), 2
    ) if review_durations else 0

    visual_review_rows = db.execute(
        select(VisualReviewHistory.decision, func.count())
        .join(
            VisualAnalysisRecord,
            VisualAnalysisRecord.id == VisualReviewHistory.visual_analysis_id,
        )
        .where(
            VisualReviewHistory.organization_id == user.organization_id,
            VisualReviewHistory.created_at >= cutoff,
            VisualAnalysisRecord.organization_id == user.organization_id,
            *(
                [VisualAnalysisRecord.review_status == review_status]
                if review_status
                else []
            ),
            *(
                [VisualReviewHistory.reviewer_id == reviewer_id]
                if reviewer_id
                else []
            ),
        )
        .group_by(VisualReviewHistory.decision)
    ).all()
    visual_review_statistics = {decision: count for decision, count in visual_review_rows}
    for decision in ("approve", "reject", "request_revision"):
        visual_review_statistics.setdefault(decision, 0)
    total_visual_decisions = sum(visual_review_statistics.values())
    visual_review_statistics["approval_rate"] = round(
        (
            visual_review_statistics["approve"] / total_visual_decisions * 100
        )
        if total_visual_decisions
        else 0,
        1,
    )
    claim_review_rows = db.execute(
        select(ClaimVerificationReviewHistory.decision, func.count())
        .join(
            ClaimVerificationRecord,
            ClaimVerificationRecord.id
            == ClaimVerificationReviewHistory.claim_verification_id,
        )
        .where(
            ClaimVerificationReviewHistory.organization_id == user.organization_id,
            ClaimVerificationReviewHistory.created_at >= cutoff,
            ClaimVerificationRecord.organization_id == user.organization_id,
            *(
                [ClaimVerificationRecord.review_status == claim_review_status]
                if claim_review_status
                else []
            ),
            *(
                [ClaimVerificationReviewHistory.reviewer_id == reviewer_id]
                if reviewer_id
                else []
            ),
        )
        .group_by(ClaimVerificationReviewHistory.decision)
    ).all()
    claim_review_statistics = {
        decision: count for decision, count in claim_review_rows
    }
    for decision in ("approve", "reject", "request_additional_evidence"):
        claim_review_statistics.setdefault(decision, 0)
    total_claim_decisions = sum(claim_review_statistics.values())
    claim_review_statistics["approval_rate"] = round(
        (
            claim_review_statistics["approve"] / total_claim_decisions * 100
        )
        if total_claim_decisions
        else 0,
        1,
    )

    assignment_rows = db.execute(
        select(ReviewAssignment.status, func.count())
        .where(
            ReviewAssignment.organization_id == user.organization_id,
            ReviewAssignment.assigned_at >= cutoff,
            *(
                [ReviewAssignment.reviewer_id == reviewer_id]
                if reviewer_id
                else []
            ),
        )
        .group_by(ReviewAssignment.status)
    ).all()
    review_assignment_statistics = {
        status: count for status, count in assignment_rows
    }
    for status in ("pending", "completed", "cancelled"):
        review_assignment_statistics.setdefault(status, 0)
    assignment_type_rows = db.execute(
        _review_assignment_type_query(user.organization_id, cutoff, reviewer_id)
    ).all()
    assignments_by_resource = {
        resource_type: {"pending": 0, "completed": 0, "cancelled": 0}
        for resource_type in ("content", "visual", "claim")
    }
    for resource_type, status, count in assignment_type_rows:
        assignments_by_resource[resource_type][status] = count
    review_assignment_statistics["by_resource_type"] = assignments_by_resource

    claim_conditions = [
        ClaimVerificationRecord.organization_id == user.organization_id,
        ClaimVerificationRecord.created_at >= cutoff,
    ]
    if claim_review_status:
        claim_conditions.append(
            ClaimVerificationRecord.review_status == claim_review_status
        )
    if reviewer_id:
        claim_reviewers = _reviewer_resource_ids(
            ClaimVerificationReviewHistory,
            ClaimVerificationReviewHistory.claim_verification_id,
            ReviewAssignment.claim_verification_id,
            user.organization_id,
            reviewer_id,
            cutoff,
        )
        claim_conditions.append(ClaimVerificationRecord.id.in_(claim_reviewers))
    claim_records = db.scalars(
        select(ClaimVerificationRecord)
        .where(*claim_conditions)
        .order_by(ClaimVerificationRecord.created_at.asc())
    ).all()
    claim_analysis_ids = {
        record.analysis_id for record in claim_records if record.analysis_id
    }
    claim_daily: dict[str, dict[str, int]] = {}
    for record in claim_records:
        period = _period_key(record.created_at, granularity)
        counts = claim_daily.setdefault(
            period,
            {
                "supported": 0,
                "contradicted": 0,
                "insufficient_evidence": 0,
                "needs_review": 0,
            },
        )
        status = record.status
        if status in {"insufficient_evidence", "no_source_found"}:
            counts["insufficient_evidence"] += 1
        elif status in {"needs_review", "needs_verification"}:
            counts["needs_review"] += 1
        elif status in counts:
            counts[status] += 1
    legacy_claim_findings = db.scalars(
        select(Violation).where(
            Violation.organization_id == user.organization_id,
            Violation.created_at >= cutoff,
            *(
                [Violation.submission_id.in_(submission_ids)]
                if reviewer_id
                else []
            ),
        )
    ).all()
    for violation in legacy_claim_findings:
        if violation.analysis_id in claim_analysis_ids:
            continue
        if violation.evidence_status not in {
            "supported", "contradicted", "no_source_found", "needs_verification"
        }:
            continue
        period = _period_key(violation.created_at, granularity)
        counts = claim_daily.setdefault(
            period,
            {
                "supported": 0,
                "contradicted": 0,
                "insufficient_evidence": 0,
                "needs_review": 0,
            },
        )
        legacy_status = {
            "no_source_found": "insufficient_evidence",
            "needs_verification": "needs_review",
        }.get(violation.evidence_status, violation.evidence_status)
        counts[legacy_status] += 1
    claim_verification_trends = [
        {"date": period, **counts} for period, counts in sorted(claim_daily.items())
    ]

    visual_conditions = [
        VisualAnalysisRecord.organization_id == user.organization_id,
        VisualAnalysisRecord.created_at >= cutoff,
    ]
    if review_status:
        visual_status = (
            "revision_requested"
            if review_status == "revision_requested"
            else review_status
        )
        visual_conditions.append(VisualAnalysisRecord.review_status == visual_status)
    if reviewer_id:
        visual_reviewers = _reviewer_resource_ids(
            VisualReviewHistory,
            VisualReviewHistory.visual_analysis_id,
            ReviewAssignment.visual_analysis_id,
            user.organization_id,
            reviewer_id,
            cutoff,
        )
        visual_conditions.append(VisualAnalysisRecord.id.in_(visual_reviewers))
    visual_records = db.scalars(
        select(VisualAnalysisRecord)
        .where(*visual_conditions)
        .order_by(VisualAnalysisRecord.created_at.asc(), VisualAnalysisRecord.id.asc())
    ).all()
    visual_daily_records: dict[str, dict[str, VisualAnalysisRecord]] = {}
    for record in visual_records:
        period = _period_key(record.created_at, granularity)
        visual_daily_records.setdefault(period, {})[record.asset_id] = record

    visual_daily: dict[str, dict[str, int]] = {}
    for period, assets in sorted(visual_daily_records.items()):
        counts = {
            "analyzed_assets": len(assets),
            "potential_findings": 0,
            "needs_verification": 0,
        }
        for record in assets.values():
            report = json.loads(record.result_json)
            for finding in report.get("findings", []):
                if finding.get("verification_status") == "potential_violation":
                    counts["potential_findings"] += 1
                elif finding.get("verification_status") == "needs_verification":
                    counts["needs_verification"] += 1
        visual_daily[period] = counts
    visual_compliance_trends = [
        {"date": period, **counts} for period, counts in sorted(visual_daily.items())
    ]

    pending_content_reviews = db.scalar(
        select(func.count())
        .select_from(ContentSubmission)
        .where(
            ContentSubmission.organization_id == user.organization_id,
            ContentSubmission.created_at >= cutoff,
            ContentSubmission.id.in_(submission_ids),
            ContentSubmission.review_status == "pending",
        )
    ) or 0
    pending_claim_reviews = sum(
        1 for record in claim_records if record.review_status == "pending"
    )
    claims_awaiting_evidence = sum(
        1
        for record in claim_records
        if record.review_status == "additional_evidence_requested"
    )
    pending_visual_reviews = sum(
        1 for record in visual_records if record.review_status == "pending"
    )
    visuals_awaiting_revision = sum(
        1 for record in visual_records if record.review_status == "revision_requested"
    )
    total_pending_resources = (
        pending_content_reviews + pending_claim_reviews + pending_visual_reviews
    )
    review_backlog = {
        "pending_content": pending_content_reviews,
        "pending_claims": pending_claim_reviews,
        "pending_visual_analyses": pending_visual_reviews,
        "claims_awaiting_additional_evidence": claims_awaiting_evidence,
        "visuals_awaiting_revision": visuals_awaiting_revision,
        "total_pending_resources": total_pending_resources,
        "total_action_required": (
            total_pending_resources
            + claims_awaiting_evidence
            + visuals_awaiting_revision
        ),
        "pending_assignment_records": review_assignment_statistics["pending"],
    }

    content_decision_count = sum(
        approval_statistics[key]
        for key in ("approve", "reject", "request_revision")
    )
    visual_decision_count = sum(
        visual_review_statistics[key]
        for key in ("approve", "reject", "request_revision")
    )
    claim_decision_count = sum(
        claim_review_statistics[key]
        for key in ("approve", "reject", "request_additional_evidence")
    )
    review_decision_statistics = {
        "content": {
            key: approval_statistics[key]
            for key in ("approve", "reject", "request_revision")
        },
        "visual": {
            key: visual_review_statistics[key]
            for key in ("approve", "reject", "request_revision")
        },
        "claim": {
            key: claim_review_statistics[key]
            for key in ("approve", "reject", "request_additional_evidence")
        },
        "content_decisions": content_decision_count,
        "visual_decisions": visual_decision_count,
        "claim_decisions": claim_decision_count,
        "total_completed_decisions": (
            content_decision_count + visual_decision_count + claim_decision_count
        ),
    }

    return {
        "issue_categories": {category: count for category, count in category_rows},
        "severity_distribution": overview.severity_distribution,
        "compliance_trend": overview.compliance_trend,
        "recurring_violations": recurring_violations,
        "reviewer_workload": reviewer_workload,
        "approval_statistics": approval_statistics,
        "average_review_time_hours": average_review_time_hours,
        "visual_review_statistics": visual_review_statistics,
        "claim_verification_trends": claim_verification_trends,
        "visual_compliance_trends": visual_compliance_trends,
        "review_assignment_statistics": review_assignment_statistics,
        "review_backlog": review_backlog,
        "review_decision_statistics": review_decision_statistics,
        "reviewers": [
            {"reviewer_id": reviewer_id, "reviewer_name": reviewer_name}
            for reviewer_id, reviewer_name in reviewer_options
        ],
        "trend_granularity": granularity,
    }
