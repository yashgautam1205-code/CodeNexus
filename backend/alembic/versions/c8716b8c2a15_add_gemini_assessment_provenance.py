"""add Gemini assessment provenance

Revision ID: c8716b8c2a15
Revises: f1b930d7c215
Create Date: 2026-11-13
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c8716b8c2a15"
down_revision: Union[str, None] = "f1b930d7c215"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(table_name: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table_name)}


def upgrade() -> None:
    claim_columns = _columns("claim_verification_records")
    claim_additions = (
        sa.Column("assessment_model", sa.String(length=100), nullable=True),
        sa.Column("assessment_rationale", sa.Text(), nullable=True),
        sa.Column(
            "assessment_source_ids_json",
            sa.Text(),
            nullable=False,
            server_default="[]",
        ),
        sa.Column("assessment_error_type", sa.String(length=80), nullable=True),
        sa.Column("assessment_error_code", sa.Integer(), nullable=True),
    )
    missing_claim_additions = [
        column for column in claim_additions if column.name not in claim_columns
    ]
    if missing_claim_additions:
        with op.batch_alter_table("claim_verification_records") as batch_op:
            for column in missing_claim_additions:
                batch_op.add_column(column)


def downgrade() -> None:
    with op.batch_alter_table("claim_verification_records") as batch_op:
        batch_op.drop_column("assessment_error_code")
        batch_op.drop_column("assessment_error_type")
        batch_op.drop_column("assessment_source_ids_json")
        batch_op.drop_column("assessment_rationale")
        batch_op.drop_column("assessment_model")
