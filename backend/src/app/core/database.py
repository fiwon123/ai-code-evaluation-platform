from collections.abc import AsyncGenerator
from uuid import UUID, uuid4

from sqlalchemy import MetaData, Uuid
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.config import settings

# Naming convention for constraints (helps Alembic generate clean migrations)
convention = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """Declarative base class with naming convention for all ORM models."""

    metadata = MetaData(naming_convention=convention)


class UUIDMixin:
    """Mixin that adds a native UUID primary key column."""

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)


engine = create_async_engine(settings.database_url, echo=False)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_session() -> AsyncGenerator[AsyncSession]:
    """Dependency that yields an async database session."""
    async with async_session() as session:
        yield session
