#!/bin/bash
set -euo pipefail

# k8s-teardown.sh — delete the local Kind cluster.
#
# Usage:
#   scripts/k8s-teardown.sh

CLUSTER_NAME="ai-eval"

if ! command -v kind >/dev/null 2>&1; then
    echo "ERROR: 'kind' is required but not on PATH." >&2
    exit 1
fi

if kind get clusters 2>/dev/null | grep -q "^${CLUSTER_NAME}$"; then
    echo "Deleting Kind cluster '$CLUSTER_NAME'..."
    kind delete cluster --name "$CLUSTER_NAME"
    echo "Cluster deleted."
else
    echo "Cluster '$CLUSTER_NAME' does not exist — nothing to do."
fi

echo "Teardown complete."
exit 0