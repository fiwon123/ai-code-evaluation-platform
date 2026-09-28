"""add language column to submissions

Revision ID: c4a1b2d3e4f5
Revises: 9df6e57961cc
Create Date: 2026-09-22 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4a1b2d3e4f5'
down_revision: Union[str, Sequence[str], None] = '9df6e57961cc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add nullable language column (backfilled from the challenge on creation)."""
    op.add_column('submissions', sa.Column('language', sa.String(length=50), nullable=True))


def downgrade() -> None:
    """Drop the language column."""
    op.drop_column('submissions', 'language')