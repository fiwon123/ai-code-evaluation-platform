"""add model column to submissions

Revision ID: d1e2f3a4b5c6
Revises: c1d2e3f4a5b6
Create Date: 2026-09-25 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd1e2f3a4b5c6'
down_revision: Union[str, Sequence[str], None] = 'c1d2e3f4a5b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add nullable model column (resolved from the catalog on creation)."""
    op.add_column('submissions', sa.Column('model', sa.String(length=100), nullable=True))


def downgrade() -> None:
    """Drop the model column."""
    op.drop_column('submissions', 'model')