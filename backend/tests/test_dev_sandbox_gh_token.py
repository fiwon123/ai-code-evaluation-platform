"""Behaviour of GitHub-auth resolution for the dev sandbox.

The sandboxed agent pushes branches and opens PRs with `gh`, which reaches its
credential through the environment (docker-compose.yml forwards GH_TOKEN /
GITHUB_TOKEN) and through the read-only ~/.config/gh mount. Two failure modes
were observed, and both are silent from inside the container:

  1. `gh auth login` writes the token to the gh *credential store*, not to the
     environment, so an operator who logged in but never exported GH_TOKEN
     forwarded an empty value and `gh` had no usable credential.
  2. A stale GH_TOKEN left in a shell profile *shadowed* the fresh token that
     `gh auth login` had just written — `gh` checks the env name first — so
     every call failed with 401 Bad credentials even though the host had
     completed a successful login.

scripts/resolve-gh-token.sh exists to close both: it probes candidates with a
real authenticated call and prints a token only once it is proven good, printing
nothing when there is none so that `gh` falls back to the mounted store.

These tests execute the resolver against a stub `gh` on a controlled PATH, so
they assert real behaviour rather than string-matching a script nobody runs.
The stub is unreachable to the real `gh`, and HOME is redirected, so no test
can read or depend on the developer's actual credentials.
"""

import re
import subprocess
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
COMPOSE_FILE = REPO_ROOT / "docker-compose.yml"
MAKEFILE = REPO_ROOT / "Makefile"
SANDBOX_SCRIPT = REPO_ROOT / "scripts/open-in-sandbox.sh"
RESOLVER = REPO_ROOT / "scripts" / "resolve-gh-token.sh"

VALID = "ghp_validtoken0000000000000000000000000"
STALE = "ghp_staletoken1111111111111111111111111"

# A stub `gh` that treats exactly FAKE_VALID_TOKEN as working, so a test can
# decide which of the candidates is the good one. It also mirrors real gh in
# letting an exported GH_TOKEN override the credential store — that precedence
# is the whole reason the resolver has to clear the environment before asking
# the store for a token, so the stub must not paper over it.
STUB_GH = """#!/bin/bash
if [ "$1" = "auth" ] && [ "$2" = "token" ]; then
    if [ -n "${GH_TOKEN:-}" ]; then
        printf '%s' "$GH_TOKEN"
        exit 0
    fi
    printf '%s' "${FAKE_STORED_TOKEN:-}"
    exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "user" ]; then
    if [ "${GH_TOKEN:-}" = "${FAKE_VALID_TOKEN:-__none__}" ]; then
        printf 'fakeuser'
        exit 0
    fi
    printf '{"message":"Bad credentials"}' >&2
    exit 1
fi
exit 1
"""


def _run_resolver(tmp_path, *, env_token="", github_token="", stored_token="", valid_token=VALID):
    """Run the resolver with a stub `gh`; return (stdout, stderr, returncode)."""
    stub_dir = tmp_path / "stubbin"
    stub_dir.mkdir(exist_ok=True)
    stub = stub_dir / "gh"
    stub.write_text(STUB_GH)
    stub.chmod(0o755)

    env = {
        "PATH": f"{stub_dir}:/usr/bin:/bin",
        "HOME": str(tmp_path),
        "FAKE_VALID_TOKEN": valid_token,
        "FAKE_STORED_TOKEN": stored_token,
    }
    if env_token:
        env["GH_TOKEN"] = env_token
    if github_token:
        env["GITHUB_TOKEN"] = github_token

    # subprocess.run(env=...) replaces the entire environment, so the
    # developer's real credentials cannot reach the resolver. Assert that rather
    # than assume it: a leaked GH_TOKEN here would decide what these tests
    # claim to prove, and an absent one must stay absent for the fall-through
    # cases to mean anything.
    assert env.get("GH_TOKEN", "") == env_token
    for leaked in ("GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN", "GIT_ASKPASS"):
        assert leaked not in env

    proc = subprocess.run(  # noqa: S603 - fixed argv, stubbed PATH
        [str(RESOLVER)],
        capture_output=True,
        text=True,
        env=env,
        timeout=30,
        check=False,
    )
    return proc.stdout, proc.stderr, proc.returncode


