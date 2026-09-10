from pydantic import field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = {"env_file": ".env", "extra": "ignore"}

    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/postgres"
    redis_url: str = "redis://localhost:6379"
    jwt_secret_key: str = "dev-secret-key-change-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24  # 24 hours
    cors_origins: list[str] = ["http://localhost:5173"]

    @field_validator("database_url")
    @classmethod
    def ensure_psycopg_driver(cls, value: str) -> str:
        """Normalize legacy/bare postgres URLs to use the psycopg (v3) driver."""
        if value.startswith("postgresql+asyncpg://"):
            return value.replace("postgresql+asyncpg://", "postgresql+psycopg://", 1)
        if value.startswith("postgres://"):
            return value.replace("postgres://", "postgresql+psycopg://", 1)
        if value.startswith("postgresql://"):
            return value.replace("postgresql://", "postgresql+psycopg://", 1)
        return value


settings = Settings()
