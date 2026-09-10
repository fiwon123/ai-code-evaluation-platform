import uuid

import pytest
from httpx import AsyncClient

SUBMISSIONS_URL = "/api/submissions"
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


async def create_challenge(client: AsyncClient, token: str) -> dict:
    response = await client.post(
        CHALLENGES_URL,
        json={
            "title": "Two Sum",
            "description": "Find two numbers that add up to a target.",
            "prompt": "Write two_sum(nums, target).",
            "test_code": "def test_two_sum():\n    assert two_sum([2, 7, 11, 15], 9) == [0, 1]",
        },
        headers=auth(token),
    )
    assert response.status_code == 201
    return response.json()


async def create_submission(
    client: AsyncClient, token: str, challenge_id: str, **overrides
) -> dict:
    response = await client.post(
        SUBMISSIONS_URL,
        json={"challenge_id": challenge_id, **overrides},
        headers=auth(token),
    )
    assert response.status_code == 201
    return response.json()


@pytest.mark.asyncio
async def test_create_submission_requires_auth(db_client: AsyncClient) -> None:
    response = await db_client.post(
        SUBMISSIONS_URL,
        json={"challenge_id": str(uuid.uuid4())},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_create_submission_unknown_challenge(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    response = await db_client.post(
        SUBMISSIONS_URL,
        json={"challenge_id": str(uuid.uuid4())},
        headers=auth(token),
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_create_submission_success(db_client: AsyncClient) -> None:
    token, user = await register_user(db_client)
    challenge = await create_challenge(db_client, token)

    submission = await create_submission(db_client, token, challenge["id"])

    assert submission["status"] == "pending"
    assert submission["user_id"] == user["id"]
    assert submission["challenge_id"] == challenge["id"]
    assert submission["provider"] is None
    assert submission["code"] is None
    assert submission["evaluation_result"] is None


@pytest.mark.asyncio
async def test_create_submission_with_provider(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    challenge = await create_challenge(db_client, token)

    submission = await create_submission(db_client, token, challenge["id"], provider="demo")

    assert submission["provider"] == "demo"


@pytest.mark.asyncio
async def test_list_submissions_requires_auth(db_client: AsyncClient) -> None:
    response = await db_client.get(SUBMISSIONS_URL)
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_list_submissions_empty(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    response = await db_client.get(SUBMISSIONS_URL, headers=auth(token))
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
async def test_list_submissions_shows_own_only(db_client: AsyncClient) -> None:
    token_a, _ = await register_user(db_client)
    challenge_a = await create_challenge(db_client, token_a)
    await create_submission(db_client, token_a, challenge_a["id"])

    token_b, _ = await register_user(db_client)
    response_b = await db_client.get(SUBMISSIONS_URL, headers=auth(token_b))
    assert response_b.status_code == 200
    assert response_b.json() == []

    response_a = await db_client.get(SUBMISSIONS_URL, headers=auth(token_a))
    assert response_a.status_code == 200
    assert len(response_a.json()) == 1


@pytest.mark.asyncio
async def test_get_submission_owner(db_client: AsyncClient) -> None:
    token, user = await register_user(db_client)
    challenge = await create_challenge(db_client, token)
    submission = await create_submission(db_client, token, challenge["id"])

    response = await db_client.get(
        f"{SUBMISSIONS_URL}/{submission['id']}", headers=auth(token)
    )
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == submission["id"]
    assert body["user_id"] == user["id"]


@pytest.mark.asyncio
async def test_get_submission_forbidden_for_other_user(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    challenge = await create_challenge(db_client, token)
    submission = await create_submission(db_client, token, challenge["id"])

    other_token, _ = await register_user(db_client)
    response = await db_client.get(
        f"{SUBMISSIONS_URL}/{submission['id']}", headers=auth(other_token)
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_get_submission_not_found(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    response = await db_client.get(
        f"{SUBMISSIONS_URL}/{uuid.uuid4()}", headers=auth(token)
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_update_submission_status(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    challenge = await create_challenge(db_client, token)
    submission = await create_submission(db_client, token, challenge["id"])

    response = await db_client.patch(
        f"{SUBMISSIONS_URL}/{submission['id']}",
        json={"status": "processing"},
        headers=auth(token),
    )
    assert response.status_code == 200
    assert response.json()["status"] == "processing"


@pytest.mark.asyncio
async def test_update_submission_status_invalid(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    challenge = await create_challenge(db_client, token)
    submission = await create_submission(db_client, token, challenge["id"])

    response = await db_client.patch(
        f"{SUBMISSIONS_URL}/{submission['id']}",
        json={"status": "bogus"},
        headers=auth(token),
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_update_submission_status_forbidden_for_other_user(
    db_client: AsyncClient,
) -> None:
    token, _ = await register_user(db_client)
    challenge = await create_challenge(db_client, token)
    submission = await create_submission(db_client, token, challenge["id"])

    other_token, _ = await register_user(db_client)
    response = await db_client.patch(
        f"{SUBMISSIONS_URL}/{submission['id']}",
        json={"status": "completed"},
        headers=auth(other_token),
    )
    assert response.status_code == 404
