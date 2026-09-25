"""add oauth columns to users

Revision ID: c1d2e3f4a5b6
Revises: b5c6d7e8f9a0
Create Date: 2026-09-25 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c1d2e3f4a5b6'
down_revision: Union[str, Sequence[str], None] = 'b5c6d7e8f9a0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_UNIQUE_CONSTRAINT = 'uq_users_oauth_provider_id'


def upgrade() -> None:
    """Add OAuth identity columns and relax the password requirement.

    ``hashed_password`` becomes nullable so OAuth-only accounts (which never
    hold a password) can be stored without a bogus hash.
    """
    op.add_column('users', sa.Column('oauth_provider', sa.String(length=20), nullable=True))
    op.add_column('users', sa.Column('oauth_id', sa.String(length=255), nullable=True))
    op.add_column('users', sa.Column('avatar_url', sa.String(length=500), nullable=True))
    op.alter_column('users', 'hashed_password', existing_type=sa.String(length=255), nullable=True)
    # Multiple NULLs are allowed in a Postgres unique index, so password-only
    # users (both columns NULL) don't collide with each other.
    op.create_unique_constraint(_UNIQUE_CONSTRAINT, 'users', ['oauth_provider', 'oauth_id'])


def downgrade() -> None:
    """Drop OAuth identity columns and restore a required password hash."""
    op.drop_constraint(_UNIQUE_CONSTRAINT, 'users', type_='unique')
    # Any OAuth-only rows would violate NOT NULL; drop OAuth identities first.
    op.execute("DELETE FROM users WHERE oauth_provider IS NOT NULL")
    op.alter_column('users', 'hashed_password', existing_type=sa.String(length=255), nullable=False)
    op.drop_column('users', 'avatar_url')
    op.drop_column('users', 'oauth_id')
    op.drop_column('users', 'oauth_provider')