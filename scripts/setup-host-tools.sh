#!/bin/bash
set -euo pipefail

# setup-host-tools.sh — one-shot host bootstrap for the dev-sandbox workflow.
#
# The dev sandbox image (Dockerfile) is self-contained and does NOT need this
# script. It exists for the HOST side of the loop:
#   1. gh CLI auth — the host's ~/.config/gh is mounted read-only into the
#      `dev` container so scripts can run GitHub commands from there.
#   2. mise (declarative tool manager) + `mise install` — provisions node,
#      uv, gh, and the optional Kubernetes toolchain (kind, kubectl,
#      kustomize, helm, devspace) from mise.toml in one step, replacing the
#      old per-tool download script.
#
# Usage:
#   scripts/setup-host-tools.sh            # full bootstrap (install + auth)
#   scripts/setup-host-tools.sh --no-gh    # skip GitHub auth
#
# Tools land under ~/.local/share/mise/installs and are activated via
# `eval "$(mise activate bash)"` (appended to ~/.bashrc by this script).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- GitHub CLI auth ---------------------------------------------------------
if [[ "${1:-}" != "--no-gh" ]]; then
    if ! command -v gh >/dev/null 2>&1 || ! gh auth status >/dev/null 2>&1; then
        echo "[tools] gh CLI not authenticated — starting login (device flow)..."
        gh auth login
    else
        echo "[tools] gh CLI already authenticated."
    fi
fi

# --- mise ---------------------------------------------------------------------
if ! command -v mise >/dev/null 2>&1; then
    echo "[tools] Installing mise (to ~/.local/bin via mise.run)..."
    curl -fsSL https://mise.run | sh
fi

# Activate mise for this shell, and persist for future shells.
if ! grep -qs 'mise activate' ~/.bashrc; then
    echo 'eval "$(mise activate bash)"' >> ~/.bashrc
    echo "[tools] Added mise activation to ~/.bashrc"
fi
eval "$(mise activate bash)" 2>/dev/null || true

echo "[tools] Installing project toolchain from mise.toml (node, uv, gh + K8s tools)..."
(cd "$ROOT_DIR" && mise install)

echo ""
echo "=== Host toolchain ready ==="
echo "  mise:   $(mise --version)"
echo "  gh:     $(command -v gh >/dev/null 2>&1 && gh --version | head -n1 || echo 're-run in a new shell after activation')"
echo "  node:   $(command -v node >/dev/null 2>&1 && node --version || echo 're-run in a new shell after activation')"
echo "  uv:     $(command -v uv >/dev/null 2>&1 && uv --version | head -n1 || echo 're-run in a new shell after activation')"
echo ""
echo "  K8s tools (kind/kubectl/kustomize/helm/devspace) are optional and"
echo "  activate in new shells — open a fresh terminal, then:"
echo "      make k8s-setup     # create the Kind cluster"
echo "      make dev-up        # start the dev sandbox (recommended daily loop)"