from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import api_router
from app.api.health import router as health_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan — yields then cleans up connections on shutdown."""
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
        allow_origins=["http://localhost:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Routes
    application.include_router(health_router)
    application.include_router(api_router, prefix="/api")

    return application


app = create_app()
