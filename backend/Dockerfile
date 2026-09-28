# syntax=docker/dockerfile:1

# Production image for the FastAPI backend.
#
# Multi-stage build:
#   Stage 1 (builder) — installs locked dependencies and builds the app wheel with uv.
#   Stage 2 (runtime) — slim Python runtime with the pre-built virtualenv, no build tools.
#
# Build:  docker build -f backend/Dockerfile -t eval-backend:<tag> backend

# ---------- Stage 1: build dependencies + project with uv ----------
# hadolint ignore=DL3007
FROM ghcr.io/astral-sh/uv:latest AS builder

# NOTE: uv:latest is intentional — it tracks the uv release channel and is the
# same reference the dev-container image (root Dockerfile) uses for a matching
# lockfile (uv.lock v1). Pin to a hash in CI for maximum reproducibility.

WORKDIR /app
ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/app/.venv

# Install locked third-party dependencies first (faster layer caching).
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

# Copy source and install the project itself.
COPY src ./src
COPY alembic ./alembic
COPY alembic.ini ./
RUN uv sync --frozen --no-dev

# ---------- Stage 2: slim runtime ----------
FROM python:3.14-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/app/.venv/bin:$PATH" \
    PYTHONPATH="/app/src"

WORKDIR /app

# Run as non-root.
RUN useradd --create-home --uid 10001 appuser

# Copy the self-contained virtualenv and runtime files from the builder.
COPY --from=builder /app/.venv .venv
COPY --from=builder /app/src src
COPY --from=builder /app/alembic alembic
COPY --from=builder /app/alembic.ini alembic.ini

USER appuser
EXPOSE 8000

# Config comes from environment (DATABASE_URL, REDIS_URL, JWT_SECRET_KEY, ...).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]