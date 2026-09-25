from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

LANGUAGES = frozenset({"python", "javascript", "typescript", "java", "go"})
DIFFICULTIES = frozenset({"easy", "medium", "hard"})


def _validate_difficulty(value: str) -> str:
    if value not in DIFFICULTIES:
        raise ValueError(f"Unsupported difficulty '{value}' — supported: {sorted(DIFFICULTIES)}")
    return value


class ChallengeCreate(BaseModel):
    """Payload for creating a challenge."""

    title: str = Field(min_length=1, max_length=255)
    description: str = Field(min_length=1)
    prompt: str = Field(min_length=1)
    test_code: str = ""
    language: str = Field(default="python")
    difficulty: str = Field(default="medium")

    @field_validator("language")
    @classmethod
    def validate_language(cls, value: str) -> str:
        if value not in LANGUAGES:
            raise ValueError(f"Unsupported language '{value}' — supported: {sorted(LANGUAGES)}")
        return value

    @field_validator("difficulty")
    @classmethod
    def validate_difficulty(cls, value: str) -> str:
        return _validate_difficulty(value)


class ChallengeUpdate(BaseModel):
    """Payload for updating a challenge (all fields optional, at least one required)."""

    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, min_length=1)
    prompt: str | None = Field(default=None, min_length=1)
    test_code: str | None = None
    language: str | None = Field(default=None)
    difficulty: str | None = Field(default=None)

    @field_validator("language")
    @classmethod
    def validate_language(cls, value: str | None) -> str | None:
        if value is not None and value not in LANGUAGES:
            raise ValueError(f"Unsupported language '{value}' — supported: {sorted(LANGUAGES)}")
        return value

    @field_validator("difficulty")
    @classmethod
    def validate_difficulty(cls, value: str | None) -> str | None:
        if value is not None:
            return _validate_difficulty(value)
        return value


class ChallengeRead(BaseModel):
    """Public challenge representation."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    description: str
    prompt: str
    test_code: str
    language: str
    difficulty: str
    owner_id: UUID = Field(validation_alias="user_id")
    created_at: datetime
    updated_at: datetime
