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
# The container runs as the host user (`user:` in docker-compose.yml, fed by
# HOST_UID/HOST_GID from the Makefile) so files written here — including the
# agent's own edits — keep the host's ownership instead of becoming root:root
# and unreadable in the host editor.
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