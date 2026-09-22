"""Shared offset-pagination helpers for list endpoints.

Every paginated router follows the same pattern: build a filtered
:class:`sqlalchemy.Select`, execute a count query against a subquery of it,
then fetch one page. ``paginate`` centralizes that so routers only declare
their query, ordering, and page parameters.
"""

from __future__ import annotations

from math import ceil

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession


async def paginate(
    db: AsyncSession,
    statement: Select,
    *,
    page: int,
    page_size: int,
) -> tuple[list, int, int]:
    """Execute ``statement`` with the given offset page.

    Returns ``(orm_items, total, pages)`` where ``pages`` is the total
    number of pages for ``page_size`` (0 when there are no rows).
    """
    count_result = await db.execute(
        select(func.count()).select_from(statement.subquery())
    )
    total = count_result.scalar_one()

    items_result = await db.execute(
        statement.offset((page - 1) * page_size).limit(page_size)
    )
    orm_items = list(items_result.scalars().all())

    pages = ceil(total / page_size) if total else 0
    return orm_items, total, pages
