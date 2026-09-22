import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_health_returns_200(client: AsyncClient) -> None:
    response = await client.get("/health")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_health_includes_status(client: AsyncClient) -> None:
    response = await client.get("/health")
    data = response.json()
    assert "status" in data


@pytest.mark.asyncio
async def test_health_status_value(client: AsyncClient) -> None:
    response = await client.get("/health")
    data = response.json()
    assert data["status"] in ("ok", "degraded")


@pytest.mark.asyncio
async def test_health_reports_db_and_redis(client: AsyncClient) -> None:
    response = await client.get("/health")
    data = response.json()
    assert "db" in data
    assert "redis" in data


@pytest.mark.asyncio
async def test_health_reports_celery(client: AsyncClient) -> None:
    response = await client.get("/health")
    data = response.json()
    assert "celery" in data
    assert data["celery"] in ("ok", "unreachable")
