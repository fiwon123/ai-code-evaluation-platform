from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy import JSON, ForeignKey, Integer, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from app.models.submission import Submission


class EvaluationAttempt(UUIDMixin, TimestampMixin, Base):
    """One generate-and-test attempt of a submission's code.

    The submission's :class:`~app.models.evaluation_result.EvaluationResult`
    holds the outcome of the *last* attempt. This table keeps every attempt so
    a repair loop's progress is visible, and so a regression (a later attempt
    scoring worse than an earlier one) is still inspectable.

    ``(submission_id, attempt_number)`` is unique: a duplicate Celery dispatch
    for an attempt that already ran loses the insert and is a no-op, which is
    what keeps a re-sent message from double-billing the LLM provider.
    """

    __tablename__ = "evaluation_attempts"
    __table_args__ = (
        UniqueConstraint(
            "submission_id",
            "attempt_number",
            name="uq_evaluation_attempts_submission_attempt",
        ),
    )

    submission_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("submissions.id", ondelete="CASCADE"),
        index=True,
    )
    #: 1-based; attempt 1 is the initial generation.
    attempt_number: Mapped[int] = mapped_column(Integer, default=1)
    code: Mapped[str] = mapped_column(Text, default="")
    passed_tests: Mapped[int] = mapped_column(default=0)
    total_tests: Mapped[int] = mapped_column(default=0)
    score: Mapped[float] = mapped_column(default=0.0)
    #: Raw ``stdout + stderr`` from the test runner, as captured.
    logs: Mapped[str] = mapped_column(Text, default="")
    #: Readable digest of ``logs`` — which tests failed and why.
    logs_summary: Mapped[str] = mapped_column(Text, default="")
    metrics: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    #: Per-test-case breakdown: ``[{name, passed, message}]``.
    test_results: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON, default=list)

    submission: Mapped[Submission] = relationship(back_populates="attempts")
