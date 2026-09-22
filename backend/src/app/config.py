from pydantic import ValidationInfo, field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = {"env_file": ".env", "extra": "ignore"}

    environment: str = "development"  # development | test | production
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/postgres"
    redis_url: str = "redis://localhost:6379"
    jwt_secret_key: str = "dev-secret-key-change-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24  # 24 hours
    cors_origins: list[str] = ["http://localhost:5173"]

    # Evaluation pipeline
    llm_provider: str = "demo"  # default provider: demo | openai | anthropic
    evaluation_timeout: int = 30  # seconds for test execution
    evaluation_dir: str = "/tmp/evaluations"

    # Docker sandbox (isolated code execution)
    docker_enabled: bool = True  # master switch; falls back to subprocess when off/unavailable
    docker_image: str = "eval-sandbox:latest"  # pytest pre-installed sandbox image
    docker_memory_limit: str = "128m"  # per-container RAM limit
    docker_cpu_limit: float = 0.5  # per-container CPU limit (fraction of a core)
    docker_timeout: int = 30  # seconds before container execution is killed
    docker_network_disabled: bool = True  # air-gapped sandboxes
    docker_readonly_rootfs: bool = True  # immutable container filesystem
    docker_max_output_bytes: int = 65536  # cap on captured logs per evaluation

    # Rate limiting (fixed-window counter backed by Redis)
    rate_limit_enabled: bool = True
    rate_limit_anonymous_limit: int = 60  # requests per window for anonymous clients
    rate_limit_authenticated_limit: int = 120  # requests per window for logged-in users
    rate_limit_window_seconds: int = 60

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

    @field_validator("jwt_secret_key")
    @classmethod
    def reject_default_secret_in_production(
        cls, value: str, info: ValidationInfo
    ) -> str:
        """Refuse to boot in production with the well-known dev secret."""
        if (
            info.data.get("environment") == "production"
            and value == "dev-secret-key-change-in-production"
        ):
            raise ValueError(
                "JWT_SECRET_KEY must be changed from the default in production"
            )
        return value


settings = Settings()
