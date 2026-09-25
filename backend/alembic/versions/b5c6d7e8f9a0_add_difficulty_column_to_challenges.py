"""add difficulty column to challenges

Revision ID: b5c6d7e8f9a0
Revises: f8a9b0c1d2e3
Create Date: 2026-09-25 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b5c6d7e8f9a0'
down_revision: Union[str, Sequence[str], None] = 'f8a9b0c1d2e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_CONSTRAINT_NAME = 'ck_challenges_difficulty_supported'


def upgrade() -> None:
    """Add the difficulty column (backfilled via server_default) + check."""
    op.add_column(
        'challenges',
        sa.Column(
            'difficulty',
            sa.String(length=20),
            nullable=False,
            server_default='medium',
        ),
    )
    op.create_check_constraint(
        _CONSTRAINT_NAME,
        'challenges',
        "difficulty IN ('easy', 'medium', 'hard')",
    )


def downgrade() -> None:
    """Drop the difficulty check constraint and column."""
    op.drop_constraint(_CONSTRAINT_NAME, 'challenges', type_='check')
    op.drop_column('challenges', 'difficulty')