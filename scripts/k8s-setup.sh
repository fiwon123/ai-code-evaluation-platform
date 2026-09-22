#!/bin/bash
set -euo pipefail

# k8s-setup.sh — create the local Kind cluster, build images, load them.
#
# Part of the v0.6.0 Kubernetes workflow. Requires:
#   - Docker (available on the host; NOT available inside the devcontainer)
#   - kind, kubectl, kustomize on PATH (installed by .devcontainer/setup.sh
#     on the host, or via your distro package manager)
#
# Usage:
#   scripts/k8s-setup.sh                # default images (eval-backend/eval-frontend:dev)
#   IMAGE_TAG=v0.7.0 scripts/k8s-setup.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

CLUSTER_NAME="ai-eval"
KIND_CONFIG="$ROOT_DIR/k8s/kind-config.yaml"
IMAGE_TAG="${IMAGE_TAG:-dev}"

BACKEND_IMAGE="eval-backend:$IMAGE_TAG"
FRONTEND_IMAGE="eval-frontend:$IMAGE_TAG"

# --- Preflight checks -----------------------------------------------------
for tool in docker kind kubectl; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "ERROR: '$tool' is required but not on PATH." >&2
        echo "  Install via .devcontainer/setup.sh or the official docs, then re-run." >&2
        exit 1
    fi
done

if ! docker info >/dev/null 2>&1; then
    echo "ERROR: Docker daemon is not running or not accessible." >&2
    echo "  Kind requires Docker. Start Docker Desktop / dockerd first." >&2
    exit 1
fi

# --- Create the cluster ---------------------------------------------------
if kind get clusters 2>/dev/null | grep -q "^${CLUSTER_NAME}$"; then
    echo "Cluster '$CLUSTER_NAME' already exists — skipping creation."
else
    echo "Creating Kind cluster '$CLUSTER_NAME'..."
    kind create cluster --name "$CLUSTER_NAME" --config "$KIND_CONFIG"
    echo "Cluster created."
fi

# --- Build + load images --------------------------------------------------
echo "Building backend image: $BACKEND_IMAGE"
docker build -f "$ROOT_DIR/backend/Dockerfile" -t "$BACKEND_IMAGE" "$ROOT_DIR/backend"

echo "Building frontend image: $FRONTEND_IMAGE"
docker build -f "$ROOT_DIR/frontend/Dockerfile" -t "$FRONTEND_IMAGE" "$ROOT_DIR/frontend"

echo "Loading images into the cluster..."
kind load docker-image "$BACKEND_IMAGE" --name "$CLUSTER_NAME"
kind load docker-image "$FRONTEND_IMAGE" --name "$CLUSTER_NAME"

kubectl config use-context "kind-$CLUSTER_NAME"

echo ""
echo "=== Setup complete ==="
echo "Cluster:  kind-$CLUSTER_NAME"
echo "Images:   $BACKEND_IMAGE, $FRONTEND_IMAGE"
echo "Deploy:   make k8s-deploy OVERLAY=dev   (or scripts/k8s-deploy.sh dev)"
echo "Dev loop: make k8s-dev                  (DevSpace)"
echo "Teardown: make k8s-teardown"
echo ""
echo "Port mappings (host -> node): 80/443 (ingress), 8000 (backend), 5173 (frontend)"