class TestResolverBehaviour:
    def test_valid_exported_token_is_forwarded(self, tmp_path):
        # The happy path: the operator already exported a working token.
        out, _, code = _run_resolver(tmp_path, env_token=VALID)
        assert out == VALID
        assert code == 0

    def test_stale_exported_token_falls_back_to_credential_store(self, tmp_path):
        # The regression that produced the 401: a revoked token in the shell
        # must not shadow the one `gh auth login` just wrote.
        out, err, code = _run_resolver(tmp_path, env_token=STALE, stored_token=VALID)
        assert out == VALID
        assert "stale" in err.lower()
        assert code == 0

    def test_store_is_used_when_nothing_is_exported(self, tmp_path):
        # `gh auth login` writes to the store, not the environment, so this is
        # the path that makes a plain login work at all.
        out, _, code = _run_resolver(tmp_path, stored_token=VALID)
        assert out == VALID
        assert code == 0

    def test_valid_github_token_env_is_used_when_gh_token_is_stale(self, tmp_path):
        # Only one of the two env names is set, and it is the second one that
        # works. Skipping straight to the store would be wrong here: the store
        # is empty, and a resolver that only ever looked at GH_TOKEN would
        # report no token for a host that has a perfectly good one exported.
        out, _, code = _run_resolver(tmp_path, env_token=STALE, github_token=VALID)
        assert out == VALID
        assert code == 0

    def test_nothing_usable_prints_nothing(self, tmp_path):
        # Emitting a token that cannot authenticate is worse than emitting
        # none: an empty value lets gh fall back to the ~/.config/gh mount,
        # whereas a stale value guarantees 401 for every call.
        out, err, code = _run_resolver(tmp_path, env_token=STALE, stored_token=STALE)
        assert out == ""
        assert "no working github token" in err.lower()
        assert code == 0

    def test_missing_gh_is_not_fatal(self, tmp_path):
        # A host without gh (or a broken PATH) must not break `make`; the
        # Makefile calls this from a $(shell ...).
        env = {"PATH": str(tmp_path / "empty"), "HOME": str(tmp_path)}
        proc = subprocess.run(  # noqa: S603 - fixed argv
            [str(RESOLVER)], capture_output=True, text=True, env=env, timeout=30, check=False
        )
        assert proc.returncode == 0
        assert proc.stdout == ""

    def test_token_never_leaks_to_stderr(self, tmp_path):
        # Diagnostics are for humans; a token on stderr would end up in CI logs.
        _, err, _ = _run_resolver(tmp_path, env_token=STALE, stored_token=VALID)
        assert VALID not in err
        assert STALE not in err

    def test_hanging_gh_is_bounded(self, tmp_path):
        # The regression: the Makefile runs the resolver from a `$(shell ...)`
        # at parse time, so an unbounded `gh api user` blocks every make target
        # for as long as the network takes to give up. A gh that never returns
        # must be abandoned, printing nothing (a timeout is not a valid token).
        stub_dir = tmp_path / "hangbin"
        stub_dir.mkdir()
        (stub_dir / "gh").write_text("#!/bin/bash\nsleep 120\n")
        (stub_dir / "gh").chmod(0o755)

        env = {
            "PATH": f"{stub_dir}:/usr/bin:/bin",
            "HOME": str(tmp_path),
            "GH_TOKEN": STALE,
            "GH_TOKEN_PROBE_TIMEOUT": "1",
        }
        started = time.monotonic()
        proc = subprocess.run(  # noqa: S603 - fixed argv, stubbed PATH
            [str(RESOLVER)], capture_output=True, text=True, env=env, timeout=30, check=False
        )
        elapsed = time.monotonic() - started

        assert proc.returncode == 0
        assert proc.stdout == ""
        # Two bounded gh calls (the probe, then the store lookup) at 1s each.
        # The cap is deliberately loose so a loaded CI box does not flake.
        assert elapsed < 20, f"resolver took {elapsed:.1f}s against a hanging gh"

    def test_script_does_not_read_a_token_file(self, tmp_path):
        # The resolver must ask `gh` rather than parsing hosts.yml itself, so
        # that gh's own precedence rules stay in one place.
        text = RESOLVER.read_text()
        assert "hosts.yml" not in text
        assert "oauth_token" not in text


