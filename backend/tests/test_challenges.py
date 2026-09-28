import uuid
from datetime import UTC

import pytest
from httpx import AsyncClient

from app.services.languages import EXECUTABLE_LANGUAGES

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
    body = response.json()
    assert body["items"] == []
    assert body["total"] == 0
    assert body["page"] == 1
    assert body["page_size"] == 20
    assert body["pages"] == 0


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
    assert body["total"] == 1
    assert len(body["items"]) == 1
    assert body["items"][0]["title"] == "Alpha"


@pytest.mark.asyncio
async def test_list_challenges_pagination_default(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    for i in range(25):
        await create_challenge(db_client, token, title=f"Challenge {i}")

    response = await db_client.get(CHALLENGES_URL)
    body = response.json()
    assert body["total"] == 25
    assert len(body["items"]) == 20  # default page_size
    assert body["page"] == 1
    assert body["pages"] == 2


@pytest.mark.asyncio
async def test_list_challenges_pagination_custom(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    for i in range(5):
        await create_challenge(db_client, token, title=f"Challenge {i}")

    page1 = (await db_client.get(CHALLENGES_URL, params={"page": 1, "page_size": 2})).json()
    page2 = (await db_client.get(CHALLENGES_URL, params={"page": 2, "page_size": 2})).json()
    page3 = (await db_client.get(CHALLENGES_URL, params={"page": 3, "page_size": 2})).json()

    for page in (page1, page2, page3):
        assert page["page_size"] == 2

    assert page1["total"] == page2["total"] == page3["total"] == 5
    assert len(page1["items"]) == 2
    assert len(page2["items"]) == 2
    assert len(page3["items"]) == 1
    assert page1["pages"] == page2["pages"] == page3["pages"] == 3

    # Pages must be disjoint and cover all 5 items.
    ids1 = {c["id"] for c in page1["items"]}
    ids2 = {c["id"] for c in page2["items"]}
    ids3 = {c["id"] for c in page3["items"]}
    assert ids1.isdisjoint(ids2)
    assert ids1.isdisjoint(ids3)
    assert ids2.isdisjoint(ids3)
    assert len(ids1 | ids2 | ids3) == 5


@pytest.mark.asyncio
async def test_list_challenges_page_size_validation(db_client: AsyncClient) -> None:
    response = await db_client.get(CHALLENGES_URL, params={"page_size": 101})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_list_challenges_search_title(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    await create_challenge(db_client, token, title="Two Sum")
    await create_challenge(db_client, token, title="FizzBuzz")
    await create_challenge(db_client, token, title="Fibonacci")

    response = await db_client.get(CHALLENGES_URL, params={"search": "fizz"})
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["title"] == "FizzBuzz"


@pytest.mark.asyncio
async def test_list_challenges_search_description(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    await create_challenge(
        db_client, token, title="Alpha", description="contains palindrome keywords"
    )
    await create_challenge(db_client, token, title="Beta", description="unrelated")

    response = await db_client.get(CHALLENGES_URL, params={"search": "palindrome"})
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["title"] == "Alpha"


@pytest.mark.asyncio
async def test_list_challenges_search_no_match(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    await create_challenge(db_client, token, title="Two Sum")

    response = await db_client.get(CHALLENGES_URL, params={"search": "nothing"})
    body = response.json()
    assert body["total"] == 0
    assert body["items"] == []


@pytest.mark.asyncio
async def test_list_challenges_filter_language(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    await create_challenge(db_client, token, title="Python task", language="python")
    await create_challenge(db_client, token, title="Go task", language="go")
    await create_challenge(db_client, token, title="JS task", language="javascript")

    response = await db_client.get(CHALLENGES_URL, params={"language": "go"})
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["title"] == "Go task"


@pytest.mark.asyncio
async def test_list_challenges_filter_owner(db_client: AsyncClient) -> None:
    token_a, user_a = await register_user(db_client)
    token_b, _ = await register_user(db_client)
    await create_challenge(db_client, token_a, title="Mine")
    await create_challenge(db_client, token_b, title="Theirs")

    response = await db_client.get(CHALLENGES_URL, params={"owner_id": user_a["id"]})
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["title"] == "Mine"


@pytest.mark.asyncio
async def test_list_challenges_combined_filters(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    await create_challenge(db_client, token, title="Two Sum Python", language="python")
    await create_challenge(db_client, token, title="Two Sum Go", language="go")

    response = await db_client.get(
        CHALLENGES_URL,
        params={"search": "Two Sum", "language": "go", "page": 1, "page_size": 10},
    )
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["title"] == "Two Sum Go"


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
async def test_create_challenge_rejects_unsupported_language(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)

    response = await db_client.post(
        CHALLENGES_URL,
        json={
            "title": "Cobol task",
            "description": "Outside the catalog",
            "prompt": "Write cobol code",
            "test_code": "",
            "language": "cobol",
        },
        headers=auth(token),
    )
    assert response.status_code == 422
    assert "Unsupported language 'cobol'" in response.text


@pytest.mark.asyncio
async def test_create_challenge_accepts_display_only_languages(db_client: AsyncClient) -> None:
    """Catalog languages without runtimes are storable (they fail at eval)."""
    token, _ = await register_user(db_client)
    for language in ("csharp", "haskell", "objective-c"):
        challenge = await create_challenge(db_client, token, language=language)
        assert challenge["language"] == language


@pytest.mark.asyncio
async def test_create_challenge_accepts_all_supported_languages(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    for language in EXECUTABLE_LANGUAGES:
        challenge = await create_challenge(db_client, token, language=language)
        assert challenge["language"] == language


@pytest.mark.asyncio
async def test_update_challenge_rejects_unsupported_language(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    created = await create_challenge(db_client, token)

    response = await db_client.patch(
        f"{CHALLENGES_URL}/{created['id']}",
        json={"language": "cobol"},
        headers=auth(token),
    )
    assert response.status_code == 422
    assert "Unsupported language 'cobol'" in response.text


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

    response = await db_client.delete(f"{CHALLENGES_URL}/{created['id']}", headers=auth(token))
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


@pytest.mark.asyncio
async def test_create_challenge_defaults_to_medium_difficulty(
    db_client: AsyncClient,
) -> None:
    token, _ = await register_user(db_client)
    challenge = await create_challenge(db_client, token)

    assert challenge["difficulty"] == "medium"


@pytest.mark.asyncio
async def test_create_challenge_accepts_all_difficulties(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    for difficulty in ("easy", "medium", "hard"):
        challenge = await create_challenge(db_client, token, difficulty=difficulty)
        assert challenge["difficulty"] == difficulty


@pytest.mark.asyncio
async def test_create_challenge_rejects_unsupported_difficulty(
    db_client: AsyncClient,
) -> None:
    token, _ = await register_user(db_client)

    response = await db_client.post(
        CHALLENGES_URL,
        json={
            "title": "Impossible task",
            "description": "No such difficulty",
            "prompt": "Write code",
            "test_code": "",
            "language": "python",
            "difficulty": "nightmare",
        },
        headers=auth(token),
    )
    assert response.status_code == 422
    assert "Unsupported difficulty 'nightmare'" in response.text


@pytest.mark.asyncio
async def test_update_challenge_difficulty(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    created = await create_challenge(db_client, token)

    response = await db_client.patch(
        f"{CHALLENGES_URL}/{created['id']}",
        json={"difficulty": "hard"},
        headers=auth(token),
    )
    assert response.status_code == 200
    assert response.json()["difficulty"] == "hard"


@pytest.mark.asyncio
async def test_update_challenge_rejects_unsupported_difficulty(
    db_client: AsyncClient,
) -> None:
    token, _ = await register_user(db_client)
    created = await create_challenge(db_client, token)

    response = await db_client.patch(
        f"{CHALLENGES_URL}/{created['id']}",
        json={"difficulty": "extreme"},
        headers=auth(token),
    )
    assert response.status_code == 422
    assert "Unsupported difficulty 'extreme'" in response.text


@pytest.mark.asyncio
async def test_list_challenges_filter_difficulty(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    await create_challenge(db_client, token, title="Easy task", difficulty="easy")
    await create_challenge(db_client, token, title="Hard task", difficulty="hard")
    await create_challenge(db_client, token, title="Medium task", difficulty="medium")

    response = await db_client.get(CHALLENGES_URL, params={"difficulty": "hard"})
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["title"] == "Hard task"


@pytest.mark.asyncio
async def test_list_challenges_rejects_unsupported_difficulty_filter(
    db_client: AsyncClient,
) -> None:
    response = await db_client.get(CHALLENGES_URL, params={"difficulty": "nightmare"})
    assert response.status_code == 422
    assert "Unsupported difficulty 'nightmare'" in response.text


@pytest.mark.asyncio
async def test_list_challenges_default_sort_is_newest(
    db_client: AsyncClient, db_sessionmaker
) -> None:
    from datetime import datetime, timedelta
    from uuid import UUID

    from sqlalchemy import update

    from app.models.challenge import Challenge

    token, _ = await register_user(db_client)
    zebra = await create_challenge(db_client, token, title="Zebra", difficulty="easy")
    apple = await create_challenge(db_client, token, title="Apple", difficulty="hard")

    # SQLite now() is second-precision, so both rows can tie on created_at;
    # force distinct values to make the newest-first assertion deterministic.
    async with db_sessionmaker() as session:
        await session.execute(
            update(Challenge)
            .where(Challenge.id == UUID(zebra["id"]))
            .values(created_at=datetime.now(UTC) - timedelta(seconds=60))
        )
        await session.execute(
            update(Challenge)
            .where(Challenge.id == UUID(apple["id"]))
            .values(created_at=datetime.now(UTC))
        )
        await session.commit()

    response = await db_client.get(CHALLENGES_URL)
    body = response.json()
    titles = [item["title"] for item in body["items"]]
    assert titles == ["Apple", "Zebra"]  # newest created first


@pytest.mark.asyncio
async def test_list_challenges_sort_by_title(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    await create_challenge(db_client, token, title="Zebra", difficulty="easy")
    await create_challenge(db_client, token, title="Apple", difficulty="hard")
    await create_challenge(db_client, token, title="Mango", difficulty="medium")

    response = await db_client.get(CHALLENGES_URL, params={"sort": "title"})
    body = response.json()
    titles = [item["title"] for item in body["items"]]
    assert titles == ["Apple", "Mango", "Zebra"]


@pytest.mark.asyncio
async def test_list_challenges_sort_combined_with_filters(db_client: AsyncClient) -> None:
    token, _ = await register_user(db_client)
    await create_challenge(db_client, token, title="Zebra Go", language="go")
    await create_challenge(db_client, token, title="Apple Go", language="go")
    await create_challenge(db_client, token, title="Mango Python", language="python")

    response = await db_client.get(CHALLENGES_URL, params={"language": "go", "sort": "title"})
    body = response.json()
    titles = [item["title"] for item in body["items"]]
    assert titles == ["Apple Go", "Zebra Go"]
