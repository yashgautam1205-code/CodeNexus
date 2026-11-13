"""persist visual and external claim verification results

Revision ID: c5310caee341
Revises: b78a23e01f64
Create Date: 2026-11-11
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c5310caee341"
down_revision: Union[str, None] = "b78a23e01f64"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "brand_assets",
        sa.Column("approved", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_table(
        "visual_analysis_records",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("asset_id", sa.String(length=36), nullable=False),
        sa.Column("analyzed_by", sa.String(length=36), nullable=False),
        sa.Column("provider_status", sa.String(length=32), nullable=False),
        sa.Column("result_json", sa.Text(), nullable=False),
        sa.Column("review_status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("reviewed_by", sa.String(length=36), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_comment", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["asset_id"], ["brand_assets.id"]),
        sa.ForeignKeyConstraint(["analyzed_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["reviewed_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_visual_analysis_records_organization_id"),
        "visual_analysis_records",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_visual_analysis_records_asset_id"),
        "visual_analysis_records",
        ["asset_id"],
        unique=False,
    )
    op.create_table(
        "claim_verification_records",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("submission_id", sa.String(length=36), nullable=True),
        sa.Column("analysis_id", sa.String(length=36), nullable=True),
        sa.Column("verified_by", sa.String(length=36), nullable=False),
        sa.Column("claim_text", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("provider_status", sa.String(length=32), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("retrieval_timestamp", sa.String(length=64), nullable=True),
        sa.Column("evidence_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["submission_id"], ["content_submissions.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["analysis_id"], ["analysis_results.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["verified_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_claim_verification_records_organization_id"),
        "claim_verification_records",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_claim_verification_records_submission_id"),
        "claim_verification_records",
        ["submission_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_claim_verification_records_analysis_id"),
        "claim_verification_records",
        ["analysis_id"],
        unique=False,
    )
    op.create_table(
        "visual_review_history",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("visual_analysis_id", sa.String(length=36), nullable=False),
        sa.Column("reviewer_id", sa.String(length=36), nullable=False),
        sa.Column("decision", sa.String(length=24), nullable=False),
        sa.Column("previous_status", sa.String(length=32), nullable=False),
        sa.Column("new_status", sa.String(length=32), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["visual_analysis_id"], ["visual_analysis_records.id"]),
        sa.ForeignKeyConstraint(["reviewer_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_visual_review_history_organization_id"),
        "visual_review_history",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_visual_review_history_visual_analysis_id"),
        "visual_review_history",
        ["visual_analysis_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_visual_review_history_visual_analysis_id"), table_name="visual_review_history")
    op.drop_index(op.f("ix_visual_review_history_organization_id"), table_name="visual_review_history")
    op.drop_table("visual_review_history")
    op.drop_index(op.f("ix_claim_verification_records_analysis_id"), table_name="claim_verification_records")
    op.drop_index(op.f("ix_claim_verification_records_submission_id"), table_name="claim_verification_records")
    op.drop_index(op.f("ix_claim_verification_records_organization_id"), table_name="claim_verification_records")
    op.drop_table("claim_verification_records")
    op.drop_index(op.f("ix_visual_analysis_records_asset_id"), table_name="visual_analysis_records")
    op.drop_index(op.f("ix_visual_analysis_records_organization_id"), table_name="visual_analysis_records")
    op.drop_table("visual_analysis_records")
    op.drop_column("brand_assets", "approved")
