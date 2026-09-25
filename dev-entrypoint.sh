#!/bin/bash
set -euo pipefail

# Dev-sandbox entrypoint — runs uvicorn (backend) + vite (frontend) in the
# foreground on the dev compose service, forwarding SIGTERM/SIGINT so
# `docker stop`/Ctrl-C shuts both down cleanly.
#
# Interactive shell inside the sandbox:
#   docker compose run --rm --entrypoint zsh dev
#   scripts/open-in-sandbox.sh   (opens a shell with opencode available)
#   docker compose exec dev opencode   (sandboxed AI coding agent)
#
# Backend deps are baked at image build into /opt/backend-venv (outside the
# bind mount); the script re-syncs only when the baked venv is missing (e.g.
# a workspace where the image predates a pyproject change). Frontend deps are
# shared with the host in the workspace; npm ci runs only when missing.

BACKEND_DIR=/sandbox/ai-code-evaluation-platform/backend
FRONTEND_DIR=/sandbox/ai-code-evaluation-platform/frontend
BACKEND_VENV="${UV_PROJECT_ENVIRONMENT:-/opt/backend-venv}"

# --- Passwd entry for the runtime user ---------------------------------------
# The image bakes a `devuser` matching the build args, and compose normally runs
# the container with that same UID (`user:` in docker-compose.yml), so this is
# usually a no-op. When the image was built with different build args than the
# UID it now runs with (e.g. a cached image, or a plain `docker compose up`
# without the Makefile's HOST_UID), no passwd entry exists for the caller —
# which leaves $HOME, `~`, git and npm without an identity to resolve. Append a
# minimal entry when we can (running as root); as a non-root user without an
# entry the tools still work via the explicit HOME/USER env vars set in
# docker-compose.yml, so a warning is enough there.
if ! getent passwd "$(id -u)" >/dev/null; then
    if [[ "$(id -u)" -eq 0 ]]; then
        echo "[dev] UID 0 has no passwd entry — adding a fallback identity."
        printf 'sandbox:x:%s:%s:Sandbox User:/home/%s:/usr/bin/zsh\n' \
            "$(id -u)" "$(id -g)" "${DEV_USER:-devuser}" >> /etc/passwd
    else
        echo "[dev] WARNING: UID $(id -u) has no passwd entry." >&2
        echo "[dev]          Rebuild the image for this UID (make dev-build) so the" >&2
        echo "[dev]          dev user matches, or run with 'docker compose exec -u root'." >&2
    fi
fi

# --- Bootstrap dependencies if missing (first run on a fresh workspace) ---
if [[ ! -x "$BACKEND_VENV/bin/uvicorn" ]]; then
    echo "[dev] Backend dependencies missing — running 'uv sync' into $BACKEND_VENV ..."
    (cd "$BACKEND_DIR" && uv sync)
fi

if [[ ! -x "$FRONTEND_DIR/node_modules/.bin/vite" ]]; then
    echo "[dev] Frontend dependencies missing — running 'npm ci' ..."
    (cd "$FRONTEND_DIR" && npm ci)
fi

# --- Database migrations (idempotent; first boot against an empty volume) ---
# Runs after depends_on postgres:service_healthy, so the DB is reachable.
echo "[dev] Running database migrations (alembic upgrade head)..."
(cd "$BACKEND_DIR" && "$BACKEND_VENV/bin/alembic" upgrade head)

# --- Start both dev servers ---
echo "[dev] Starting backend on http://localhost:8000 ..."
(cd "$BACKEND_DIR" && exec "$BACKEND_VENV/bin/uvicorn" app.main:app --reload --host 0.0.0.0 --port 8000) &

echo "[dev] Starting frontend on http://localhost:5173 ..."
(cd "$FRONTEND_DIR" && exec npm run dev -- --host 0.0.0.0 --port 5173) &

# Forward termination signals to the children (docker stop sends SIGTERM).
trap 'kill $(jobs -p) 2>/dev/null || true; exit 0' TERM INT

# Wait for the first server to exit, then stop the other and propagate.
wait -n
status=$?
kill $(jobs -p) 2>/dev/null || true
wait 2>/dev/null || true
exit $status