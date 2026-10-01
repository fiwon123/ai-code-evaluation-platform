from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from app.models.challenge import Challenge
    from app.models.evaluation_attempt import EvaluationAttempt
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
    #: Catalog model id used for generation (see app/services/llm_models.py).
    #: NULL/absent on rows created before the column existed.
    model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    language: Mapped[str | None] = mapped_column(String(50), nullable=True)
    code: Mapped[str | None] = mapped_column(Text, nullable=True)
    score: Mapped[float | None] = mapped_column(nullable=True)
    #: When evaluation began (status → processing); set once, kept on terminal
    #: rows so the UI can show "started at" / true elapsed time.
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    #: Pipeline phase while processing: ``"generating"`` (LLM call in flight),
    #: ``"testing"`` (code generated, tests running) or ``"repairing"`` (a
    #: failed attempt is being fed back for another try). NULL when pending or
    #: terminal — the worker clears it on completion/failure.
    phase: Mapped[str | None] = mapped_column(String(20), nullable=True)

    user: Mapped[User] = relationship(back_populates="submissions")
    challenge: Mapped[Challenge] = relationship(back_populates="submissions")
    evaluation_result: Mapped[EvaluationResult | None] = relationship(
        back_populates="submission",
        uselist=False,
        cascade="all, delete-orphan",
    )
    attempts: Mapped[list[EvaluationAttempt]] = relationship(
        back_populates="submission",
        cascade="all, delete-orphan",
        order_by="EvaluationAttempt.attempt_number",
    )

    @property
    def challenge_title(self) -> str:
        """The parent challenge's title, so reads can name a submission.

        The FK is NOT NULL and cascades, so a surviving submission always has
        a challenge and this never returns None — a list of submissions can be
        labelled without a second round trip per row.

        Reading it touches :attr:`challenge`, so every query that serialises a
        ``SubmissionRead`` must ``selectinload`` that relationship. An
        AsyncSession cannot lazy-load on access and would raise MissingGreenlet
        rather than quietly return a placeholder, which is the intent: a
        missing eager load is a bug, not a degraded title.
        """
        return self.challenge.title
