#!/bin/bash
set -euo pipefail

# Starts the Vite dev server in the background.
# Safe to run multiple times: exits early if the server is already running.

PORT=5173
LOG_FILE="/tmp/frontend.log"
PID_FILE="/tmp/frontend.pid"
FRONTEND_DIR="/workspace/frontend"

# Exit early if we already started the server.
if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "Frontend already running (PID $(cat "$PID_FILE")). Skipping."
    exit 0
fi

# Wait (up to 300s) for node_modules to be installed by postCreateCommand.
for ((i = 0; i < 300; i++)); do
    if [[ -x "$FRONTEND_DIR/node_modules/.bin/vite" ]]; then
        break
    fi
    sleep 1
done

if [[ ! -x "$FRONTEND_DIR/node_modules/.bin/vite" ]]; then
    echo "ERROR: frontend dependencies not installed (npm install not run)." >&2
    exit 1
fi

# Port conflict check (bash /dev/tcp, no external tools required).
if (exec 3<>"/dev/tcp/127.0.0.1/${PORT}") 2>/dev/null; then
    exec 3>&- 3<&-
    echo "Frontend port ${PORT} is already in use. Skipping."
    exit 0
fi

echo "Starting frontend on http://localhost:${PORT} (logs: ${LOG_FILE})"
cd "$FRONTEND_DIR"
nohup npm run dev -- --host 0.0.0.0 --port "$PORT" >"$LOG_FILE" 2>&1 &
echo $! >"$PID_FILE"