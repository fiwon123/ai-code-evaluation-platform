FROM python:3.14-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

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
