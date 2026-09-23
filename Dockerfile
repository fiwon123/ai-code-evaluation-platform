# Dev-container image for the AI Code Evaluation Platform (backend service).
# Built by the root docker-compose.yml (`context: .`, `dockerfile: Dockerfile`).

FROM python:3.14-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI (pinned release tarball — replaces the ghcr.io devcontainer
# feature whose OCI layer fetch is flaky at container-creation time; also keeps
# the base image slim). Bump GH_CLI_VERSION deliberately when updating.
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
# container-creation time, same as the gh CLI install above). Node 22 must
# match the frontend service image (javascript-node:22) and what the
# postCreateCommand's `npm install` needs. Bump NODE_VERSION deliberately.
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

# Copy backend files
COPY backend/ /workspace/backend/

# Install backend dependencies
RUN cd /workspace/backend && uv sync

# Set default command
CMD ["sleep", "infinity"]
