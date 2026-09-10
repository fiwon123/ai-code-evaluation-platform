from pydantic import field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = {"env_file": ".env", "extra": "ignore"}

    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/postgres"
    redis_url: str = "redis://localhost:6379"
    jwt_secret_key: str = "dev-secret-key-change-in-production"

    @field_validator("database_url")
    @classmethod
    def ensure_psycopg_driver(cls, value: str) -> str:
        """Normalize bare postgres:// URLs to use the psycopg (v3) driver."""
        if value.startswith("postgres://"):
            return value.replace("postgres://", "postgresql+psycopg://", 1)
        if value.startswith("postgresql://"):
            return value.replace("postgresql://", "postgresql+psycopg://", 1)
        return value


settings = Settings()
