"""Manual seed CLI for the curated example challenges.

Usage (from ``backend/``)::

    uv run python -m app.seed_examples

Idempotent — safe to run repeatedly; only system-owned example rows are
touched. Prints how many challenges were created vs. updated.
"""

from __future__ import annotations

import asyncio

from app.core.database import async_session
from app.services.example_challenges import seed_example_challenges


async def _main() -> None:
    async with async_session() as session:
        result = await seed_example_challenges(session)
    print(
        f"Example challenges seeded: {result.created} created, "
        f"{result.updated} updated"
    )


if __name__ == "__main__":
    asyncio.run(_main())
