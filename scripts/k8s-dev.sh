#!/bin/bash
set -euo pipefail

# k8s-dev.sh — DevSpace inner dev loop against the Kind cluster.
#
# Usage:
#   scripts/k8s-dev.sh          # default: interactive dev loop
#   scripts/k8s-dev.sh deploy   # deploy without the dev loop
#   scripts/k8s-dev.sh --profile production

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if ! command -v devspace >/dev/null 2>&1; then
    echo "ERROR: 'devspace' is required but not on PATH." >&2
    echo "  Install via scripts/setup-host-tools.sh (mise), then re-run." >&2
    exit 1
fi

cd "$ROOT_DIR"

if [[ "${1:-}" == "deploy" ]]; then
    echo "Deploying via DevSpace (Kustomize overlay dev)..."
    exec devspace deploy --config devspace.yaml
fi

echo "Starting DevSpace dev loop..." 
echo "  Ports:   8000 (backend) and 5173 (frontend) forwarded to localhost"
echo "  Sync:    backend/src and frontend/src into the cluster"
echo "  Exit:    Ctrl+C (stops sync + port forwarding)"

exec devspace dev --config devspace.yaml "$@"