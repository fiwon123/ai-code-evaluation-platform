from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from app.models.challenge import Challenge
    from app.models.evaluation_result import EvaluationResult
    from app.models.user import User


class Submission(UUIDMixin, TimestampMixin, Base):
    """A code generation attempt for a challenge, initiated by a user."""

    __tablename__ = "submissions"

    user_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )
    challenge_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("challenges.id", ondelete="CASCADE"),
        index=True,
    )
    status: Mapped[str] = mapped_column(String(20), default="pending")
    provider: Mapped[str | None] = mapped_column(String(50), nullable=True)
    language: Mapped[str | None] = mapped_column(String(50), nullable=True)
    code: Mapped[str | None] = mapped_column(Text, nullable=True)
    score: Mapped[float | None] = mapped_column(nullable=True)
    #: When evaluation began (status → processing); set once, kept on terminal
    #: rows so the UI can show "started at" / true elapsed time.
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    #: Pipeline phase while processing: ``"generating"`` (LLM call in flight)
    #: or ``"testing"`` (code generated, tests running). NULL when pending or
    #: terminal — the worker clears it on completion/failure.
    phase: Mapped[str | None] = mapped_column(String(20), nullable=True)

    user: Mapped[User] = relationship(back_populates="submissions")
    challenge: Mapped[Challenge] = relationship(back_populates="submissions")
    evaluation_result: Mapped[EvaluationResult | None] = relationship(
        back_populates="submission",
        uselist=False,
        cascade="all, delete-orphan",
    )
