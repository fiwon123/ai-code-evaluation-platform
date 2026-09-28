"""The Playwright e2e suite has to be runnable inside the dev sandbox (#229).

`frontend/e2e/` is a 6-spec suite that can only be exercised against a real
rendered browser: the contrast spec computes WCAG ratios from painted pixels, and
the WebSocket spec needs a live page. It used to be unrunnable here — the image
had no browser, `npx playwright install` cannot fix that at runtime (the sandbox
runs as a non-root user with no sudo, and Chromium's system libraries come from
apt), and CI alone could run it.

The fix was to bake Chromium into the dev image (see `Dockerfile`) and add
`make test-e2e`. That is only worth anything if the bake keeps working, which
rests on three things that can each rot silently:

  1. **Version sync.** Browsers are revision-locked per Playwright release, so an
     `ARG PLAYWRIGHT_VERSION` that drifts from the resolved `@playwright/test` in
     the lockfile does not fail at build time — it fails at *runtime*, as
     "Executable doesn't exist at /ms-playwright/chromium-XXXX/chrome-linux64".
  2. **Layer ordering.** The install must stay above `USER devuser`; below it
     there is no root, no sudo and no apt.
  3. **The browser still starts.** `playwright install` reports success for a
     download that cannot launch (a missing shared library looks exactly like a
     successful install), so the image itself launches Chromium at build time and
     these tests launch it again as the runtime user.

The tests that need a browser skip when there is none, so a host-native checkout
and CI still get the structural guarantees without a 300 MB download.
"""

import json
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
DOCKERFILE = REPO_ROOT / "Dockerfile"
PACKAGE_LOCK = REPO_ROOT / "frontend" / "package-lock.json"
MAKEFILE = REPO_ROOT / "Makefile"
FRONTEND_DIR = REPO_ROOT / "frontend"

# Where docker-compose.yml bind-mounts the workspace into the containers. A
# browser unpacked under it would be shadowed by the mount at runtime and would
# dirty the host checkout.
BIND_MOUNT = "/sandbox/ai-code-evaluation-platform"


def _browsers_dir() -> str | None:
    """The Playwright browser cache this environment would use, if any."""
    configured = os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "").strip()
    candidates = [configured] if configured else []
    candidates.append(str(Path.home() / ".cache" / "ms-playwright"))
    for path in candidates:
        if path and Path(path).is_dir():
            return path
    return None


needs_browser = pytest.mark.skipif(
    _browsers_dir() is None or shutil.which("node") is None,
    reason="no Playwright browser cache here (run `make dev-build`, or "
    "`npx playwright install chromium`)",
)

# Reads the config the way Playwright does: import it and look at what the
# option actually resolved to. Node can strip the types directly (22.6+), so no
# extra toolchain is needed; the value is printed rather than returned so the
# child process can fail loudly instead of hanging.
_CONFIG_PROBE = (
    "import('./playwright.config.ts').then(m => "
    "console.log(JSON.stringify(m.default.use.launchOptions ?? {})))"
)


