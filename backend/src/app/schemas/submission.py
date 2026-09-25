from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

# Providers that require an API key to generate code. Mirrors the UI provider
# list in frontend/src/pages/ChallengeDetail.tsx (requiresKey) and the env-var
# mapping in app/services/llm.py (KEYED_PROVIDERS) — keep all three in sync.
KEY_REQUIRED_PROVIDERS = frozenset({"openai", "anthropic", "gemini"})


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
            raise ValueError(f"An API key is required for provider '{self.provider}'")
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
    #: Per-test-case breakdown returned when the runner produced one.
    test_results: list[dict[str, Any]] | None = None
    #: Public share token — visible only to the owner (submission reads are
    #: owner-scoped) so the dashboard can show shared state.
    share_token: str | None = None
    created_at: datetime


class ProviderComparisonEntry(BaseModel):
    """Aggregated evaluation stats for one provider on a challenge."""

    provider: str
    runs: int
    score: float
    passed_tests: float
    total_tests: float
    duration_ms: float
    last_run_at: datetime


class ProviderComparisonRead(BaseModel):
    """Per-provider comparison of the current user's evaluations."""

    challenge_id: UUID
    entries: list[ProviderComparisonEntry]


class ShareResultRead(BaseModel):
    """Share token for a completed evaluation report."""

    share_token: str


class SharedResultRead(BaseModel):
    """Public, unauthenticated view of a shared evaluation report.

    Includes just enough challenge context for a viewer to understand what
    was evaluated, plus the full report (code, tests, metrics). Never
    includes the sharing user's identity or the raw submission record.
    """

    challenge_id: UUID
    challenge_title: str
    challenge_prompt: str
    language: str
    provider: str
    status: str
    created_at: datetime
    code: str | None
    score: float
    passed_tests: int
    total_tests: int
    logs: str
    metrics: dict[str, Any]
    test_results: list[dict[str, Any]] | None = None


class ChallengeStatsItem(BaseModel):
    """Per-challenge evaluation stats for the current user."""

    challenge_id: UUID
    challenge_title: str
    language: str
    total_runs: int
    completed_runs: int
    failed_runs: int
    avg_score: float | None
    best_score: float | None
    last_run_at: datetime


class SubmissionStatsRead(BaseModel):
    """The user's evaluation history grouped by challenge."""

    items: list[ChallengeStatsItem]


class SubmissionRead(BaseModel):
    """Submission representation with optional nested evaluation result."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    challenge_id: UUID
    status: str
    #: Pipeline phase while processing: ``"generating"`` or ``"testing"``;
    #: None when pending or terminal.
    phase: str | None = None
    #: When evaluation began (status → processing); None while queued.
    started_at: datetime | None = None
    provider: str | None
    language: str | None
    code: str | None
    score: float | None
    created_at: datetime
    updated_at: datetime
    evaluation_result: EvaluationResultRead | None = None


class AdminSubmissionRead(SubmissionRead):
    """Admin submission view — SubmissionRead plus the owner's username and
    the challenge title (resolved via joins in the admin router)."""

    username: str
    challenge_title: str
