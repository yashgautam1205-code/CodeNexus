from datetime import datetime, timezone
from enum import StrEnum
from uuid import uuid4

from sqlalchemy import Boolean, CheckConstraint, DateTime, Float, ForeignKey, Integer, String, Text, false
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.session import Base


def new_id() -> str:
    return str(uuid4())


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class UserRole(StrEnum):
    ADMIN = "admin"
    BRAND_MANAGER = "brand_manager"
    CONTENT_CREATOR = "content_creator"
    REVIEWER = "reviewer"


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    users: Mapped[list["User"]] = relationship(back_populates="organization")


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(160), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(512), nullable=False)
    role: Mapped[str] = mapped_column(String(32), default=UserRole.ADMIN.value, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    organization: Mapped[Organization] = relationship(back_populates="users")


class BrandGuideline(Base):
    __tablename__ = "brand_guidelines"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    extracted_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="needs_review", nullable=False)
    version_number: Mapped[int] = mapped_column(default=1, server_default="1", nullable=False)
    supersedes_guideline_id: Mapped[str | None] = mapped_column(
        ForeignKey("brand_guidelines.id", ondelete="SET NULL"), nullable=True
    )
    uploaded_by: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    rules: Mapped[list["BrandRule"]] = relationship(
        back_populates="guideline", cascade="all, delete-orphan"
    )


