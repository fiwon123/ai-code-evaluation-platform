"""add share_token to evaluation_results

Revision ID: f7a8b9c0d1e2
Revises: e5f6a7b8c9d0
Create Date: 2026-09-24 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f7a8b9c0d1e2'
down_revision: Union[str, Sequence[str], None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'evaluation_results',
        sa.Column('share_token', sa.String(length=64), nullable=True),
    )
    op.create_unique_constraint(
        'uq_evaluation_results_share_token',
        'evaluation_results',
        ['share_token'],
    )


def downgrade() -> None:
    op.drop_constraint(
        'uq_evaluation_results_share_token',
        'evaluation_results',
        type_='unique',
    )
    op.drop_column('evaluation_results', 'share_token')