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

# Set working directory
WORKDIR /workspace

# Copy backend files
COPY backend/ /workspace/backend/

# Install backend dependencies
RUN cd /workspace/backend && uv sync

# Set default command
CMD ["sleep", "infinity"]
