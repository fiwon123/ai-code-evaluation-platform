#!/bin/bash
set -euo pipefail

# Starts the Celery worker in the background.
# Safe to run multiple times: exits early if the worker is already running.

LOG_FILE="/tmp/celery.log"
PID_FILE="/tmp/celery.pid"
BACKEND_DIR="/workspace/backend"

# Exit early if we already started a live worker. ``kill -0`` alone is not
# enough: a zombie process (crashed but not reaped) still responds to it, so
# we also verify the process state is not 'Z'.
if [[ -f "$PID_FILE" ]]; then
    WORKER_PID=$(cat "$PID_FILE")
    if kill -0 "$WORKER_PID" 2>/dev/null; then
        STATE=$(awk '/^State:/{print $2}' "/proc/$WORKER_PID/status" 2>/dev/null || echo "")
        if [[ "$STATE" != "Z" ]]; then
            echo "Celery worker already running (PID $WORKER_PID). Skipping."
            exit 0
        fi
        echo "Celery worker PID $WORKER_PID is a zombie — restarting."
        rm -f "$PID_FILE"
    fi
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