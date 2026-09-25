"""expand challenges.language check constraint to 20 languages

Revision ID: a2b3c4d5e6f7
Revises: d1e2f3a4b5c6
Create Date: 2026-09-25 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a2b3c4d5e6f7'
down_revision: Union[str, Sequence[str], None] = 'd1e2f3a4b5c6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_CONSTRAINT_NAME = 'ck_challenges_language_supported'
_LANGUAGES = (
    "'python', 'javascript', 'typescript', 'java', 'go', "
    "'c', 'cpp', 'rust', 'php', 'ruby', 'perl', 'kotlin', 'lua', "
    "'csharp', 'swift', 'dart', 'scala', 'r', 'haskell', 'objective-c'"
)


def upgrade() -> None:
    """Widen the language check constraint to the full 20-language catalog."""
    op.drop_constraint(_CONSTRAINT_NAME, 'challenges', type_='check')
    op.create_check_constraint(
        _CONSTRAINT_NAME,
        'challenges',
        f'language IN ({_LANGUAGES})',
    )


def downgrade() -> None:
    """Restore the original 5-language constraint."""
    op.drop_constraint(_CONSTRAINT_NAME, 'challenges', type_='check')
    op.create_check_constraint(
        _CONSTRAINT_NAME,
        'challenges',
        "language IN ('python', 'javascript', 'typescript', 'java', 'go')",
    )