# Dev image for the AI Code Evaluation Platform (dev + celery compose services).
# Built by docker-compose.yml (`context: .`, `dockerfile: Dockerfile`).
#
# This is the "dev sandbox": a slim, isolated runtime for the application.
# Source code is bind-mounted into /sandbox/ai-code-evaluation-platform at
# runtime (hot reload); Python dependencies are baked into /opt/backend-venv at
# build time so the bind mount (which shadows
# /sandbox/ai-code-evaluation-platform) cannot hide them. Frontend dependencies
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
WORKDIR /sandbox/ai-code-evaluation-platform

# Bake backend dependencies into /opt/backend-venv (NOT
# /sandbox/ai-code-evaluation-platform/backend/.venv: the workspace bind mount
# shadows /sandbox/ai-code-evaluation-platform at runtime, and venv interpreter
# symlinks are path-specific, so the baked venv must live outside
# /sandbox/ai-code-evaluation-platform). The bind-mounted source at runtime
# stays in sync with this lockfile via `uv sync` whenever
# pyproject.toml/uv.lock change.
# All build steps above run as root; the runtime user created further down takes
# ownership of this venv, so the runtime `uv sync` guard in dev-entrypoint.sh
# and the celery/beat services can still refresh it.
ENV UV_PROJECT_ENVIRONMENT=/opt/backend-venv
COPY backend/ /sandbox/ai-code-evaluation-platform/backend/
RUN cd /sandbox/ai-code-evaluation-platform/backend && uv sync

# --- Runtime (non-root) user -------------------------------------------------
# The workspace is bind-mounted from the host, so anything the containers write
# lands on the host with the container's UID. Running as root therefore leaves
# every build artifact, __pycache__ dir and agent edit owned by root:root — the
# host user then sees "locked" (unwritable) files in their editor, and git
# inside the sandbox refuses to operate ("dubious ownership"). The Makefile
# exports HOST_UID/HOST_GID (the host's `id -u`/`id -g`, NOT bash's read-only,
# non-exported `UID`) and docker-compose.yml passes them to both these build
# args and the `user:` directive, so the container matches the host user.
ARG USER_NAME=devuser
ARG USER_ID=1000
ARG GROUP_ID=1000
ENV DEV_USER=${USER_NAME}
ENV HOME=/home/${USER_NAME}
# The runtime user owns the baked venv and its home (caches/config the agent
# and tooling expect), so the runtime `uv sync`/`npm ci` paths work.
#
# The group/user creation is conditional: a future base image (or a host whose
# UID/GID already exists in it) must not fail the build — we then reuse the
# existing id and still guarantee the home directory exists and is owned by the
# runtime uid. The system-level safe.directory only matters when the image was
# built with different build args than the UID it runs as: normally the bind
# mount is owned by the same UID as the caller and git is happy without it.
RUN if ! getent group ${GROUP_ID} >/dev/null; then groupadd --gid ${GROUP_ID} ${USER_NAME}; fi \
    && if ! getent passwd ${USER_ID} >/dev/null; then \
         useradd --uid ${USER_ID} --gid ${GROUP_ID} --create-home --shell /usr/bin/zsh ${USER_NAME}; \
       fi \
    && mkdir -p /home/${USER_NAME} \
    && chown -R ${USER_ID}:${GROUP_ID} /home/${USER_NAME} /opt/backend-venv \
    && git config --system --add safe.directory /sandbox/ai-code-evaluation-platform

# Caches live in /tmp (container-local, always writable) rather than the
# baked-in home, so a container started with a different runtime UID than the
# build args can still `uv sync` / `npm ci` without a permission error.
RUN mkdir -p /tmp/uv-cache /tmp/npm-cache
ENV UV_CACHE_DIR=/tmp/uv-cache
ENV NPM_CONFIG_CACHE=/tmp/npm-cache

# Install dev sandbox shell config (prompt + terminal title indicators). The
# script is shell-aware (bash + zsh) and sourced from the rc files below.
COPY scripts/dev-sandbox-rc.sh /etc/profile.d/00-dev-sandbox.sh

# Make zsh the default interactive shell for the sandbox (bash stays installed
# for scripts/entrypoints, which carry their own shebangs). Tolerates the
# uid-collision case above, where the login name may differ.
RUN chsh -s /usr/bin/zsh ${USER_NAME} 2>/dev/null || true

# Sandbox prompt/title config for BOTH the runtime user and root (keep root
# usable for `docker compose exec -u root` debugging).
#
# zsh startup files:
#   ~/.zshrc    — interactive shells (make shell / dev-exec / docker exec -it)
#   ~/.zprofile — login shells (zsh -lc from `make opencode` sets the title)
# bash: interactive non-login shells (docker compose exec -it dev bash)
RUN SANDBOX_RC='\n# Load dev sandbox configuration\n[ -f /etc/profile.d/00-dev-sandbox.sh ] && . /etc/profile.d/00-dev-sandbox.sh\n' \
    && for rc in /root/.bashrc /root/.zshrc /root/.zprofile \
                "/home/${USER_NAME}/.bashrc" "/home/${USER_NAME}/.zshrc" "/home/${USER_NAME}/.zprofile"; do \
        printf '%b' "$SANDBOX_RC" >> "$rc"; \
    done \
    && chown ${USER_ID}:${GROUP_ID} \
        "/home/${USER_NAME}/.bashrc" "/home/${USER_NAME}/.zshrc" "/home/${USER_NAME}/.zprofile"

# Default to the non-root user so a service added to docker-compose.yml without
# a `user:` directive can't silently reintroduce root-owned workspace files.
# Compose still pins the exact UID/GID via `user:`; root remains available for
# debugging with `docker compose exec -u root`.
USER ${USER_NAME}

# Keep the container alive when started without an explicit command; the dev
# and celery compose services override this with their real entrypoints.
CMD ["sleep", "infinity"]