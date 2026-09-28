"""add evaluation_attempts table and logs_summary to evaluation_results

Revision ID: b3c4d5e6f7a8
Revises: a2b3c4d5e6f7
Create Date: 2026-09-26 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b3c4d5e6f7a8'
down_revision: Union[str, Sequence[str], None] = 'a2b3c4d5e6f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Record every generate-and-test attempt, not just the final outcome."""
    op.add_column(
        'evaluation_results',
        sa.Column('logs_summary', sa.Text(), nullable=False, server_default=''),
    )
    op.create_table(
        'evaluation_attempts',
        sa.Column('submission_id', sa.Uuid(), nullable=False),
        sa.Column('attempt_number', sa.Integer(), nullable=False),
        sa.Column('code', sa.Text(), nullable=False),
        sa.Column('passed_tests', sa.Integer(), nullable=False),
        sa.Column('total_tests', sa.Integer(), nullable=False),
        sa.Column('score', sa.Float(), nullable=False),
        sa.Column('logs', sa.Text(), nullable=False),
        sa.Column('logs_summary', sa.Text(), nullable=False),
        sa.Column('metrics', sa.JSON(), nullable=False),
        sa.Column('test_results', sa.JSON(), nullable=False),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ['submission_id'],
            ['submissions.id'],
            name=op.f('fk_evaluation_attempts_submission_id_submissions'),
            ondelete='CASCADE',
        ),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_evaluation_attempts')),
        # Makes a duplicate dispatch for an attempt that already ran a no-op.
        sa.UniqueConstraint(
            'submission_id',
            'attempt_number',
            name='uq_evaluation_attempts_submission_attempt',
        ),
    )
    op.create_index(
        op.f('ix_evaluation_attempts_submission_id'),
        'evaluation_attempts',
        ['submission_id'],
        unique=False,
    )


def downgrade() -> None:
    """Drop the attempt history and the readable summary."""
    op.drop_index(
        op.f('ix_evaluation_attempts_submission_id'),
        table_name='evaluation_attempts',
    )
    op.drop_table('evaluation_attempts')
    op.drop_column('evaluation_results', 'logs_summary')
