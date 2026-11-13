"""add human review history for claim verification

Revision ID: a411f6d29b7c
Revises: d8a4c1f76b20
Create Date: 2026-11-13
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a411f6d29b7c"
down_revision: Union[str, None] = "d8a4c1f76b20"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(table_name: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table_name)}


def _indexes(table_name: str) -> set[str]:
    return {index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table_name)}


def upgrade() -> None:
    claim_columns = _columns("claim_verification_records")
    claim_foreign_keys = sa.inspect(op.get_bind()).get_foreign_keys(
        "claim_verification_records"
    )
    has_reviewed_by_foreign_key = any(
        foreign_key.get("constrained_columns") == ["reviewed_by"]
        and foreign_key.get("referred_table") == "users"
        and foreign_key.get("referred_columns") == ["id"]
        for foreign_key in claim_foreign_keys
    )
    missing_columns = {
        "review_status",
        "reviewed_by",
        "reviewed_at",
        "review_comment",
    } - claim_columns
    if missing_columns or not has_reviewed_by_foreign_key:
        with op.batch_alter_table("claim_verification_records") as batch_op:
            if "review_status" in missing_columns:
                batch_op.add_column(
                    sa.Column(
                        "review_status",
                        sa.String(length=32),
                        nullable=False,
                        server_default="pending",
                    )
                )
            if "reviewed_by" in missing_columns:
                batch_op.add_column(
                    sa.Column("reviewed_by", sa.String(length=36), nullable=True)
                )
            if "reviewed_at" in missing_columns:
                batch_op.add_column(
                    sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True)
                )
            if "review_comment" in missing_columns:
                batch_op.add_column(sa.Column("review_comment", sa.Text(), nullable=True))
            if not has_reviewed_by_foreign_key:
                batch_op.create_foreign_key(
                    "fk_claim_verification_records_reviewed_by_users",
                    "users",
                    ["reviewed_by"],
                    ["id"],
                )

    review_history_table = "claim_verification_review_history"
    if not sa.inspect(op.get_bind()).has_table(review_history_table):
        op.create_table(
            review_history_table,
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("organization_id", sa.String(length=36), nullable=False),
            sa.Column("claim_verification_id", sa.String(length=36), nullable=False),
            sa.Column("reviewer_id", sa.String(length=36), nullable=False),
            sa.Column("decision", sa.String(length=32), nullable=False),
            sa.Column("previous_status", sa.String(length=32), nullable=False),
            sa.Column("new_status", sa.String(length=32), nullable=False),
            sa.Column("comment", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
            sa.ForeignKeyConstraint(
                ["claim_verification_id"], ["claim_verification_records.id"]
            ),
            sa.ForeignKeyConstraint(["reviewer_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )

    existing_columns = _columns(review_history_table)
    required_columns = {
        "id",
        "organization_id",
        "claim_verification_id",
        "reviewer_id",
        "decision",
        "previous_status",
        "new_status",
        "comment",
        "created_at",
    }
    if not required_columns.issubset(existing_columns):
        raise RuntimeError(
            f"{review_history_table} exists without the columns required by this migration."
        )

    for column in ("organization_id", "claim_verification_id"):
        index_name = op.f(f"ix_claim_verification_review_history_{column}")
        if index_name not in _indexes(review_history_table):
            op.create_index(
                index_name,
                review_history_table,
                [column],
                unique=False,
            )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_claim_verification_review_history_claim_verification_id"),
        table_name="claim_verification_review_history",
    )
    op.drop_index(
        op.f("ix_claim_verification_review_history_organization_id"),
        table_name="claim_verification_review_history",
    )
    op.drop_table("claim_verification_review_history")
    with op.batch_alter_table("claim_verification_records") as batch_op:
        batch_op.drop_constraint(
            "fk_claim_verification_records_reviewed_by_users",
            type_="foreignkey",
        )
        batch_op.drop_column("review_comment")
        batch_op.drop_column("reviewed_at")
        batch_op.drop_column("reviewed_by")
        batch_op.drop_column("review_status")
