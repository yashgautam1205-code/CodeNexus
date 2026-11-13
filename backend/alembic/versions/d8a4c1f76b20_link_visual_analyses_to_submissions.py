"""link visual analyses to content submissions

Revision ID: d8a4c1f76b20
Revises: c5310caee341
Create Date: 2026-11-11
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d8a4c1f76b20"
down_revision: Union[str, None] = "c5310caee341"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("visual_analysis_records") as batch_op:
        batch_op.add_column(sa.Column("submission_id", sa.String(length=36), nullable=True))
        batch_op.create_foreign_key(
            "fk_visual_analysis_records_submission_id_content_submissions",
            "content_submissions",
            ["submission_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index("ix_visual_analysis_records_submission_id", ["submission_id"])


def downgrade() -> None:
    with op.batch_alter_table("visual_analysis_records") as batch_op:
        batch_op.drop_index("ix_visual_analysis_records_submission_id")
        batch_op.drop_constraint(
            "fk_visual_analysis_records_submission_id_content_submissions",
            type_="foreignkey",
        )
        batch_op.drop_column("submission_id")
