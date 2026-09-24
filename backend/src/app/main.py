import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import api_router
from app.api.health import router as health_router
from app.api.websocket import router as websocket_router
from app.config import settings
from app.core.security_headers import SecurityHeadersMiddleware

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan — seeds example challenges on startup, yields, then
    cleans up connections on shutdown."""
    if settings.seed_examples:
        from app.core.database import async_session
        from app.services.example_challenges import seed_example_challenges

        try:
            async with async_session() as session:
                result = await seed_example_challenges(session)
            logger.info(
                "Seeded example challenges: %d created, %d updated",
                result.created,
                result.updated,
            )
        except Exception:
            # Never block boot: the DB may be unreachable or not yet migrated.
            # `make seed-examples` re-runs the seeder manually.
            logger.exception("Failed to seed example challenges (non-fatal)")
    yield
    from app.core.database import engine
    from app.core.redis import redis_client

    await engine.dispose()
    await redis_client.aclose()


def create_app() -> FastAPI:
    """Application factory."""
    application = FastAPI(
        title="AI Code Evaluation Platform",
        version="0.1.0",
        lifespan=lifespan,
    )

    # CORS for the frontend dev server
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Hardening headers on every response
    application.add_middleware(SecurityHeadersMiddleware)

    # Routes
    application.include_router(health_router)
    application.include_router(api_router, prefix="/api")
    # WebSockets are mounted separately so the HTTP rate-limiter dependency
    # (and its JWT/request parsing) never applies to socket handshakes.
    application.include_router(websocket_router, prefix="/api")

    return application


app = create_app()
