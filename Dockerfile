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

# --- Playwright Chromium (the e2e suite's browser) -----------------------------
# frontend/e2e/ is a 6-spec Playwright suite that can only be exercised against
# a real rendered browser (contrast is computed from pixels, the WebSocket spec
# needs a real page). It has to be baked here because there is no way to install
# it later: the runtime user below is non-root with no sudo, and Chromium's
# system libraries come from apt.
#
# This layer MUST stay above `USER devuser` — that is the whole reason it is a
# build step rather than a container-startup step. The smoke check inside it runs
# as root, hence --no-sandbox (Chromium refuses to enable its setuid sandbox
# for uid 0); the second check below the USER directive repeats the launch as the
# non-root user the suite really uses.
#
# PLAYWRIGHT_VERSION must equal the resolved `@playwright/test` in
# frontend/package-lock.json: browsers are revision-locked, so a mismatched
# ARG yields "Executable doesn't exist" at runtime instead of a launch failure
# you can read. backend/tests/test_dev_sandbox_playwright.py enforces it.
#
# Browsers land in /ms-playwright, NOT in the workspace: /sandbox/
# ai-code-evaluation-platform is bind-mounted over at runtime, so anything
# downloaded there would be shadowed (and would dirty the host checkout).
ARG PLAYWRIGHT_VERSION=1.63.0
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npm install --global --no-fund --no-audit "playwright@${PLAYWRIGHT_VERSION}" \
    && npx --yes playwright install --with-deps chromium \
    # Download-only verification is worthless: the failure this guards against
    # is a browser that is present but cannot start (missing shared library),
    # which `playwright install` reports as success. So actually launch it.
    # NODE_PATH is what makes the globally installed module resolvable from the
    # workspace cwd; without it `require('playwright')` throws MODULE_NOT_FOUND.
    && NODE_PATH="$(npm root --global)" node -e "require('playwright').chromium.launch({args:['--no-sandbox']}).then(b => b.close()).then(() => console.log('chromium build-time launch OK')).catch(e => { console.error(e); process.exit(1); })" \
    # The CLI is only needed to fetch the browser; the suite resolves its own
    # copy from the bind-mounted frontend/node_modules. Dropping it keeps a
    # second, drift-prone playwright out of the image.
    && npm uninstall --global playwright \
    && rm -rf /root/.npm \
    # Readable by any runtime UID: a container may run as a different user than
    # the build args, and the browser is useless if it cannot be executed.
    && chmod -R a+rX /ms-playwright

# --- Runtime (non-root) user -------------------------------------------------
# The workspace is bind-mounted from the host, so anything the containers write
# lands on the host with the container's UID. Running as root therefore leaves
# every build artifact, __pycache__ dir and agent edit owned by root:root — the
# host user then sees "locked" (unwritable) files in their editor, and git
# inside the sandbox refuses to operate ("dubious ownership"). The Makefile
# exports HOST_UID/HOST_GID (the host's `id -u`/`id -g`, NOT bash's read-only,
# non-exported `UID`) and docker-compose.yml passes them to both these build
# args and the `user:` directive, so the container matches the host user.
#
# The account NAME is deliberately NOT a build arg: docker-compose.yml pins
# HOME and the host-config mount targets to /home/devuser, so a configurable
# name could only ever drift away from what the running container expects (the
# build would succeed and the agent/gh config would land in an unreadable
# home). The *ids* are the variable part and mirror the host user.
ENV DEV_USER=devuser
ENV HOME=/home/devuser
ARG USER_ID=1000
ARG GROUP_ID=1000
# The runtime user owns the baked venv and its home (caches/config the agent
# and tooling expect), so the runtime `uv sync`/`npm ci` paths work.
#
# The group/user creation is conditional: a future base image (or a host whose
# UID/GID already exists in it) must not fail the build — we then reuse the
# existing id and still guarantee the home directory exists and is owned by the
# runtime uid. The system-level safe.directory only matters when the image was
# built with different build args than the UID it runs as: normally the bind
# mount is owned by the same UID as the caller and git is happy without it.
#
# Because creation is conditional, the account can still be missing at the end
# (uid already taken by another name, or a group already named `devuser`), and
# `USER devuser` below is resolved BEFORE dev-entrypoint.sh's passwd fallback
# ever runs — so verify here, at build time, where the error can be readable.
RUN if ! getent group ${GROUP_ID} >/dev/null; then groupadd --gid ${GROUP_ID} devuser; fi \
    && if ! getent passwd ${USER_ID} >/dev/null; then \
         useradd --uid ${USER_ID} --gid ${GROUP_ID} --create-home --shell /usr/bin/zsh devuser; \
       fi \
    && { getent passwd devuser >/dev/null \
         || { echo "ERROR: uid ${USER_ID} is already used by another account, so 'devuser' cannot be created. Rebuild for a different host uid (make dev-build)." >&2; exit 1; }; } \
    && mkdir -p /home/devuser \
    && chown -R ${USER_ID}:${GROUP_ID} /home/devuser /opt/backend-venv \
    && git config --system --add safe.directory /sandbox/ai-code-evaluation-platform

