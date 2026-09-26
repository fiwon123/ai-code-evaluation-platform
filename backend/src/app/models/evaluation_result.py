from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy import JSON, ForeignKey, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from app.models.submission import Submission


class EvaluationResult(UUIDMixin, TimestampMixin, Base):
    """Result of running the test suite against a submission's generated code."""

    __tablename__ = "evaluation_results"

    submission_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("submissions.id", ondelete="CASCADE"),
        unique=True,
        index=True,
    )
    passed_tests: Mapped[int] = mapped_column(default=0)
    total_tests: Mapped[int] = mapped_column(default=0)
    score: Mapped[float] = mapped_column(default=0.0)
    logs: Mapped[str] = mapped_column(Text, default="")
    #: Readable digest of ``logs`` — which tests failed and why. Copied from
    #: the final attempt so the report shows the signal before the raw dump.
    logs_summary: Mapped[str] = mapped_column(Text, default="")
    metrics: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    #: Per-test-case breakdown: ``[{name, passed, message}]``.
    test_results: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON, default=list)
    #: Unguessable public share token; ``None`` until the owner opts in.
    share_token: Mapped[str | None] = mapped_column(
        String(64), unique=True, nullable=True, default=None
    )

    submission: Mapped[Submission] = relationship(back_populates="evaluation_result")
