from collections.abc import AsyncGenerator, Generator
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, MetaData, Uuid, create_engine, func
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

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


class TimestampMixin:
    """Mixin that adds created_at and updated_at timestamp columns."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


engine = create_async_engine(settings.database_url, echo=False)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# Synchronous engine/session for Celery workers (the normalized psycopg URL
# supports both sync and async usage with SQLAlchemy 2.x).
sync_engine = create_engine(settings.database_url, echo=False, pool_pre_ping=True)
sync_session = sessionmaker(sync_engine, class_=Session, expire_on_commit=False)


async def get_session() -> AsyncGenerator[AsyncSession]:
    """Dependency that yields an async database session."""
    async with async_session() as session:
        yield session


def get_sync_session() -> Generator[Session]:
    """Dependency that yields a synchronous database session."""
    with sync_session() as session:
        yield session
