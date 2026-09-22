"""Tests for the shared pagination helper."""

import pytest
from sqlalchemy import String, select
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.pool import StaticPool

from app.api.pagination import paginate


class _Base(DeclarativeBase):
    pass


class _Widget(_Base):
    __tablename__ = "widgets"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String)


@pytest.fixture
async def widget_session():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(_Base.metadata.create_all)

    session_factory = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )
    async with session_factory() as session:
        session.add_all([_Widget(name=f"w{i}") for i in range(25)])
        await session.commit()
        yield session

    await engine.dispose()


async def _paged(widget_session, page, page_size):
    statement = select(_Widget).order_by(_Widget.id)
    return await paginate(
        widget_session, statement, page=page, page_size=page_size
    )


class TestPaginate:
    async def test_first_page(self, widget_session):
        items, total, pages = await _paged(widget_session, page=1, page_size=10)
        assert total == 25
        assert pages == 3
        assert len(items) == 10
        assert items[0].name == "w0"

    async def test_second_page(self, widget_session):
        items, total, pages = await _paged(widget_session, page=2, page_size=10)
        assert pages == 3
        assert len(items) == 10
        assert items[0].name == "w10"

    async def test_last_partial_page(self, widget_session):
        items, total, pages = await _paged(widget_session, page=3, page_size=10)
        assert len(items) == 5
        assert items[-1].name == "w24"

    async def test_page_beyond_range_is_empty(self, widget_session):
        items, total, pages = await _paged(widget_session, page=9, page_size=10)
        assert items == []
        assert total == 25

    async def test_empty_table(self):
        engine = create_async_engine(
            "sqlite+aiosqlite:///:memory:", poolclass=StaticPool
        )
        async with engine.begin() as conn:
            await conn.run_sync(_Base.metadata.create_all)
        session_factory = async_sessionmaker(
            engine, class_=AsyncSession, expire_on_commit=False
        )
        async with session_factory() as session:
            items, total, pages = await _paged(session, page=1, page_size=20)
            assert items == []
            assert total == 0
            assert pages == 0
        await engine.dispose()