def _load_launch_options(env_overrides: dict[str, str] | None = None) -> dict | None:
    """`use.launchOptions` as Playwright will see it, or None if node cannot.

    The returned dict is empty when the config really has no launch options —
    which is itself a finding, and is why callers must assert on the key rather
    than on the dict being non-empty.
    """
    if shutil.which("node") is None:
        return None
    env = {k: v for k, v in os.environ.items() if k != "CHROMIUM_SANDBOX"}
    env.update(env_overrides or {})
    proc = subprocess.run(  # noqa: S603 - fixed argv, literal script
        ["node", "--experimental-strip-types", "-e", _CONFIG_PROBE],
        cwd=FRONTEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    if proc.returncode != 0:
        return None
    try:
        loaded = json.loads(proc.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        return None
    return loaded if isinstance(loaded, dict) else None


class TestBrowserBake:
    """The Dockerfile layer that puts a working Chromium in the image."""

    def test_version_arg_matches_the_lockfile(self):
        # The invariant the whole bake rests on: `npm install playwright@X` and
        # the `@playwright/test` the suite actually runs must be the same
        # release, or the baked browser is a revision the suite never asks for.
        match = re.search(
            r"^ARG PLAYWRIGHT_VERSION=(\S+)$", DOCKERFILE.read_text(), re.MULTILINE
        )
        assert match, "Dockerfile has no `ARG PLAYWRIGHT_VERSION=...` line"

        lock = json.loads(PACKAGE_LOCK.read_text())
        locked = lock["packages"]["node_modules/@playwright/test"]["version"]
        assert match.group(1) == locked, (
            f"Dockerfile bakes Playwright {match.group(1)} but the lockfile resolves "
            f"@playwright/test {locked}; the browser revision will not match and every "
            f"launch fails with 'Executable doesn't exist'"
        )

    def test_version_arg_is_exact_not_a_range(self):
        # A caret/tilde here resolves to "whatever is newest at build time",
        # which is the drift this test above exists to prevent — silently, and
        # only for images built after someone edited the lockfile.
        match = re.search(
            r"^ARG PLAYWRIGHT_VERSION=(\S+)$", DOCKERFILE.read_text(), re.MULTILINE
        )
        assert match
        assert re.fullmatch(r"\d+\.\d+\.\d+", match.group(1)), (
            f"PLAYWRIGHT_VERSION={match.group(1)} is not an exact version"
        )

    def test_browsers_live_outside_the_bind_mounted_workspace(self):
        # /sandbox/ai-code-evaluation-platform is bind-mounted over at runtime,
        # so a browser downloaded into the workspace would be hidden by the
        # mount (and would show up in the developer's git status).
        match = re.search(
            r"^ENV PLAYWRIGHT_BROWSERS_PATH=(\S+)$", DOCKERFILE.read_text(), re.MULTILINE
        )
        assert match, "Dockerfile does not set PLAYWRIGHT_BROWSERS_PATH"
        path = match.group(1)
        assert path.startswith("/"), path
        assert not path.startswith(BIND_MOUNT), (
            f"PLAYWRIGHT_BROWSERS_PATH={path} is inside the bind-mounted workspace"
        )

    def test_install_precedes_the_runtime_user(self):
        # The layer has to run as root: `playwright install --with-deps` needs
        # apt, and the runtime user has neither. Below `USER devuser` the same
        # command would fail at build time, so this ordering is load-bearing
        # rather than stylistic.
        lines = DOCKERFILE.read_text().splitlines()
        installs = [i for i, line in enumerate(lines) if "playwright install" in line]
        users = [i for i, line in enumerate(lines) if line.strip() == "USER devuser"]
        assert installs, "Dockerfile no longer installs the Playwright browser"
        assert users, "Dockerfile no longer switches to the non-root runtime user"
        # Assert on the region, not just the ordering: a slice that silently
        # becomes empty must fail loudly rather than pass a vacuous comparison.
        assert installs[0] < users[0], (
            f"the Playwright install (line {installs[0] + 1}) is below `USER devuser` "
            f"(line {users[0] + 1}), so it runs without root or apt"
        )

    @needs_browser
    def test_baked_browser_starts_as_the_runtime_user(self):
        # The failure this catches is the one `playwright install` cannot see:
        # the download succeeds and every launch dies with exit 127 on a missing
        # shared library. Launch the binary the Dockerfile's own check globs for,
        # as the uid running these tests — the same one the suite uses.
        root = Path(_browsers_dir())
        binaries = sorted(root.glob("chromium-*/chrome-linux*/chrome"))
        assert binaries, f"no chromium binary under {root}"
        binary = binaries[0]

        # --headless --dump-dom renders for real and prints the DOM, so an
        # empty stdout would mean "did not render" rather than "did not start".
        proc = subprocess.run(  # noqa: S603 - fixed argv, globbed path under a known root
            [
                str(binary),
                "--headless",
                "--no-first-run",
                "--disable-gpu",
                "--no-sandbox",
                "--dump-dom",
                "about:blank",
            ],
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        assert proc.returncode == 0, (
            f"chromium exited {proc.returncode} as uid {os.getuid()}: "
            f"{proc.stderr[-500:]}"
        )
        assert "<html" in proc.stdout.lower(), f"chromium rendered nothing: {proc.stdout[:200]!r}"

    @needs_browser
    def test_playwright_resolves_that_browser(self):
        """End of the chain: the suite's own Playwright finds the baked browser.

        Version sync and "the binary starts" are each necessary but neither
        proves the two are joined up — a matching ARG with the wrong
        `PLAYWRIGHT_BROWSERS_PATH`, or a cache Playwright does not look in, still
        fails only at launch. This asks @playwright/test to open a page, which
        is what the specs do.
        """
        script = (
            "const { chromium } = require('@playwright/test');"
            "chromium.launch({ args: ['--no-sandbox'] })"
            ".then(async (b) => {"
            "  const p = await (await b.newContext()).newPage();"
            "  await p.setContent('<main>e2e</main>');"
            "  const text = await p.textContent('main');"
            "  await b.close();"
            "  if (text !== 'e2e') { console.error('rendered ' + text); process.exit(1); }"
            "  console.log('ok');"
            "})"
            ".catch((e) => { console.error(String(e).split('\\n').slice(0, 8)"
            ".join(' | ')); process.exit(1); });"
        )
        proc = subprocess.run(  # noqa: S603 - fixed argv, script is a literal
            ["node", "-e", script],
            cwd=FRONTEND_DIR,
            capture_output=True,
            text=True,
            timeout=300,
            check=False,
        )
        assert proc.returncode == 0, (
            f"@playwright/test could not launch the baked browser: {proc.stderr[-800:]}"
        )
        assert "ok" in proc.stdout


class TestE2ETargetWiring:
    """`make test-e2e`: the target developers are told to run."""

    def test_target_exists_and_runs_the_suite(self):
        text = MAKEFILE.read_text()
        assert re.search(r"^test-e2e:.*##", text, re.MULTILINE), (
            "the Makefile has no documented `test-e2e` target"
        )
        proc = subprocess.run(  # noqa: S603 - fixed argv
            ["make", "-n", "test-e2e"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        assert proc.returncode == 0, proc.stderr
        assert "npm run test:e2e" in proc.stdout, proc.stdout

    def test_target_is_advertised_in_help(self):
        # `help` greps `^<target>:.*## `, so a target without the trailing
        # comment is invisible — the exact kind of half-wiring that leaves a
        # suite nobody runs.
        proc = subprocess.run(  # noqa: S603 - fixed argv
            ["make", "help"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        assert proc.returncode == 0, proc.stderr
        assert "test-e2e" in proc.stdout

    def test_check_does_not_run_the_e2e_suite(self):
        # A deliberate decision (#229): `make check` stays lint + vitest + build.
        # If the browser ever does become part of the gate, this test is the
        # reminder to update the docs in the same commit.
        text = MAKEFILE.read_text()
        gate = re.search(r"^check:(.*?)(?=^\S)", text, re.MULTILINE | re.DOTALL)
        assert gate, "the Makefile has no `check` target"
        assert "test-e2e" not in gate.group(1), (
            "the e2e suite is now part of `make check`; update DEVELOPMENT.md and "
            "AGENTS.md to match"
        )

    def test_config_and_image_agree_on_the_sandbox_decision(self):
        # The suite cannot use Chromium's own sandbox in this container (verified
        # in the image: `chromiumSandbox: true` fails with "Chromium sandboxing
        # failed!"), and the image's launch check mirrors the same opt-in. Read
        # the config the way Playwright does instead of grepping it: a
        # `chromiumSandbox` written as a bare `use` key is not a `use` option at
        # all (it is BrowserType.launch()'s), so it type-checks as an error, and
        # if it were JS it would look configured while Playwright ignored it. The
        # polarity matters just as much — `!== "1"` inverts the opt-in and
        # launches the one configuration that cannot work here.
        flag = _load_launch_options()
        if flag is None:
            pytest.skip("node here cannot load a TypeScript config directly")

        assert "chromiumSandbox" in flag, (
            f"use.launchOptions is {flag!r} — chromiumSandbox is missing, so the suite "
            "silently falls back to Playwright's own default instead of the decision "
            "documented in the config"
        )
        assert flag["chromiumSandbox"] is False, (
            "the suite must run Chromium unsandboxed by default; it cannot start its "
            f"own sandbox in this container (config says {flag['chromiumSandbox']!r})"
        )
        opted_in = _load_launch_options({"CHROMIUM_SANDBOX": "1"})
        assert opted_in == {"chromiumSandbox": True}, (
            f"CHROMIUM_SANDBOX=1 must opt back in to the real sandbox, got {opted_in!r}"
        )

        # The build-time and runtime launch checks in the image take the same
        # variable for the same reason, so an image built with the opt-in is
        # verified the way it will actually run.
        dockerfile = DOCKERFILE.read_text()
        assert "CHROMIUM_SANDBOX" in dockerfile, (
            "the image's launch check no longer honours the same opt-in as the config"
        )


# Probes Playwright's own readiness client the way `webServer.url` uses it: an
# IPv4-only listener, then `isURLAvailable` against `localhost`. That is the
# exact fixture from #282 (Vite bound `0.0.0.0`, so `[::1]` was refused) and the
# exact call the `webServer` plugin makes. The control request proves the
# fixture still reproduces the defect, so a pass cannot come from the asymmetry
# having gone away — otherwise this test would quietly stop testing anything.
_DUAL_STACK_PROBE = """
import http from "node:http";
import { createRequire } from "node:module";
// Anchored to the file itself: playwright-core's `exports` map does not expose
// lib/coreBundle.js, so requiring it by package subpath is ERR_PACKAGE_PATH_NOT_EXPORTED.
const bundle = process.cwd() + "/node_modules/playwright-core/lib/coreBundle.js";
const { isURLAvailable } = createRequire(bundle)(bundle).utils;

const server = http.createServer((_, res) => res.end("ok"));
server.listen(0, "0.0.0.0", async () => {
  const { port } = server.address();
  const probe = (opts) => new Promise((resolve) => {
    const req = http.get(opts, (res) => { res.resume(); resolve("HTTP " + res.statusCode); });
    req.on("error", (e) => resolve(e.code));
    req.setTimeout(5000, () => { req.destroy(); resolve("ETIMEDOUT"); });
  });

  // Control: the IPv6 half of the fixture must genuinely be refused.
  const control = await probe({ host: "::1", port, path: "/" });

  // The thing under test: the poll the `webServer` plugin actually performs.
  let available = null, error = null;
  try {
    available = await isURLAvailable(new URL("http://localhost:" + port + "/"), false);
  } catch (e) { error = String(e && e.message || e); }

  server.close();
  console.log("RESULT " + JSON.stringify({ control, available, error }));
});
"""


class TestLocalhostDualStack:
    """`localhost` in the e2e config survives a v6-first resolver (#282).

    The config names `localhost` in both `use.baseURL` and `webServer.url`, and
    on this host that resolves to `::1` first. #282 was exactly that asymmetry
    breaking a server bound to `0.0.0.0`, so this looks like a latent e2e flake.

    It is not, and the reason is a property of Playwright rather than of this
    repo: its readiness client races both address families (RFC 8305). If a
    Playwright upgrade ever drops that, `make test-e2e` would start hanging on
    a refused `::1` with no error pointing at the cause — so the property is
    asserted here, where the failure can name it.
    """

    @pytest.mark.skipif(shutil.which("node") is None, reason="node not on PATH")
    def test_poll_reaches_an_ipv4_only_server_via_localhost(self):
        if not (FRONTEND_DIR / "node_modules" / "playwright-core").is_dir():
            pytest.skip("frontend deps not installed")

        proc = subprocess.run(  # noqa: S603 - fixed argv, literal script
            ["node", "-e", _DUAL_STACK_PROBE],
            cwd=FRONTEND_DIR,
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        assert proc.returncode == 0, (
            f"probe did not run: {proc.stderr.strip() or 'no stderr'}"
        )

        line = next(
            (ln for ln in proc.stdout.splitlines() if ln.startswith("RESULT ")), ""
        )
        assert line, f"probe printed no result: {proc.stdout.strip()!r}"
        result = json.loads(line[len("RESULT ") :])

        assert result["error"] is None, f"isURLAvailable threw: {result['error']}"
        assert result["control"] == "ECONNREFUSED", (
            "the IPv4-only fixture is no longer reproducing #282 "
            f"(control got {result['control']!r}, expected ECONNREFUSED), so this "
            "test would pass without proving anything about dual-stack fallback"
        )
        assert result["available"] is True, (
            "Playwright's readiness poll could not reach an IPv4-only server via "
            "`localhost`. It resolved to `::1`, got ECONNREFUSED, and did not fall "
            "back to `127.0.0.1` — so `webServer.url` in playwright.config.ts would "
            "hang until its 60s timeout and `make test-e2e` would fail for a reason "
            "that points at neither the config nor the server. Playwright's HTTP "
            "client appears to have lost its Happy Eyeballs support"
        )
