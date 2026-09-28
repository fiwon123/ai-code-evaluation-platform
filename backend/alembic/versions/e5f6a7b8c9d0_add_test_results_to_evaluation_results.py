"""add test_results to evaluation_results

Revision ID: e5f6a7b8c9d0
Revises: a1fa7d3e9b2c
Create Date: 2026-09-24 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, Sequence[str], None] = 'a1fa7d3e9b2c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add nullable per-test-case breakdown column (JSON list of dicts)."""
    op.add_column(
        'evaluation_results', sa.Column('test_results', sa.JSON(), nullable=True)
    )


def downgrade() -> None:
    """Drop the per-test-case breakdown column."""
    op.drop_column('evaluation_results', 'test_results')