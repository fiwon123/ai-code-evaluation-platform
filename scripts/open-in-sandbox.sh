#!/bin/bash
set -euo pipefail

# open-in-sandbox.sh — interactive shell inside the dev sandbox with the
# sandboxed AI coding agent (opencode) available.
#
# Ensures the stack is running, then opens zsh (the default sandbox shell) in
# the `dev` container. opencode is injected via read-only compose mounts (see
# docker-compose.yml):
#   - binary: ${HOME}/.opencode/bin/opencode          → /usr/local/bin/opencode
#   - config: ${HOME}/.config/opencode                → /home/devuser/.config/opencode
#   - git identity: ${HOME}/.gitconfig                 → /home/devuser/.gitconfig
#
# The container runs as the host user (`user:` in docker-compose.yml, fed by the
# HOST_UID/HOST_GID exported below — the same variables the Makefile exports) so
# files written here — including the agent's own edits — keep the host's
# ownership instead of becoming root:root and unreadable in the host editor.
#
# Trusted-agent model: the dev container shares the workspace (bind mount) and
# the Docker socket with the host BY DESIGN — isolation covers the agent's
# runtime, not Docker/workspace access. `make dev-up` pre-creates config paths.
#
# Usage:
#   scripts/open-in-sandbox.sh                  # interactive zsh (opencode ready)
#   scripts/open-in-sandbox.sh 'uv run pytest'  # run one command in the sandbox

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# --- Host identity (must precede every `docker compose` call below) -------------
# The dev/celery/beat services run as the HOST user, which compose only knows
# through these variables — the Makefile exports the same set. Without them
# `docker compose` silently falls back to 1000:1000 and socket group 0, which
# is correct only on a 1000:1000 host and brings back the root-owned-workspace
# bug (#183) everywhere else. Keep in sync with the Makefile; locked by
# backend/tests/test_dev_sandbox_ownership.py.
export HOST_UID="${HOST_UID:-$(id -u)}"
export HOST_GID="${HOST_GID:-$(id -g)}"
if [[ -z "${DOCKER_GID:-}" ]]; then
    # GNU stat (-c) first, BSD/macOS stat (-f) as fallback, 0 as last resort.
    DOCKER_GID="$(stat -c %g /var/run/docker.sock 2>/dev/null || stat -f %g /var/run/docker.sock 2>/dev/null || echo 0)"
    export DOCKER_GID
fi

# Ensure the stack is running (idempotent; keeps postgres_data volume).
if ! docker compose ps -q dev >/dev/null 2>&1; then
    echo "[sandbox] Starting dev stack (docker compose up -d dev)..."
    docker compose up -d dev
else
    echo "[sandbox] Dev stack already running."
fi

# One-shot command mode — preserve a TTY when stdin is interactive so
# interactive tools (opencode, vim, ...) work; -T only for non-TTY callers.
if [[ $# -gt 0 ]]; then
    if [[ -t 0 ]]; then
        exec docker compose exec -it dev zsh -lc "$*"
    else
        exec docker compose exec -T dev zsh -lc "$*"
    fi
fi

echo "[sandbox] Dev sandbox shell — run the AI coding agent with:"
echo "          cd /sandbox/ai-code-evaluation-platform && opencode"
if [[ -t 0 ]]; then
    exec docker compose exec -it dev zsh
else
    exec docker compose exec -T dev zsh
fi