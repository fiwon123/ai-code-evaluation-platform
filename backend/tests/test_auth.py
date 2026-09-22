import uuid

import pytest
from httpx import AsyncClient

REGISTER_URL = "/api/auth/register"
LOGIN_URL = "/api/auth/login"
ME_URL = "/api/auth/me"
CHANGE_PASSWORD_URL = "/api/auth/change-password"


async def create_user(client: AsyncClient, **overrides) -> dict:
    """Register a user and return the response JSON."""
    payload = {
        "email": f"{uuid.uuid4().hex[:10]}@example.com",
        "username": f"user_{uuid.uuid4().hex[:8]}",
        "password": "password123",
        **overrides,
    }
    response = await client.post(REGISTER_URL, json=payload)
    assert response.status_code == 201
    return response.json()


@pytest.mark.asyncio
async def test_register_success(db_client: AsyncClient) -> None:
    data = await create_user(db_client)
    assert data["token_type"] == "bearer"
    assert data["access_token"]
    assert data["user"]["email"]
    assert data["user"]["username"]
    assert "id" in data["user"]
    assert "hashed_password" not in data["user"]


@pytest.mark.asyncio
async def test_register_duplicate_email(db_client: AsyncClient) -> None:
    data = await create_user(db_client)
    response = await db_client.post(
        REGISTER_URL,
        json={
            "email": data["user"]["email"],
            "username": f"another_{uuid.uuid4().hex[:8]}",
            "password": "password123",
        },
    )
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_register_duplicate_username(db_client: AsyncClient) -> None:
    data = await create_user(db_client)
    response = await db_client.post(
        REGISTER_URL,
        json={
            "email": f"{uuid.uuid4().hex[:10]}@example.com",
            "username": data["user"]["username"],
            "password": "password123",
        },
    )
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_register_short_password_rejected(db_client: AsyncClient) -> None:
    response = await db_client.post(
        REGISTER_URL,
        json={
            "email": f"{uuid.uuid4().hex[:10]}@example.com",
            "username": f"user_{uuid.uuid4().hex[:8]}",
            "password": "short",
        },
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_login_success_by_email(db_client: AsyncClient) -> None:
    created = await create_user(db_client)
    response = await db_client.post(
        LOGIN_URL,
        json={
            "identifier": created["user"]["email"],
            "password": "password123",
        },
    )
    assert response.status_code == 200
    assert response.json()["access_token"]


@pytest.mark.asyncio
async def test_login_success_by_username(db_client: AsyncClient) -> None:
    created = await create_user(db_client)
    response = await db_client.post(
        LOGIN_URL,
        json={
            "identifier": created["user"]["username"],
            "password": "password123",
        },
    )
    assert response.status_code == 200
    assert response.json()["access_token"]


@pytest.mark.asyncio
async def test_login_wrong_password(db_client: AsyncClient) -> None:
    created = await create_user(db_client)
    response = await db_client.post(
        LOGIN_URL,
        json={
            "identifier": created["user"]["email"],
            "password": "wrongpassword",
        },
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_login_unknown_user(db_client: AsyncClient) -> None:
    response = await db_client.post(
        LOGIN_URL,
        json={"identifier": "ghost@example.com", "password": "password123"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_me_with_token(db_client: AsyncClient) -> None:
    created = await create_user(db_client)
    response = await db_client.get(
        ME_URL,
        headers={"Authorization": f"Bearer {created['access_token']}"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == created["user"]["id"]
    assert body["email"] == created["user"]["email"]


@pytest.mark.asyncio
async def test_me_without_token(db_client: AsyncClient) -> None:
    response = await db_client.get(ME_URL)
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_me_invalid_token(db_client: AsyncClient) -> None:
    response = await db_client.get(
        ME_URL,
        headers={"Authorization": "Bearer not-a-real-token"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_change_password_requires_auth(db_client: AsyncClient) -> None:
    response = await db_client.post(
        CHANGE_PASSWORD_URL,
        json={"current_password": "password123", "new_password": "newpassword456"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_change_password_success(db_client: AsyncClient) -> None:
    created = await create_user(db_client)
    headers = {"Authorization": f"Bearer {created['access_token']}"}

    response = await db_client.post(
        CHANGE_PASSWORD_URL,
        json={"current_password": "password123", "new_password": "newpassword456"},
        headers=headers,
    )
    assert response.status_code == 204

    # Old password no longer works; new one does.
    old_login = await db_client.post(
        LOGIN_URL,
        json={"identifier": created["user"]["email"], "password": "password123"},
    )
    assert old_login.status_code == 401

    new_login = await db_client.post(
        LOGIN_URL,
        json={"identifier": created["user"]["email"], "password": "newpassword456"},
    )
    assert new_login.status_code == 200


@pytest.mark.asyncio
async def test_change_password_wrong_current_password(db_client: AsyncClient) -> None:
    created = await create_user(db_client)
    headers = {"Authorization": f"Bearer {created['access_token']}"}

    response = await db_client.post(
        CHANGE_PASSWORD_URL,
        json={"current_password": "wrongpassword", "new_password": "newpassword456"},
        headers=headers,
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Current password is incorrect"


@pytest.mark.asyncio
async def test_change_password_weak_new_password(db_client: AsyncClient) -> None:
    created = await create_user(db_client)
    headers = {"Authorization": f"Bearer {created['access_token']}"}

    response = await db_client.post(
        CHANGE_PASSWORD_URL,
        json={"current_password": "password123", "new_password": "short"},
        headers=headers,
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_change_password_keeps_existing_token_valid(db_client: AsyncClient) -> None:
    created = await create_user(db_client)
    headers = {"Authorization": f"Bearer {created['access_token']}"}

    await db_client.post(
        CHANGE_PASSWORD_URL,
        json={"current_password": "password123", "new_password": "newpassword456"},
        headers=headers,
    )

    # The token issued before the password change is still accepted.
    me = await db_client.get(ME_URL, headers=headers)
    assert me.status_code == 200
