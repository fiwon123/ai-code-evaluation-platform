#!/bin/bash
set -euo pipefail

# DevContainer Setup Script
# Installs opencode, configures gh CLI authentication, and installs the
# optional Kubernetes local-development toolchain (kind, kubectl, kustomize,
# helm, devspace). K8s tooling is best-effort and non-fatal: Docker Compose
# remains the primary local path, and `make k8s-*` targets require Docker.

echo "=== DevContainer Setup ==="

# --- Install opencode ---
echo ""
echo "--- Installing opencode ---"

INSTALL_DIR="$HOME/.opencode/bin"
mkdir -p "$INSTALL_DIR"

if command -v opencode >/dev/null 2>&1; then
    echo "opencode already installed at $(which opencode)"
else
    echo "Downloading opencode..."
    curl -fsSL https://opencode.ai/install | bash
    
    # Ensure PATH includes opencode
    if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
        export PATH="$INSTALL_DIR:$PATH"
        echo "export PATH=\"$INSTALL_DIR:\$PATH\"" >> "$HOME/.bashrc"
    fi
fi

# Verify opencode is available
if command -v opencode >/dev/null 2>&1; then
    echo "opencode installed successfully: $(opencode --version 2>/dev/null || echo 'available')"
else
    echo "WARNING: opencode installation may have failed"
fi

# --- Configure gh CLI authentication ---
echo ""
echo "--- Configuring gh CLI authentication ---"

if command -v gh >/dev/null 2>&1; then
    # Check if already authenticated
    if gh auth status >/dev/null 2>&1; then
        echo "gh CLI already authenticated"
    else
        # Check for GITHUB_TOKEN or GH_TOKEN environment variable
        if [[ -n "${GITHUB_TOKEN:-}" ]]; then
            echo "Authenticating gh CLI with GITHUB_TOKEN..."
            echo "$GITHUB_TOKEN" | gh auth login --with-token
        elif [[ -n "${GH_TOKEN:-}" ]]; then
            echo "Authenticating gh CLI with GH_TOKEN..."
            echo "$GH_TOKEN" | gh auth login --with-token
        else
            echo "WARNING: gh CLI is not authenticated"
            echo "To authenticate, run: gh auth login"
            echo "Or set GITHUB_TOKEN/GH_TOKEN environment variable"
        fi
    fi

    # Re-run setup-git so HTTPS git operations keep working even when the
    # persisted token (gh_config volume) lets gh skip re-authentication.
    gh auth setup-git 2>/dev/null || true

    # Verify authentication
    if gh auth status >/dev/null 2>&1; then
        echo "gh CLI authentication verified"
    else
        echo "WARNING: gh CLI authentication failed"
    fi
else
    echo "WARNING: gh CLI not found"
fi

# --- Install Kubernetes tooling (optional, best-effort) ---
echo ""
echo "--- Installing Kubernetes tooling (kind, kubectl, kustomize, helm, devspace) ---"

K8S_TOOLS_DIR="$HOME/.local/share/k8s-tools/bin"
mkdir -p "$K8S_TOOLS_DIR"

# Versions — pinned for reproducibility.
KIND_VERSION="v0.24.0"
KUBECTL_VERSION="v1.31.4"
KUSTOMIZE_VERSION="v5.4.3"
HELM_VERSION="v3.16.3"
DEVSPACE_VERSION="v6.3.21"

install_tool() {
    local name="$1"
    local url="$2"
    if command -v "$name" >/dev/null 2>&1; then
        echo "$name already installed at $(which $name)"
        return 0
    fi
    if [[ -x "$K8S_TOOLS_DIR/$name" ]]; then
        echo "$name already installed at $K8S_TOOLS_DIR/$name"
        return 0
    fi
    echo "Downloading $name..."
    if ! curl -fsSL "$url" -o "$K8S_TOOLS_DIR/$name.tmp" 2>/dev/null; then
        echo "WARNING: failed to download $name — skipping"
        return 0
    fi
    chmod +x "$K8S_TOOLS_DIR/$name.tmp"
    mv "$K8S_TOOLS_DIR/$name.tmp" "$K8S_TOOLS_DIR/$name"
    echo "$name installed at $K8S_TOOLS_DIR/$name"
}

# kind: single static binary
install_tool "kind" "https://github.com/kubernetes-sigs/kind/releases/download/${KIND_VERSION}/kind-linux-amd64"

# kubectl: single static binary
install_tool "kubectl" "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl"

# kustomize: tarball containing a single binary
if ! command -v kustomize >/dev/null 2>&1 && [[ ! -x "$K8S_TOOLS_DIR/kustomize" ]]; then
    echo "Downloading kustomize..."
    if curl -fsSL "https://github.com/kubernetes-sigs/kustomize/releases/download/kustomize%2F${KUSTOMIZE_VERSION}/kustomize_${KUSTOMIZE_VERSION}_linux_amd64.tar.gz" \
        -o /tmp/kustomize.tar.gz 2>/dev/null; then
        mkdir -p /tmp/kustomize-extract
        tar -xzf /tmp/kustomize.tar.gz -C /tmp/kustomize-extract kustomize
        mv /tmp/kustomize-extract/kustomize "$K8S_TOOLS_DIR/kustomize"
        chmod +x "$K8S_TOOLS_DIR/kustomize"
        rm -rf /tmp/kustomize.tar.gz /tmp/kustomize-extract
        echo "kustomize installed at $K8S_TOOLS_DIR/kustomize"
    else
        echo "WARNING: failed to download kustomize — skipping"
    fi
fi

# helm: tarball containing a linux-amd64/helm binary
if ! command -v helm >/dev/null 2>&1 && [[ ! -x "$K8S_TOOLS_DIR/helm" ]]; then
    echo "Downloading helm..."
    if curl -fsSL "https://get.helm.sh/helm-${HELM_VERSION}-linux-amd64.tar.gz" \
        -o /tmp/helm.tar.gz 2>/dev/null; then
        mkdir -p /tmp/helm-extract
        tar -xzf /tmp/helm.tar.gz -C /tmp/helm-extract
        mv /tmp/helm-extract/linux-amd64/helm "$K8S_TOOLS_DIR/helm"
        chmod +x "$K8S_TOOLS_DIR/helm"
        rm -rf /tmp/helm.tar.gz /tmp/helm-extract
        echo "helm installed at $K8S_TOOLS_DIR/helm"
    else
        echo "WARNING: failed to download helm — skipping"
    fi
fi

# devspace: single static binary
install_tool "devspace" "https://github.com/loft-sh/devspace/releases/download/${DEVSPACE_VERSION}/devspace-linux-amd64"

# Add K8s tools to PATH if not already present.
if [[ ":$PATH:" != *":$K8S_TOOLS_DIR:"* ]]; then
    export PATH="$K8S_TOOLS_DIR:$PATH"
    if ! grep -q "$K8S_TOOLS_DIR" "$HOME/.bashrc" 2>/dev/null; then
        echo "export PATH=\"$K8S_TOOLS_DIR:\$PATH\"" >> "$HOME/.bashrc"
    fi
fi

for tool in kind kubectl kustomize helm devspace; do
    if command -v "$tool" >/dev/null 2>&1 || [[ -x "$K8S_TOOLS_DIR/$tool" ]]; then
        echo "$tool available"
    else
        echo "WARNING: $tool not installed (install manually or rebuild the devcontainer with Docker)"
    fi
done

echo ""
echo "=== Setup Complete ==="
