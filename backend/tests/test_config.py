"""Settings validation tests (database URL normalization + secret guard)."""

import pytest
from pydantic import ValidationError

from app.config import Settings


class TestPsycopgDriverNormalization:
    def test_asyncpg_url_converted(self):
        settings = Settings(database_url="postgresql+asyncpg://u:p@localhost/db")
        assert settings.database_url.startswith("postgresql+psycopg://")

    def test_bare_postgres_url_converted(self):
        settings = Settings(database_url="postgres://u:p@localhost/db")
        assert settings.database_url.startswith("postgresql+psycopg://")

    def test_postgresql_url_converted(self):
        settings = Settings(database_url="postgresql://u:p@localhost/db")
        assert settings.database_url.startswith("postgresql+psycopg://")

    def test_psycopg_url_unchanged(self):
        url = "postgresql+psycopg://u:p@localhost/db"
        settings = Settings(database_url=url)
        assert settings.database_url == url


class TestProductionSecretGuard:
    def test_development_allows_default_secret(self):
        settings = Settings(environment="development")
        assert settings.jwt_secret_key == "dev-secret-key-change-in-production"

    def test_production_rejects_default_secret(self):
        with pytest.raises(ValidationError, match="JWT_SECRET_KEY"):
            Settings(environment="production")

    def test_production_accepts_custom_secret(self):
        settings = Settings(environment="production", jwt_secret_key="correct-horse-battery-staple")
        assert settings.jwt_secret_key == "correct-horse-battery-staple"

    def test_test_environment_accepts_default_secret(self):
        settings = Settings(environment="test")
        assert settings.jwt_secret_key == "dev-secret-key-change-in-production"