# Caches live in /tmp (container-local) rather than in the baked-in home, so a
# container started with a different runtime UID than the build args can still
# `uv sync` / `npm ci`.
#
# They are chowned AND left 1777 on purpose: a root-owned 0755 cache dir is NOT
# writable by the non-root user the entrypoint/celery/beat run as, which broke
# the dependency bootstrap on a fresh workspace (node_modules absent) with
# `uv: Could not create temporary file ... Permission denied` and
# `npm: sudo chown -R 1000:1000 /tmp/npm-cache`. The chown gives sane ownership
# for the normal matching-UID case; 1777 keeps the "different UID than the build
# args" case working too.
RUN mkdir -p /tmp/uv-cache /tmp/npm-cache \
    && chown ${USER_ID}:${GROUP_ID} /tmp/uv-cache /tmp/npm-cache \
    && chmod 1777 /tmp/uv-cache /tmp/npm-cache
ENV UV_CACHE_DIR=/tmp/uv-cache
ENV NPM_CONFIG_CACHE=/tmp/npm-cache

# Install dev sandbox shell config (prompt + terminal title indicators). The
# script is shell-aware (bash + zsh) and sourced from the rc files below.
COPY scripts/dev-sandbox-rc.sh /etc/profile.d/00-dev-sandbox.sh

# Make zsh the default interactive shell for the sandbox (bash stays installed
# for scripts/entrypoints with their own shebangs). `|| true` tolerates images
# where the shell cannot be changed (read-only /etc/passwd), not a missing
# account — that case already failed above.
RUN chsh -s /usr/bin/zsh devuser 2>/dev/null || true

# Prefer IPv6 when a name resolves to both families (issue #270).
#
# docker-compose.yml gives the network `enable_ipv6: true`, which is what makes
# an IPv6 *address* exist in the first place — without it the container has no
# v6 route and `[Errno 101] Network is unreachable` is the only possible result.
# This layer is the other half: a container holding both addresses still dials
# whichever getaddrinfo returns first, and Debian's /etc/gai.conf ships
# `precedence ::ffff:0:0/96 100`, which sorts IPv4 first. Groq's edge answers
# 403 over IPv4 and 401 (i.e. reaches auth) over IPv6, so the default order sent
# every generation request to the family that refuses it, and the failure was
# indistinguishable from a wrong API key.
#
# The file carries the reasoning; keep the two in step. It is applied to the dev
# image only — the air-gapped eval sandbox (backend/Dockerfile.sandbox) must
# never get outbound IPv6.
COPY docker/gai.conf /etc/gai.conf

# Sandbox prompt/title config for BOTH the runtime user and root (keep root
# usable for `docker compose exec -u root` debugging).
#
# zsh startup files:
#   ~/.zshrc    — interactive shells (make shell / dev-exec / docker exec -it)
#   ~/.zprofile — login shells (zsh -lc from `make opencode` sets the title)
# bash: interactive non-login shells (docker compose exec -it dev bash)
RUN SANDBOX_RC='\n# Load dev sandbox configuration\n[ -f /etc/profile.d/00-dev-sandbox.sh ] && . /etc/profile.d/00-dev-sandbox.sh\n' \
    && for rc in /root/.bashrc /root/.zshrc /root/.zprofile \
                /home/devuser/.bashrc /home/devuser/.zshrc /home/devuser/.zprofile; do \
        printf '%b' "$SANDBOX_RC" >> "$rc"; \
    done \
    && chown ${USER_ID}:${GROUP_ID} \
        /home/devuser/.bashrc /home/devuser/.zshrc /home/devuser/.zprofile

# Default to the non-root user so a service added to docker-compose.yml without
# a `user:` directive can't silently reintroduce root-owned workspace files.
# Compose still pins the exact UID/GID via `user:`; root remains available for
# debugging with `docker compose exec -u root`.
USER devuser

# The Chromium install above is verified as root; verify it again as the user the
# e2e suite actually runs as. --no-sandbox here is deliberate and matches the
# `chromiumSandbox: false` default in frontend/playwright.config.ts (inside
# `use.launchOptions` — it is a launch option, not a `use` option) — see the long
# note there for why the suite runs unsandboxed. Keeping the two in step is what
# makes this check meaningful: a build that verified a *sandboxed* launch would
# pass on a host whose Docker seccomp allows user namespaces and fail on one that
# does not, so the image would not be reproducible.
#
# What this second check does add, and why it is worth its own layer: it proves
# the runtime uid can EXECUTE the browser and resolve every shared library. That
# is the failure that actually happens (exit 127 on a missing libglib), it is
# uid-sensitive, and it is exactly what the `a+rX /ms-playwright` above and this
# image's filesystem layout are responsible for. A download-only check, or a
# check run as root, would pass on an image whose browser cannot start.
RUN CHROME="$(ls -d /ms-playwright/chromium-*/chrome-linux*/chrome | head -1)" \
    && test -n "$CHROME" \
    && { [ "${CHROMIUM_SANDBOX:-0}" = "1" ] || printf '%s\n' '--no-sandbox'; } > /tmp/pw-args \
    && "$CHROME" --headless --no-first-run --disable-gpu "$(cat /tmp/pw-args)" --dump-dom about:blank > /dev/null \
    && echo "chromium runtime-user launch OK"

# Keep the container alive when started without an explicit command; the dev
# and celery compose services override this with their real entrypoints.
CMD ["sleep", "infinity"]
