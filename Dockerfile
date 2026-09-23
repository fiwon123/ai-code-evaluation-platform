# Dev image for the AI Code Evaluation Platform (dev + celery compose services).
# Built by docker-compose.yml (`context: .`, `dockerfile: Dockerfile`).
#
# This is the "dev sandbox": a slim, isolated runtime for the application.
# Source code is bind-mounted into /workspace at runtime (hot reload); Python
# dependencies are baked into /opt/backend-venv at build time so the bind
# mount (which shadows /workspace) cannot hide them. Frontend dependencies
# (node_modules) are relocatable and live in the workspace, shared with the
# host-native loop.
#
# Runtime versions are pinned here on purpose (offline-reproducible image
# builds, no fetches at container creation). mise.toml is the host-side
# source of truth — keep the ARGs below in sync with it.

FROM python:3.14-slim

# Install system dependencies (zsh = default interactive shell in the sandbox;
# bash remains available for scripts/entrypoints with their own shebangs).
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    git \
    zsh \
    && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI (pinned release tarball — no ghcr.io devcontainer features).
ARG GH_CLI_VERSION=v2.101.0
ARG TARGETARCH
RUN if [ -z "$TARGETARCH" ]; then \
      case "$(uname -m)" in \
        x86_64|amd64) TARGETARCH=amd64 ;; \
        aarch64|arm64) TARGETARCH=arm64 ;; \
        *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;; \
      esac; \
    fi \
    && curl -fsSL "https://github.com/cli/cli/releases/download/${GH_CLI_VERSION}/gh_${GH_CLI_VERSION#v}_linux_${TARGETARCH}.tar.gz" -o /tmp/gh.tar.gz \
    && tar -xzf /tmp/gh.tar.gz -C /tmp \
    && mv "/tmp/gh_${GH_CLI_VERSION#v}_linux_${TARGETARCH}/bin/gh" /usr/local/bin/gh \
    && gh --version \
    && rm -rf /tmp/gh.tar.gz "/tmp/gh_${GH_CLI_VERSION#v}_linux_${TARGETARCH}"

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Install Node.js 22 (pinned release tarball — replaces the ghcr.io
# devcontainers/features/node feature whose OCI layer fetch is flaky at
# container-creation time, same as the gh CLI install above). Node 22 matches
# the frontend toolchain. Bump NODE_VERSION deliberately.
ARG NODE_VERSION=v22.23.2
RUN if [ -z "$TARGETARCH" ]; then \
      case "$(uname -m)" in \
        x86_64|amd64) TARGETARCH=amd64 ;; \
        aarch64|arm64) TARGETARCH=arm64 ;; \
        *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;; \
      esac; \
    fi \
    # Normalize to Node's tarball arch naming (x64/arm64) regardless of how
    # TARGETARCH was set (BuildKit auto-sets it to amd64/arm64).
    && case "$TARGETARCH" in \
         x86_64|amd64) NODE_TARGETARCH=x64 ;; \
         aarch64|arm64) NODE_TARGETARCH=arm64 ;; \
         *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
       esac \
    && curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-${NODE_TARGETARCH}.tar.gz" -o /tmp/node.tar.gz \
    && mkdir -p /usr/local/lib/nodejs \
    && tar -xzf /tmp/node.tar.gz -C /usr/local/lib/nodejs \
    && ln -sf "/usr/local/lib/nodejs/node-${NODE_VERSION}-linux-${NODE_TARGETARCH}/bin/node" /usr/local/bin/node \
    && ln -sf "/usr/local/lib/nodejs/node-${NODE_VERSION}-linux-${NODE_TARGETARCH}/bin/npm" /usr/local/bin/npm \
    && ln -sf "/usr/local/lib/nodejs/node-${NODE_VERSION}-linux-${NODE_TARGETARCH}/bin/npx" /usr/local/bin/npx \
    && node --version && npm --version \
    && rm -rf /tmp/node.tar.gz

# Set working directory
WORKDIR /workspace

# Bake backend dependencies into /opt/backend-venv (NOT /workspace/backend/.venv:
# the workspace bind mount shadows /workspace at runtime, and venv interpreter
# symlinks are path-specific, so the baked venv must live outside /workspace).
# The bind-mounted source at runtime stays in sync with this lockfile via
# `uv sync` whenever pyproject.toml/uv.lock change.
ENV UV_PROJECT_ENVIRONMENT=/opt/backend-venv
COPY backend/ /workspace/backend/
RUN cd /workspace/backend && uv sync

# Install dev sandbox shell config (prompt + terminal title indicators). The
# script is shell-aware (bash + zsh) and sourced from the rc files below.
COPY scripts/dev-sandbox-rc.sh /etc/profile.d/00-dev-sandbox.sh

# Make zsh the default interactive shell for the sandbox (bash stays installed
# for scripts/entrypoints, which carry their own shebangs).
RUN chsh -s /usr/bin/zsh root

# Ensure interactive non-login shells (docker compose exec -it dev bash) also pick up config
RUN printf '\n# Load dev sandbox configuration\n[ -f /etc/profile.d/00-dev-sandbox.sh ] && . /etc/profile.d/00-dev-sandbox.sh\n' >> /root/.bashrc

# zsh startup files:
#   ~/.zshrc    — interactive shells (make shell / dev-exec / docker exec -it)
#   ~/.zprofile — login shells (zsh -lc from `make opencode` sets the title)
RUN printf '\n# Load dev sandbox configuration\n[ -f /etc/profile.d/00-dev-sandbox.sh ] && . /etc/profile.d/00-dev-sandbox.sh\n' >> /root/.zshrc \
    && printf '\n# Load dev sandbox configuration\n[ -f /etc/profile.d/00-dev-sandbox.sh ] && . /etc/profile.d/00-dev-sandbox.sh\n' >> /root/.zprofile

# Keep the container alive when started without an explicit command; the dev
# and celery compose services override this with their real entrypoints.
CMD ["sleep", "infinity"]