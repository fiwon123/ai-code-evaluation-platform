"""add check constraint on challenges.language

Revision ID: a1b2c3d4e5f6
Revises: c4a1b2d3e4f5
Create Date: 2026-09-22 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = 'c4a1b2d3e4f5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_CONSTRAINT_NAME = 'ck_challenges_language_supported'


def upgrade() -> None:
    """Enforce supported evaluation languages at the DB level."""
    op.create_check_constraint(
        _CONSTRAINT_NAME,
        'challenges',
        "language IN ('python', 'javascript', 'typescript', 'java', 'go')",
    )


def downgrade() -> None:
    """Drop the language check constraint."""
    op.drop_constraint(_CONSTRAINT_NAME, 'challenges', type_='check')