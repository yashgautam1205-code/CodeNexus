"""add claim taxonomy and review assignments

Revision ID: f1b930d7c215
Revises: a411f6d29b7c
Create Date: 2026-11-18
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f1b930d7c215"
down_revision: Union[str, None] = "a411f6d29b7c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(table_name: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table_name)}


def _indexes(table_name: str) -> set[str]:
    return {index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table_name)}


def upgrade() -> None:
    op.execute(
        "UPDATE claim_verification_records "
        "SET status = 'insufficient_evidence' WHERE status = 'no_source_found'"
    )
    op.execute(
        "UPDATE claim_verification_records "
        "SET status = 'needs_review' WHERE status = 'needs_verification'"
    )

    if "asset_kind" not in _columns("brand_assets"):
        with op.batch_alter_table("brand_assets") as batch_op:
            batch_op.add_column(
                sa.Column(
                    "asset_kind",
                    sa.String(length=32),
                    nullable=False,
                    server_default="creative",
                )
            )

    claim_columns = _columns("claim_verification_records")
    claim_additions = (
        sa.Column(
            "claim_type",
            sa.String(length=32),
            nullable=False,
            server_default="objective_factual",
        ),
        sa.Column(
            "time_sensitive",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column(
            "assessment_status",
            sa.String(length=32),
            nullable=False,
            server_default="not_attempted",
        ),
        sa.Column("last_verified_at", sa.String(length=64), nullable=True),
    )
    missing_claim_additions = [
        column for column in claim_additions if column.name not in claim_columns
    ]
    if missing_claim_additions:
        with op.batch_alter_table("claim_verification_records") as batch_op:
            for column in missing_claim_additions:
                batch_op.add_column(column)

    review_assignments_table = "review_assignments"
    if not sa.inspect(op.get_bind()).has_table(review_assignments_table):
        op.create_table(
            review_assignments_table,
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("organization_id", sa.String(length=36), nullable=False),
            sa.Column("reviewer_id", sa.String(length=36), nullable=False),
            sa.Column("assigned_by", sa.String(length=36), nullable=False),
            sa.Column("content_submission_id", sa.String(length=36), nullable=True),
            sa.Column("visual_analysis_id", sa.String(length=36), nullable=True),
            sa.Column("claim_verification_id", sa.String(length=36), nullable=True),
            sa.Column("status", sa.String(length=24), nullable=False, server_default="pending"),
            sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.CheckConstraint(
                "(CASE WHEN content_submission_id IS NOT NULL THEN 1 ELSE 0 END + "
                "CASE WHEN visual_analysis_id IS NOT NULL THEN 1 ELSE 0 END + "
                "CASE WHEN claim_verification_id IS NOT NULL THEN 1 ELSE 0 END) = 1",
                name="ck_review_assignment_one_resource",
            ),
            sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
            sa.ForeignKeyConstraint(["reviewer_id"], ["users.id"]),
            sa.ForeignKeyConstraint(["assigned_by"], ["users.id"]),
            sa.ForeignKeyConstraint(
                ["content_submission_id"],
                ["content_submissions.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["visual_analysis_id"],
                ["visual_analysis_records.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["claim_verification_id"],
                ["claim_verification_records.id"],
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id"),
        )

    assignment_columns = _columns(review_assignments_table)
    required_assignment_columns = {
        "id",
        "organization_id",
        "reviewer_id",
        "assigned_by",
        "content_submission_id",
        "visual_analysis_id",
        "claim_verification_id",
        "status",
        "assigned_at",
        "completed_at",
    }
    if not required_assignment_columns.issubset(assignment_columns):
        raise RuntimeError(
            f"{review_assignments_table} exists without the columns required by this migration."
        )

    for column in (
        "organization_id",
        "reviewer_id",
        "content_submission_id",
        "visual_analysis_id",
        "claim_verification_id",
    ):
        index_name = op.f("ix_review_assignments_" + column)
        if index_name not in _indexes(review_assignments_table):
            op.create_index(
                index_name,
                review_assignments_table,
                [column],
                unique=False,
            )


def downgrade() -> None:
    for column in (
        "claim_verification_id",
        "visual_analysis_id",
        "content_submission_id",
        "reviewer_id",
        "organization_id",
    ):
        op.drop_index(
            op.f("ix_review_assignments_" + column),
            table_name="review_assignments",
        )
    op.drop_table("review_assignments")
    op.execute(
        "UPDATE claim_verification_records "
        "SET status = 'no_source_found' WHERE status = 'insufficient_evidence'"
    )
    op.execute(
        "UPDATE claim_verification_records "
        "SET status = 'needs_verification' WHERE status = 'needs_review'"
    )
    with op.batch_alter_table("claim_verification_records") as batch_op:
        batch_op.drop_column("last_verified_at")
        batch_op.drop_column("assessment_status")
        batch_op.drop_column("time_sensitive")
        batch_op.drop_column("claim_type")
    with op.batch_alter_table("brand_assets") as batch_op:
        batch_op.drop_column("asset_kind")
