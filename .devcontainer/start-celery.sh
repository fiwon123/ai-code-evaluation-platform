#!/bin/bash
set -euo pipefail

# Starts the Celery worker in the background.
# Safe to run multiple times: exits early if the worker is already running.

LOG_FILE="/tmp/celery.log"
PID_FILE="/tmp/celery.pid"
BACKEND_DIR="/workspace/backend"

# Exit early if we already started the worker.
if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "Celery worker already running (PID $(cat "$PID_FILE")). Skipping."
    exit 0
fi

# Wait (up to 120s) for dependencies to be installed by postCreateCommand.
for ((i = 0; i < 120; i++)); do
    if [[ -x "$BACKEND_DIR/.venv/bin/celery" ]]; then
        break
    fi
    sleep 1
done

if [[ ! -x "$BACKEND_DIR/.venv/bin/celery" ]]; then
    echo "ERROR: backend dependencies not installed (uv sync not run)." >&2
    exit 1
fi

echo "Starting Celery worker (logs: ${LOG_FILE})"
cd "$BACKEND_DIR"
nohup uv run celery -A app.core.celery_app:celery_app worker --loglevel=info >"$LOG_FILE" 2>&1 &
echo $! >"$PID_FILE"