from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class SubmissionCreate(BaseModel):
    """Payload for creating an evaluation submission."""

    challenge_id: UUID
    provider: str | None = Field(default=None, max_length=50)


class SubmissionUpdate(BaseModel):
    """Payload for updating a submission's status."""

    status: Literal["pending", "processing", "completed", "failed"]


class EvaluationResultRead(BaseModel):
    """Nested evaluation result attached to a submission."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    passed_tests: int
    total_tests: int
    score: float
    logs: str
    metrics: dict[str, Any]
    created_at: datetime


class SubmissionRead(BaseModel):
    """Submission representation with optional nested evaluation result."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    challenge_id: UUID
    status: str
    provider: str | None
    language: str | None
    code: str | None
    score: float | None
    created_at: datetime
    updated_at: datetime
    evaluation_result: EvaluationResultRead | None = None
