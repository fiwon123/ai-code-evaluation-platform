#!/bin/bash
set -euo pipefail

# Starts the FastAPI dev server (uvicorn) in the background.
# Safe to run multiple times: exits early if the server is already running.

PORT=8000
LOG_FILE="/tmp/backend.log"
PID_FILE="/tmp/backend.pid"
BACKEND_DIR="/workspace/backend"

# Exit early if we already started the server.
if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "Backend already running (PID $(cat "$PID_FILE")). Skipping."
    exit 0
fi

# Wait (up to 120s) for dependencies to be installed by postCreateCommand.
for ((i = 0; i < 120; i++)); do
    if [[ -x "$BACKEND_DIR/.venv/bin/uvicorn" ]]; then
        break
    fi
    sleep 1
done

if [[ ! -x "$BACKEND_DIR/.venv/bin/uvicorn" ]]; then
    echo "ERROR: backend dependencies not installed (uv sync not run)." >&2
    exit 1
fi

# Port conflict check (bash /dev/tcp, no external tools required).
if (exec 3<>"/dev/tcp/127.0.0.1/${PORT}") 2>/dev/null; then
    exec 3>&- 3<&-
    echo "Backend port ${PORT} is already in use. Skipping."
    exit 0
fi

echo "Starting backend on http://localhost:${PORT} (logs: ${LOG_FILE})"
cd "$BACKEND_DIR"
nohup uv run uvicorn app.main:app --reload --host 0.0.0.0 --port "$PORT" >"$LOG_FILE" 2>&1 &
echo $! >"$PID_FILE"