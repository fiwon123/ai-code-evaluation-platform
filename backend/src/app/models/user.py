from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from app.models.challenge import Challenge
    from app.models.submission import Submission


class User(UUIDMixin, TimestampMixin, Base):
    """Platform user account.

    Users authenticate either with a password (``hashed_password``) or via an
    OAuth provider (``oauth_provider`` + ``oauth_id``). Password-login users
    leave the OAuth columns NULL; OAuth-only users have a NULL password hash.
    """

    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint(
            "oauth_provider",
            "oauth_id",
            name="uq_users_oauth_provider_id",
        ),
    )

    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    hashed_password: Mapped[str | None] = mapped_column(String(255), nullable=True)
    oauth_provider: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    oauth_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")

    challenges: Mapped[list[Challenge]] = relationship(
        back_populates="owner",
        cascade="all, delete-orphan",
    )
    submissions: Mapped[list[Submission]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )
