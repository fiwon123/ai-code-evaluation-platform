from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from app.models.challenge import Challenge
    from app.models.submission import Submission


class User(UUIDMixin, TimestampMixin, Base):
    """Platform user account."""

    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
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
