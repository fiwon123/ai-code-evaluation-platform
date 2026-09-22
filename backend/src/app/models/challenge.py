from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import CheckConstraint, ForeignKey, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from app.models.submission import Submission
    from app.models.user import User


class Challenge(UUIDMixin, TimestampMixin, Base):
    """A coding challenge with a prompt for the LLM and a test suite."""

    __tablename__ = "challenges"

    user_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text)
    prompt: Mapped[str] = mapped_column(Text)
    test_code: Mapped[str] = mapped_column(Text, default="")
    language: Mapped[str] = mapped_column(String(50), default="python")

    __table_args__ = (
        CheckConstraint(
            "language IN ('python', 'javascript', 'typescript', 'java', 'go')",
            name="ck_challenges_language_supported",
        ),
    )

    owner: Mapped[User] = relationship(back_populates="challenges")
    submissions: Mapped[list[Submission]] = relationship(
        back_populates="challenge",
        cascade="all, delete-orphan",
    )
