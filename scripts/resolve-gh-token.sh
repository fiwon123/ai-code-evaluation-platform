#!/bin/bash
# resolve-gh-token.sh — print a GitHub token that actually works, or nothing.
#
# The dev sandbox needs a *valid* token to let the sandboxed agent push and
# open PRs, and the token has to reach the container by environment variable
# (docker-compose.yml forwards GH_TOKEN/GITHUB_TOKEN; `gh` prefers those names
# over its credential store). Two things went wrong with relying on whatever
# happened to be in the operator's shell:
#
#   1. `gh auth login` writes the token to the gh credential store, NOT to the
#      environment. An operator who logged in but never exported GH_TOKEN got
#      an empty value forwarded, so `gh` inside the container had nothing to
#      work with.
#   2. A *stale* GH_TOKEN left over in a shell profile is worse than none:
#      because gh checks GH_TOKEN before the store, a revoked token silently
#      shadows the fresh one `gh auth login` just wrote, and every call fails
#      with 401 Bad credentials. Forwarding a token that does not work is
#      strictly worse than forwarding none.
#
# So: probe each candidate with a real authenticated call, and emit a token
# only once it is proven good. When nothing works we print NOTHING, which
# leaves gh inside the sandbox to fall back to the read-only
# ~/.config/gh mount — the correct outcome rather than a guaranteed 401.
#
# Contract:
#   - stdout: a validated token, or empty. Nothing else, ever.
#   - stderr: human-readable diagnostics (never a token).
#   - exit 0 in all cases, so callers can use `$(...)` without guarding.
#   - never reads or writes a token file itself; it only asks `gh`.
#
# Usage:  scripts/resolve-gh-token.sh          # host: export before compose

# Deliberately no `set -e`: a missing/broken `gh` must not abort the caller.
# `set -u` stays on so an unset variable is a loud bug, not an empty string.
set -uo pipefail

# How long any single gh call may take, in seconds.
#
# This bound is not defensive polish, it is load-bearing: the Makefile calls
# this script from a `$(shell ...)` at *parse* time, so it runs before make
# decides which target you asked for. An unbounded `gh api user` therefore
# blocks EVERY target — `make help`, `make lint`, anything — for as long as the
# network takes to fail, which on a blackholed connection is minutes. A 5s cap
# keeps the normal case (~0.3s) and makes the pathological case merely slow.
# Override with GH_TOKEN_PROBE_TIMEOUT=... when a slow link needs more room.
PROBE_TIMEOUT="${GH_TOKEN_PROBE_TIMEOUT:-5}"

# Run gh under a wall-clock bound where the platform provides one. Stock macOS
# has no coreutils `timeout`, so degrade to an unbounded call rather than
# failing outright — but say so, because the unbounded path is exactly the hang
# this function exists to prevent.
gh_bounded() {
    if command -v timeout >/dev/null 2>&1; then
        timeout "$PROBE_TIMEOUT" "$@"
    else
        echo "[gh-token] no 'timeout' command; gh calls are unbounded" >&2
        "$@"
    fi
}

# A token is "valid" if it can make one authenticated call. `gh api user` is
# the cheapest endpoint that still requires a working credential.
probe() {
    local candidate="$1"
    [ -n "$candidate" ] || return 1
    GH_TOKEN="$candidate" GITHUB_TOKEN="$candidate" \
        gh_bounded gh api user -q .login >/dev/null 2>&1
}

# 1. Tokens already exported on the host (shell profile, or CI).
for candidate in "${GH_TOKEN:-}" "${GITHUB_TOKEN:-}"; do
    if probe "$candidate"; then
        printf '%s' "$candidate"
        exit 0
    fi
done
[ -n "${GH_TOKEN:-}" ] && echo "[gh-token] exported GH_TOKEN is stale or invalid; ignoring it" >&2

# 2. The gh credential store, i.e. whatever `gh auth login` wrote. Unset the
#    env names first: `gh auth token` otherwise reports the active account
#    from the environment, which is the stale value we just rejected.
if command -v gh >/dev/null 2>&1; then
    # Unset in a subshell, not with `env -u`: `env` execs a program and cannot
    # see the gh_bounded shell function.
    candidate="$( unset GH_TOKEN GITHUB_TOKEN; gh_bounded gh auth token 2>/dev/null || true )"
    if probe "$candidate"; then
        printf '%s' "$candidate"
        exit 0
    fi
    if [ -n "$candidate" ]; then
        echo "[gh-token] stored gh token is stale or invalid; run 'gh auth login' on the host" >&2
    fi
fi

# 3. Nothing usable. Print nothing: the caller leaves GH_TOKEN unset and gh
#    inside the sandbox falls back to the read-only ~/.config/gh mount.
echo "[gh-token] no working GitHub token found; gh in the sandbox will use ~/.config/gh" >&2
exit 0
