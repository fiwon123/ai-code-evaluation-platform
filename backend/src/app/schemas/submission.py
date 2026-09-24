from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

# Providers that require an API key to generate code. Mirrors the UI provider
# list in frontend/src/pages/ChallengeDetail.tsx (requiresKey) — keep in sync.
KEY_REQUIRED_PROVIDERS = frozenset({"openai", "anthropic"})


class SubmissionCreate(BaseModel):
    """Payload for creating an evaluation submission."""

    challenge_id: UUID
    provider: str | None = Field(default=None, max_length=50)
    api_key: str | None = Field(
        default=None,
        max_length=500,
        description=(
            "Per-run LLM API key. Used only for this submission's code "
            "generation and never stored, returned, or logged."
        ),
    )

    @model_validator(mode="after")
    def require_api_key_for_keyed_providers(self):
        if self.provider in KEY_REQUIRED_PROVIDERS and not self.api_key:
            raise ValueError(
                f"An API key is required for provider '{self.provider}'"
            )
        return self


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
