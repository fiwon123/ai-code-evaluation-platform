#!/bin/bash
set -euo pipefail

# k8s-deploy.sh — render a Kustomize overlay and apply it to the cluster.
#
# Uses `kustomize build | kubectl apply -f -` per project convention.
#
# Usage:
#   scripts/k8s-deploy.sh [overlay]     # default: dev
#   scripts/k8s-deploy.sh staging
#   scripts/k8s-deploy.sh production --dry-run
#   OVERLAY=staging scripts/k8s-deploy.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

OVERLAY="${1:-${OVERLAY:-dev}}"
DRY_RUN="${2:-}"

OVERLAY_DIR="$ROOT_DIR/k8s/overlays/$OVERLAY"

if [[ ! -d "$OVERLAY_DIR" ]]; then
    echo "ERROR: unknown overlay '$OVERLAY' — expected one of: dev, staging, production" >&2
    echo "  (no k8s/overlays/$OVERLAY directory)" >&2
    exit 1
fi

for tool in kustomize kubectl; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "ERROR: '$tool' is required but not on PATH." >&2
        exit 1
    fi
done

echo "Rendering and applying overlay '$OVERLAY'..."
echo "  source:  $OVERLAY_DIR"
echo "  command: kustomize build <overlay> | kubectl apply -f -"

rendered="$(kustomize build "$OVERLAY_DIR")"
if [[ "$DRY_RUN" == "--dry-run" ]]; then
    echo "$rendered" | kubectl apply --dry-run=client -f -
else
    echo "$rendered" | kubectl apply -f -
fi

echo ""
echo "=== Deployment complete ==="
echo "Pods:      kubectl get pods -n ai-eval"
echo "Ingress:   kubectl get ingress -n ai-eval"
echo "Services:  kubectl get svc -n ai-eval"