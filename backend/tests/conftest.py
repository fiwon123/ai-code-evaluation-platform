from collections.abc import AsyncGenerator
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient


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
