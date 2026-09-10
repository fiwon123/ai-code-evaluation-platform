import uuid

import pytest
from httpx import AsyncClient

CHALLENGES_URL = "/api/challenges"


async def register_user(client: AsyncClient) -> tuple[str, dict]:
    """Register a user and return (token, user)."""
    payload = {
        "email": f"{uuid.uuid4().hex[:10]}@example.com",
        "username": f"user_{uuid.uuid4().hex[:8]}",
        "password": "password123",
    }
    response = await client.post("/api/auth/register", json=payload)
    assert response.status_code == 201
    body = response.json()
    return body["access_token"], body["user"]


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def create_challenge(client: AsyncClient, token: str, **overrides) -> dict:
    payload = {
        "title": "Two Sum",
        "description": "Find two numbers that add up to a target.",
        "prompt": "Write a function two_sum(nums, target) that returns indices.",
        "test_code": "def test_two_sum():\n    assert two_sum([2, 7, 11, 15], 9) == [0, 1]",
        "language": "python",
        **overrides,
    }
    response = await client.post(CHALLENGES_URL, json=payload, headers=auth(token))
    assert response.status_code == 201
    return response.json()


@pytest.mark.asyncio
async def test_list_challenges_empty(db_client: AsyncClient) -> None:
    response = await db_client.get(CHALLENGES_URL)
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
async def test_create_challenge_requires_auth(db_client: AsyncClient) -> None:
    response = await db_client.post(
        CHALLENGES_URL,
        json={"title": "t", "description": "d", "prompt": "p"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_create_challenge_success(db_client: AsyncClient) -> None:
    token, user = await register_user(db_client)
    challenge = await create_challenge(db_client, token)

    assert challenge["title"] == "Two Sum"
    assert challenge["language"] == "python"
    assert challenge["owner_id"] == user["id"]
    assert challenge["test_code"]


@pytest.mark.asyncio
async def test_get_challenge(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    created = await create_challenge(db_client, token)

    response = await db_client.get(f"{CHALLENGES_URL}/{created['id']}")
    assert response.status_code == 200
    assert response.json()["id"] == created["id"]


@pytest.mark.asyncio
async def test_get_challenge_not_found(db_client: AsyncClient) -> None:
    response = await db_client.get(f"{CHALLENGES_URL}/{uuid.uuid4()}")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_list_challenges_shows_created(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    await create_challenge(db_client, token, title="Alpha")

    response = await db_client.get(CHALLENGES_URL)
    body = response.json()
    assert len(body) == 1
    assert body[0]["title"] == "Alpha"


@pytest.mark.asyncio
async def test_update_challenge_owner(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    created = await create_challenge(db_client, token)

    response = await db_client.patch(
        f"{CHALLENGES_URL}/{created['id']}",
        json={"title": "Three Sum"},
        headers=auth(token),
    )
    assert response.status_code == 200
    assert response.json()["title"] == "Three Sum"
    assert response.json()["prompt"] == created["prompt"]  # unchanged


@pytest.mark.asyncio
async def test_update_challenge_forbidden_for_non_owner(db_client: AsyncClient) -> None:
    owner_token, _ = await register_user(db_client)
    created = await create_challenge(db_client, owner_token)

    other_token, _ = await register_user(db_client)
    response = await db_client.patch(
        f"{CHALLENGES_URL}/{created['id']}",
        json={"title": "Hijacked"},
        headers=auth(other_token),
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_update_challenge_empty_payload_rejected(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    created = await create_challenge(db_client, token)

    response = await db_client.patch(
        f"{CHALLENGES_URL}/{created['id']}",
        json={},
        headers=auth(token),
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_delete_challenge_owner(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    created = await create_challenge(db_client, token)

    response = await db_client.delete(
        f"{CHALLENGES_URL}/{created['id']}", headers=auth(token)
    )
    assert response.status_code == 204

    gone = await db_client.get(f"{CHALLENGES_URL}/{created['id']}")
    assert gone.status_code == 404


@pytest.mark.asyncio
async def test_delete_challenge_forbidden_for_non_owner(db_client: AsyncClient) -> None:
    owner_token, _ = await register_user(db_client)
    created = await create_challenge(db_client, owner_token)

    other_token, _ = await register_user(db_client)
    response = await db_client.delete(
        f"{CHALLENGES_URL}/{created['id']}", headers=auth(other_token)
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_delete_challenge_requires_auth(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    created = await create_challenge(db_client, token)

    response = await db_client.delete(f"{CHALLENGES_URL}/{created['id']}")
    assert response.status_code == 401
