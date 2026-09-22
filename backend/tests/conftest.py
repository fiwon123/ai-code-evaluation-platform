from collections.abc import AsyncGenerator
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

from app.core.database import Base


@pytest.fixture(autouse=True)
def _disable_docker_sandbox(monkeypatch):
    """Default tests to the subprocess evaluation path.

    Docker sandboxing needs a daemon and the ``eval-sandbox`` image, neither
    of which is guaranteed in CI. Tests that exercise the Docker path enable
    it explicitly with ``monkeypatch``/mocked clients.
    """
    from app.config import settings

    monkeypatch.setattr(settings, "docker_enabled", False)
    yield


@pytest.fixture
def mock_db_session() -> AsyncMock:
    """Mock database session for tests that don't need a real DB."""
    session = AsyncMock()
    session.execute = AsyncMock()
    return session


@pytest.fixture
def mock_redis_client() -> AsyncMock:
    """Mock Redis client for tests that don't need a real Redis."""
    redis = AsyncMock()
    redis.ping = AsyncMock(return_value=True)
    return redis


@pytest_asyncio.fixture
async def client(
    mock_db_session: AsyncMock, mock_redis_client: AsyncMock
) -> AsyncGenerator[AsyncClient]:
    """Async test client with mocked database and Redis dependencies."""
    from app.core.database import get_session
    from app.core.redis import get_redis
    from app.main import create_app

    app = create_app()

    async def override_get_session() -> AsyncGenerator[AsyncMock]:
        yield mock_db_session

    async def override_get_redis() -> AsyncMock:
        return mock_redis_client

    app.dependency_overrides[get_session] = override_get_session
    app.dependency_overrides[get_redis] = override_get_redis

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture
async def db_sessionmaker():
    """In-memory SQLite sessionmaker shared by the db_client fixture."""

    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    sm = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    yield sm
    await engine.dispose()


@pytest_asyncio.fixture
async def db_client(db_sessionmaker) -> AsyncGenerator[AsyncClient]:
    """Async test client against an in-memory SQLite database (fresh per test)."""
    from app.core.database import get_session
    from app.core.redis import get_redis
    from app.main import create_app

    app = create_app()

    async def override_get_session() -> AsyncGenerator[AsyncSession]:
        async with db_sessionmaker() as session:
            yield session

    async def override_get_redis() -> AsyncMock:
        redis = AsyncMock()
        redis.ping = AsyncMock(return_value=True)
        redis.incr = AsyncMock(return_value=1)
        redis.expire = AsyncMock(return_value=True)
        return redis

    app.dependency_overrides[get_session] = override_get_session
    app.dependency_overrides[get_redis] = override_get_redis

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
