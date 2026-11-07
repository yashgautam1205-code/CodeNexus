"""record suggestion and guideline page provenance

Revision ID: b78a23e01f64
Revises: 41c6a9c2d103
Create Date: 2026-11-05
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b78a23e01f64"
down_revision: Union[str, None] = "41c6a9c2d103"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "brand_rules",
        sa.Column("source_page", sa.Integer(), nullable=True),
    )
    op.add_column(
        "violations",
        sa.Column("source_page", sa.Integer(), nullable=True),
    )
    op.add_column(
        "correction_suggestions",
        sa.Column("generation_source", sa.String(length=24), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("correction_suggestions", "generation_source")
    op.drop_column("violations", "source_page")
    op.drop_column("brand_rules", "source_page")
