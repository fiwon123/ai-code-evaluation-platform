#!/bin/bash
set -euo pipefail

# DevContainer Setup Script
# Installs opencode and configures gh CLI authentication

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

echo ""
echo "=== Setup Complete ==="