class BrandAsset(Base):
    __tablename__ = "brand_assets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    uploaded_by: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    media_type: Mapped[str] = mapped_column(String(120), nullable=False)
    asset_kind: Mapped[str] = mapped_column(
        String(32), default="creative", server_default="creative", nullable=False
    )
    approved: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class VisualAnalysisRecord(Base):
    __tablename__ = "visual_analysis_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    asset_id: Mapped[str] = mapped_column(ForeignKey("brand_assets.id"), index=True)
    submission_id: Mapped[str | None] = mapped_column(
        ForeignKey("content_submissions.id", ondelete="SET NULL"), nullable=True, index=True
    )
    analyzed_by: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    provider_status: Mapped[str] = mapped_column(String(32), nullable=False)
    result_json: Mapped[str] = mapped_column(Text, nullable=False)
    review_status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)
    reviewed_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class VisualReviewHistory(Base):
    __tablename__ = "visual_review_history"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    visual_analysis_id: Mapped[str] = mapped_column(
        ForeignKey("visual_analysis_records.id"), index=True
    )
    reviewer_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    decision: Mapped[str] = mapped_column(String(24), nullable=False)
    previous_status: Mapped[str] = mapped_column(String(32), nullable=False)
    new_status: Mapped[str] = mapped_column(String(32), nullable=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class ClaimVerificationRecord(Base):
    __tablename__ = "claim_verification_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    submission_id: Mapped[str | None] = mapped_column(
        ForeignKey("content_submissions.id", ondelete="SET NULL"), nullable=True, index=True
    )
    analysis_id: Mapped[str | None] = mapped_column(
        ForeignKey("analysis_results.id", ondelete="SET NULL"), nullable=True, index=True
    )
    verified_by: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    claim_text: Mapped[str] = mapped_column(Text, nullable=False)
    claim_type: Mapped[str] = mapped_column(
        String(32), default="objective_factual", server_default="objective_factual", nullable=False
    )
    time_sensitive: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=false(), nullable=False
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    provider_status: Mapped[str] = mapped_column(String(32), nullable=False)
    assessment_status: Mapped[str] = mapped_column(
        String(32), default="not_attempted", server_default="not_attempted", nullable=False
    )
    assessment_model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    assessment_rationale: Mapped[str | None] = mapped_column(Text, nullable=True)
    assessment_source_ids_json: Mapped[str] = mapped_column(
        Text, default="[]", server_default="[]", nullable=False
    )
    assessment_error_type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    assessment_error_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    retrieval_timestamp: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_verified_at: Mapped[str | None] = mapped_column(String(64), nullable=True)
    evidence_json: Mapped[str] = mapped_column(Text, nullable=False)
    review_status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)
    reviewed_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class ClaimVerificationReviewHistory(Base):
    __tablename__ = "claim_verification_review_history"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    claim_verification_id: Mapped[str] = mapped_column(
        ForeignKey("claim_verification_records.id"), index=True
    )
    reviewer_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    decision: Mapped[str] = mapped_column(String(32), nullable=False)
    previous_status: Mapped[str] = mapped_column(String(32), nullable=False)
    new_status: Mapped[str] = mapped_column(String(32), nullable=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class ReviewAssignment(Base):
    __tablename__ = "review_assignments"
    __table_args__ = (
        CheckConstraint(
            "(CASE WHEN content_submission_id IS NOT NULL THEN 1 ELSE 0 END + "
            "CASE WHEN visual_analysis_id IS NOT NULL THEN 1 ELSE 0 END + "
            "CASE WHEN claim_verification_id IS NOT NULL THEN 1 ELSE 0 END) = 1",
            name="ck_review_assignment_one_resource",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    reviewer_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    assigned_by: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    content_submission_id: Mapped[str | None] = mapped_column(
        ForeignKey("content_submissions.id", ondelete="CASCADE"), nullable=True, index=True
    )
    visual_analysis_id: Mapped[str | None] = mapped_column(
        ForeignKey("visual_analysis_records.id", ondelete="CASCADE"), nullable=True, index=True
    )
    claim_verification_id: Mapped[str | None] = mapped_column(
        ForeignKey("claim_verification_records.id", ondelete="CASCADE"), nullable=True, index=True
    )
    status: Mapped[str] = mapped_column(
        String(24), default="pending", server_default="pending", nullable=False
    )
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class BrandRule(Base):
    __tablename__ = "brand_rules"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    guideline_id: Mapped[str | None] = mapped_column(
        ForeignKey("brand_guidelines.id", ondelete="SET NULL"), nullable=True
    )
    category: Mapped[str] = mapped_column(String(48), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    rule_text: Mapped[str] = mapped_column(Text, nullable=False)
    term: Mapped[str | None] = mapped_column(String(200), nullable=True)
    source_section: Mapped[str | None] = mapped_column(String(200), nullable=True)
    source_page: Mapped[int | None] = mapped_column(nullable=True)
    replacement_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    approved: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )
    guideline: Mapped[BrandGuideline | None] = relationship(back_populates="rules")


class ContentSubmission(Base):
    __tablename__ = "content_submissions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    submitted_by: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    extracted_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="uploaded", nullable=False)
    review_status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class AnalysisResult(Base):
    __tablename__ = "analysis_results"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    submission_id: Mapped[str] = mapped_column(ForeignKey("content_submissions.id"), index=True)
    analyzed_by: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    compliance_score: Mapped[float] = mapped_column(Float, nullable=False)
    analysis_status: Mapped[str] = mapped_column(String(24), nullable=False)
    analysis_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    score_formula: Mapped[str] = mapped_column(String(48), default="severity-weighted-v1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class Violation(Base):
    __tablename__ = "violations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    submission_id: Mapped[str] = mapped_column(ForeignKey("content_submissions.id"), index=True)
    analysis_id: Mapped[str] = mapped_column(ForeignKey("analysis_results.id"), index=True)
    category: Mapped[str] = mapped_column(String(48), nullable=False)
    affected_text: Mapped[str] = mapped_column(Text, nullable=False)
    explanation: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    evidence_status: Mapped[str] = mapped_column(String(32), nullable=False)
    evidence_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_guideline_id: Mapped[str | None] = mapped_column(
        ForeignKey("brand_guidelines.id", ondelete="SET NULL"), nullable=True
    )
    source_page: Mapped[int | None] = mapped_column(nullable=True)
    source_rule_id: Mapped[str | None] = mapped_column(
        ForeignKey("brand_rules.id", ondelete="SET NULL"), nullable=True
    )
    source_section: Mapped[str | None] = mapped_column(String(200), nullable=True)
    suggested_correction: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class CorrectionSuggestion(Base):
    __tablename__ = "correction_suggestions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    violation_id: Mapped[str] = mapped_column(ForeignKey("violations.id"), index=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    original_text: Mapped[str] = mapped_column(Text, nullable=False)
    suggested_text: Mapped[str] = mapped_column(Text, nullable=False)
    decision: Mapped[str] = mapped_column(String(24), default="pending", nullable=False)
    generation_source: Mapped[str | None] = mapped_column(String(24), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class ApprovalHistory(Base):
    __tablename__ = "approval_history"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    submission_id: Mapped[str] = mapped_column(ForeignKey("content_submissions.id"), index=True)
    reviewer_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    decision: Mapped[str] = mapped_column(String(24), nullable=False)
    previous_status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="unknown", server_default="unknown"
    )
    new_status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="unknown", server_default="unknown"
    )
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(36), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
