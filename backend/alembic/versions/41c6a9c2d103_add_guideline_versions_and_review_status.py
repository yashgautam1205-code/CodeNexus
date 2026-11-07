"""add guideline versions and review status transitions

Revision ID: 41c6a9c2d103
Revises: 959d7487892e
Create Date: 2026-11-05
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "41c6a9c2d103"
down_revision: Union[str, None] = "959d7487892e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "brand_guidelines",
        sa.Column("version_number", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column(
        "brand_guidelines",
        sa.Column("supersedes_guideline_id", sa.String(length=36), nullable=True),
    )
    with op.batch_alter_table("brand_guidelines") as batch_op:
        batch_op.create_foreign_key(
            "fk_brand_guidelines_supersedes_guideline_id",
            "brand_guidelines",
            ["supersedes_guideline_id"],
            ["id"],
            ondelete="SET NULL",
        )
    op.add_column(
        "approval_history",
        sa.Column("previous_status", sa.String(length=32), nullable=False, server_default="unknown"),
    )
    op.add_column(
        "approval_history",
        sa.Column("new_status", sa.String(length=32), nullable=False, server_default="unknown"),
    )


def downgrade() -> None:
    op.drop_column("approval_history", "new_status")
    op.drop_column("approval_history", "previous_status")
    with op.batch_alter_table("brand_guidelines") as batch_op:
        batch_op.drop_constraint(
            "fk_brand_guidelines_supersedes_guideline_id",
            type_="foreignkey",
        )
    op.drop_column("brand_guidelines", "supersedes_guideline_id")
    op.drop_column("brand_guidelines", "version_number")