class TestTokenPlumbingContract:
    """The wiring around the resolver — Makefile, compose and the sandbox script."""

    def test_compose_forwards_both_token_names(self):
        # gh checks GH_TOKEN first; GITHUB_TOKEN is the Actions convention
        # other tooling reads. Forwarding only one breaks half the callers.
        text = COMPOSE_FILE.read_text()
        assert "GH_TOKEN=${GH_TOKEN:-}" in text
        assert "GITHUB_TOKEN=${GITHUB_TOKEN:-}" in text

    def test_compose_does_not_hardcode_a_token(self):
        # Interpolation only: a literal token in a committed file would leak.
        for line in COMPOSE_FILE.read_text().splitlines():
            if re.match(r"\s*-\s*(GH_TOKEN|GITHUB_TOKEN)=", line):
                assert re.match(r"\s*-\s*(GH_TOKEN|GITHUB_TOKEN)=\$\{\w+:?[-=]\}", line), line

    def test_makefile_resolves_and_exports(self):
        text = MAKEFILE.read_text()
        assert "scripts/resolve-gh-token.sh" in text
        # `:=` not `?=`: an exported-but-stale token must be replaced by the
        # validated one, not preserved.
        assert re.search(r"^GH_TOKEN :=", text, re.MULTILINE)
        assert not re.search(r"^GH_TOKEN \?=", text, re.MULTILINE)

    def test_makefile_exports_only_when_non_empty(self):
        # An exported-but-empty GH_TOKEN is worse than an absent one, because
        # compose still interpolates a value for it.
        text = MAKEFILE.read_text()
        assert re.search(r"ifneq\s*\(\$\(strip \$\(GH_TOKEN\)\),\)", text)
        assert re.search(r"^export GH_TOKEN GITHUB_TOKEN", text, re.MULTILINE)

    def test_sandbox_script_resolves_token(self):
        # open-in-sandbox.sh calls `docker compose` itself, so it needs the same
        # resolution as the Makefile or the agent loses auth on that path.
        text = SANDBOX_SCRIPT.read_text()
        assert "resolve-gh-token.sh" in text
        assert 'export GH_TOKEN=' in text
        assert 'export GITHUB_TOKEN=' in text

    def test_sandbox_exports_token_before_compose_runs(self):
        # Same ordering guard as the host-identity test: the token has to be in
        # the environment before compose interpolates it. Anchor on the first
        # line that really invokes compose — a guarded `if ! docker compose ps`
        # counts, an `echo` that merely mentions it does not.
        lines = SANDBOX_SCRIPT.read_text().splitlines()
        first_compose = next(
            i
            for i, line in enumerate(lines)
            if "docker compose" in line
            and not line.strip().startswith("#")
            and not line.strip().startswith("echo ")
        )
        first_export = next(i for i, line in enumerate(lines) if "export GH_TOKEN=" in line)
        assert first_export < first_compose, (
            f"GH_TOKEN is exported on line {first_export + 1}, but compose first runs on "
            f"line {first_compose + 1}: {lines[first_compose].strip()}"
        )

    def test_make_still_runs_when_gh_hangs(self, tmp_path):
        """The end-to-end version of the hang, run against the real Makefile.

        The unit test above proves the resolver gives up on gh; this proves the
        consequence that actually mattered: because the Makefile resolves the
        token in a `$(shell ...)` at parse time, an unbounded probe does not
        just slow down the dev targets — it blocks `make help` too, a target with
        no connection to GitHub. Asserted by running make for real, because the
        wiring between the two files is the thing that can silently regress.
        """
        stub_dir = tmp_path / "hangbin"
        stub_dir.mkdir()
        (stub_dir / "gh").write_text("#!/bin/bash\nsleep 120\n")
        (stub_dir / "gh").chmod(0o755)

        env = {
            "PATH": f"{stub_dir}:/usr/bin:/bin",
            "HOME": str(tmp_path),
            "GH_TOKEN": STALE,
            "GH_TOKEN_PROBE_TIMEOUT": "1",
        }
        started = time.monotonic()
        proc = subprocess.run(  # noqa: S603 - fixed argv, -n so no recipe runs
            ["make", "-n", "help"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            env=env,
            timeout=60,
            check=False,
        )
        elapsed = time.monotonic() - started

        assert proc.returncode == 0, proc.stderr
        # `-n` prints the recipe instead of running it; all we need is proof
        # that make resolved the target and got as far as emitting it.
        assert "Makefile" in proc.stdout
        assert elapsed < 30, f"`make help` took {elapsed:.1f}s against a hanging gh"

