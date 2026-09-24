"""add live status columns to submissions

Revision ID: f8a9b0c1d2e3
Revises: f7a8b9c0d1e2
Create Date: 2026-09-24 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f8a9b0c1d2e3'
down_revision: Union[str, Sequence[str], None] = 'f7a8b9c0d1e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'submissions',
        sa.Column('started_at', sa.DateTime(), nullable=True),
    )
    op.add_column(
        'submissions',
        sa.Column('phase', sa.String(length=20), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('submissions', 'phase')
    op.drop_column('submissions', 'started_at')