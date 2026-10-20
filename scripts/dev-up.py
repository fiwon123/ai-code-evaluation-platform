#!/usr/bin/env python3
"""Cross-platform dev-sandbox launcher for ai-code-evaluation-platform (#436).

Why this exists
---------------
The Makefile is a great interface on Linux, macOS and WSL2, but it cannot work
on native Windows: its preflight and recipes use POSIX constructs, and make
there runs under cmd.exe/PowerShell rather than a POSIX shell. This script
reproduces the developer targets in Python using only the standard library.

The stack is composed of three layers merged at runtime:
- docker-compose.yml        always (base; runs standalone on any OS)
- docker-compose.socket.yml when /var/run/docker.sock exists on the host
- docker-compose.agent.yml  when a Linux ELF opencode binary exists

The in-container agent needs a Linux opencode binary; missing it never blocks
`dev-up`, it only blocks `opencode` / `shell`.

Usage
-----
    python scripts/dev-up.py <command> [options]

Commands:
    dev-up        Build/start the sandbox (foreground)
    dev-down      Stop the sandbox (volumes kept)
    dev-restart   down + up --build in one step
    dev-log       Tail dev + celery + beat logs
    dev-exec      Shell into the running dev container
    opencode      Run the AI coding agent inside the dev container
    shell         Interactive shell in the dev container (agent ready)

Run ``python scripts/dev-up.py help`` for the full text.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

BASE_COMPOSE_FILE = REPO_ROOT / "docker-compose.yml"
SOCKET_COMPOSE_FILE = REPO_ROOT / "docker-compose.socket.yml"
AGENT_COMPOSE_FILE = REPO_ROOT / "docker-compose.agent.yml"

DEFAULT_WAIT_TIMEOUT = 180
DEV_SERVICE = "dev"

IS_WINDOWS = os.name == "nt"
IS_POSIX = not IS_WINDOWS


def log(message: str) -> None:
    print(f"[sandbox] {message}", file=sys.stderr, flush=True)


def warn(message: str) -> None:
    print(f"WARN: {message}", file=sys.stderr, flush=True)


def error(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr, flush=True)


def host_home() -> Path:
    value = os.environ.get("HOST_HOME") or os.environ.get("HOME") or os.environ.get("USERPROFILE")
    if value:
        return Path(value).expanduser()
    return Path.home()


def host_project_dir() -> Path:
    value = os.environ.get("HOST_PROJECT_DIR")
    if value:
        return Path(value).resolve()
    return REPO_ROOT


def opencode_binary() -> Path:
    value = os.environ.get("OPENCODE_BIN")
    if value:
        return Path(value).expanduser()
    return host_home() / ".opencode" / "bin" / "opencode"


def is_elf_linux(path: Path) -> bool:
    try:
        with path.open("rb") as fh:
            header = fh.read(4)
    except OSError:
        return False
    return header == b"\x7fELF"


def agent_available() -> bool:
    path = opencode_binary()
    return path.is_file() and os.access(path, os.X_OK) and is_elf_linux(path)


def socket_available() -> bool:
    if IS_WINDOWS:
        # Native Windows has no /var/run/docker.sock path; Docker Desktop uses named pipes.
        return False
    return Path("/var/run/docker.sock").exists()


def build_compose_files(*, for_agent: bool) -> list[str]:
    files: list[str] = ["-f", str(BASE_COMPOSE_FILE)]
    if socket_available():
        files.extend(["-f", str(SOCKET_COMPOSE_FILE)])
    if for_agent:
        if not agent_available():
            raise FileNotFoundError(str(opencode_binary()))
        files.extend(["-f", str(AGENT_COMPOSE_FILE)])
    return files


def prepare_agent_mounts() -> None:
    home = host_home()
    for directory in (
        home / ".config" / "opencode",
        home / ".config" / "gh",
    ):
        try:
            directory.mkdir(parents=True, exist_ok=True)
        except OSError:
            pass
    gitconfig = home / ".gitconfig"
    try:
        if not gitconfig.exists():
            gitconfig.touch()
    except OSError:
        pass


def host_uid_gid() -> tuple[str, str]:
    if os.environ.get("HOST_UID") and os.environ.get("HOST_GID"):
        return os.environ["HOST_UID"], os.environ["HOST_GID"]
    if IS_POSIX:
        try:
            uid = os.getuid()
            gid = os.getgid()
            return str(uid), str(gid)
        except AttributeError:
            pass
    # Docker Desktop on Windows/macOS virtualises the uid/gid inside the VM;
    # 1000:1000 is the image default and works for most cases.
    return "1000", "1000"


def host_docker_gid() -> str:
    if os.environ.get("DOCKER_GID"):
        return os.environ["DOCKER_GID"]
    if IS_WINDOWS:
        return "0"
    for path in (Path("/var/run/docker.sock"),):
        try:
            st = path.stat()
            return str(st.st_gid)
        except OSError:
            continue
    return "0"


def gh_path() -> str | None:
    return shutil.which("gh")


def run_gh_bounded(args: list[str], env: dict[str, str], timeout: int = 25):
    gh = gh_path()
    if not gh:
        return None
    if IS_POSIX and shutil.which("timeout"):
        argv = ["timeout", str(timeout), gh, *args]
    else:
        argv = [gh, *args]
    try:
        return subprocess.run(argv, capture_output=True, text=True, env=env, check=False)
    except OSError:
        return None


def resolve_gh_token() -> tuple[str, str]:
    # Prefer explicitly exported tokens, but we'll validate them and reject stale ones.
    for name in ("GH_TOKEN", "GITHUB_TOKEN"):
        candidate = os.environ.get(name, "")
        if candidate:
            if probe_gh_token(candidate):
                return candidate, name
            warn(f"exported {name} is stale or invalid; ignoring it")
    gh = gh_path()
    if gh:
        env = {k: v for k, v in os.environ.items() if k not in ("GH_TOKEN", "GITHUB_TOKEN")}
        result = run_gh_bounded(["auth", "token"], env, timeout=5)
        if result and result.returncode == 0:
            candidate = (result.stdout or "").strip()
            if candidate and probe_gh_token(candidate):
                return candidate, "gh auth token"
            if candidate:
                warn("stored gh token is stale or invalid; run 'gh auth login' on the host")
    log("no working GitHub token found; gh in the sandbox will use ~/.config/gh")
    return "", "none"


def probe_gh_token(token: str) -> bool:
    if not token:
        return False
    gh = gh_path()
    if not gh:
        return True  # cannot verify, but caller will warn
    env = {k: v for k, v in os.environ.items() if k not in ("GH_TOKEN", "GITHUB_TOKEN")}
    env["GH_TOKEN"] = token
    result = run_gh_bounded(["api", "user", "-q", ".login"], env, timeout=15)
    if not result:
        return True
    if result.returncode != 0:
        output = f"{result.stdout}\n{result.stderr}"
        if re.search(r"bad credentials|HTTP 401|requires authentication|invalid token", output, re.I):
            return False
        # Network issues -> don't block startup
        if re.search(r"error connecting|dial tcp|no such host|i/o timeout|connection reset|connection refused|could not resolve|network is unreachable|TLS handshake", output, re.I):
            return True
        # Unknown error -> be conservative and don't reject
        return True
    return True


def check_gh_token() -> bool:
    token, source = resolve_gh_token()
    if not token:
        warn("no GitHub credential found - 'gh' will not be authenticated in the dev sandbox.")
        warn("  Fix: gh auth login   (or pass GH_TOKEN=<pat> to the command)")
        return True
    if source == "none":
        return True
    gh = gh_path()
    if not gh:
        warn("gh is not installed on this host; skipping credential validation.")
        return True
    return True


def compose_environment(with_github: bool = False) -> dict[str, str]:
    env = os.environ.copy()
    uid, gid = host_uid_gid()
    env["HOST_UID"] = uid
    env["HOST_GID"] = gid
    env["DOCKER_GID"] = host_docker_gid()
    if with_github:
        token, _source = resolve_gh_token()
        if token:
            env["GH_TOKEN"] = token
            env["GITHUB_TOKEN"] = token
        else:
            # Don't inject empty/stale values; compose will interpolate empty string
            env.pop("GH_TOKEN", None)
            env.pop("GITHUB_TOKEN", None)
    return env


def docker_compose_argv(files: list[str], args: list[str]) -> list[str]:
    return ["docker", "compose", *files, *args]


def require_docker() -> None:
    if not shutil.which("docker"):
        error("docker was not found on PATH.")
        error("  Install Docker Desktop (Windows/macOS) or Docker Engine (Linux), then retry.")
        raise SystemExit(1)


def run_compose(files: list[str], args: list[str], *, with_github: bool = False, capture: bool = False) -> subprocess.CompletedProcess[str]:
    require_docker()
    argv = docker_compose_argv(files, args)
    try:
        return subprocess.run(argv, cwd=REPO_ROOT, env=compose_environment(with_github=with_github), capture_output=capture, text=True, check=False)
    except KeyboardInterrupt:
        return subprocess.CompletedProcess(argv, 130, "", "")


def _ps_field(files: list[str], service: str, field: str) -> str:
    result = run_compose(files, ["ps", "--all", "--format", f"{{{{{field}}}}}", service], capture=True)
    if result.returncode != 0:
        return ""
    lines = (result.stdout or "").strip().splitlines()
    return lines[0].strip() if lines else ""


def wait_for_dev(files: list[str], timeout: int = DEFAULT_WAIT_TIMEOUT) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        state = _ps_field(files, DEV_SERVICE, "State")
        if state == "running":
            health = _ps_field(files, DEV_SERVICE, "Health")
            if not health or health == "healthy":
                return True
            if health == "unhealthy":
                log("dev reported unhealthy - continuing to wait (it may recover).")
        time.sleep(2)
    log(f"Timed out after {timeout}s waiting for '{DEV_SERVICE}'. Recent status:")
    run_compose(files, ["ps", DEV_SERVICE])
    log("Follow the logs with: dev-log")
    return False


def ensure_sandbox_running(*, agent: bool) -> None:
    try:
        files = build_compose_files(for_agent=agent)
    except FileNotFoundError as e:
        error(f"the in-container AI agent needs a Linux opencode binary at {e}.")
        if IS_WINDOWS:
            error("  A Windows opencode install cannot execute inside the Linux container.")
            error("  Recommended: use WSL2, where the host binary is Linux.")
        elif sys.platform == "darwin":
            error("  A macOS opencode binary cannot execute inside the Linux container.")
        error("  Alternative: run 'opencode' on the host against the running stack.")
        raise SystemExit(1)
    state = _ps_field(files, DEV_SERVICE, "State")
    if not state:
        log("dev is not initialized yet - building and starting the stack (this runs once).")
        run_compose(files, ["up", "-d", "--build", DEV_SERVICE])
    elif state == "running":
        log("dev is already running - skipping image build.")
    else:
        log(f"dev is '{state}' - starting the existing container without rebuilding.")
        run_compose(files, ["up", "-d", DEV_SERVICE])
    if not wait_for_dev(files):
        log("Continuing anyway - the container may still be initializing.")


def agent_note() -> None:
    if agent_available():
        log("sandboxed agent available - merging docker-compose.agent.yml.")
    else:
        log(f"in-container agent unavailable (no Linux binary at {opencode_binary()}).")
        log("  Starting the application without it; run opencode on the host if needed.")


def preflight(*, require_agent: bool) -> None:
    if IS_POSIX and hasattr(os, "getuid") and os.getuid() == 0:
        error("refusing to run the dev sandbox as UID 0; repair workspace ownership or set HOST_UID to the host user.")
        raise SystemExit(1)
    require_docker()
    if not check_gh_token():
        raise SystemExit(1)
    if require_agent:
        if not agent_available():
            error(f"the in-container AI agent needs a Linux opencode binary at {opencode_binary()}.")
            if IS_WINDOWS:
                error("  A Windows opencode install cannot execute inside the Linux container.")
                error("  Recommended: use WSL2, where the host binary is Linux.")
            elif sys.platform == "darwin":
                error("  A macOS opencode binary cannot execute inside the Linux container.")
            error("  Alternative: run 'opencode' on the host against the running stack.")
            raise SystemExit(1)
    prepare_agent_mounts()


def cmd_dev_up() -> int:
    preflight(require_agent=False)
    agent_note()
    files = build_compose_files(for_agent=False)
    # Merge agent only if available but don't require it
    if agent_available():
        files = build_compose_files(for_agent=True)
    result = run_compose(files, ["up", "--build", DEV_SERVICE], with_github=True)
    return result.returncode


def cmd_dev_down() -> int:
    require_docker()
    files = build_compose_files(for_agent=False)
    if socket_available():
        files = build_compose_files(for_agent=False)
    return run_compose(files, ["down"]).returncode


def cmd_dev_restart() -> int:
    preflight(require_agent=False)
    agent_note()
    files = build_compose_files(for_agent=agent_available())
    down = run_compose(build_compose_files(for_agent=False), ["down"])
    if down.returncode != 0:
        return down.returncode
    result = run_compose(files, ["up", "--build", DEV_SERVICE], with_github=True)
    return result.returncode


def cmd_dev_log() -> int:
    require_docker()
    files = build_compose_files(for_agent=False)
    return run_compose(files, ["logs", "-f", "dev", "celery", "beat"]).returncode


def cmd_dev_exec() -> int:
    preflight(require_agent=False)
    ensure_sandbox_running(agent=agent_available())
    files = build_compose_files(for_agent=agent_available())
    return run_compose(files, ["exec", DEV_SERVICE, "zsh"], with_github=True).returncode


def _opencode_args(extra: list[str]) -> list[str]:
    return extra if extra else ["--auto"]


def _shell_quote(value: str) -> str:
    if not value:
        return "''"
    if re.fullmatch(r"[A-Za-z0-9_./:@%+=,-]+", value):
        return value
    return "'" + value.replace("'", "'\"'\"'") + "'"


def cmd_opencode(extra: list[str]) -> int:
    preflight(require_agent=True)
    ensure_sandbox_running(agent=True)
    files = build_compose_files(for_agent=True)
    quoted = " ".join(_shell_quote(part) for part in _opencode_args(extra))
    remote = f"cd /sandbox/ai-code-evaluation-platform && env OPENCODE_DISABLE_TERMINAL_TITLE=true opencode {quoted}".strip()
    interactive = sys.stdin.isatty()
    exec_flag = "-it" if interactive else "-T"
    return run_compose(files, ["exec", exec_flag, DEV_SERVICE, "zsh", "-lc", remote], with_github=True).returncode


def cmd_shell() -> int:
    preflight(require_agent=True)
    ensure_sandbox_running(agent=True)
    files = build_compose_files(for_agent=True)
    log("Dev sandbox shell - run the AI coding agent with:")
    log("  cd /sandbox/ai-code-evaluation-platform && opencode")
    return run_compose(files, ["exec", DEV_SERVICE, "zsh"], with_github=True).returncode


HELP = """\
Cross-platform dev sandbox launcher for ai-code-evaluation-platform (#436).

Usage:
  python scripts/dev-up.py <command> [options]

Commands:
  dev-up                 Build/start the sandbox in the foreground
  dev-down               Stop the sandbox (volumes kept)
  dev-restart            Stop, then up --build
  dev-log                Tail dev + celery + beat logs
  dev-exec               Shell into the running dev container
  opencode [args...]     Run the AI agent inside the dev container
                         (default args: --auto)
  shell                  Interactive shell in the dev container (agent ready)
  help                   Show this message

Environment:
  HOST_UID / HOST_GID    Override the container identity
  HOST_HOME              Host home path (default: your home directory)
  DOCKER_GID             Docker socket group (default: from /var/run/docker.sock)
  OPENCODE_BIN           Path to a Linux opencode binary
  GH_TOKEN/GITHUB_TOKEN  GitHub credential forwarded into the sandbox

The base stack runs with `docker compose up dev` and needs no host-specific
mounts. The socket and agent are merged only when the host can satisfy them.
Native Windows cannot mount /var/run/docker.sock; evaluations fall back to
subprocess mode there (weaker isolation) — see README.md.
"""

COMMANDS = {
    "dev-up": cmd_dev_up,
    "dev-down": cmd_dev_down,
    "dev-restart": cmd_dev_restart,
    "dev-log": cmd_dev_log,
    "dev-exec": cmd_dev_exec,
    "opencode": cmd_opencode,
    "shell": cmd_shell,
}


def main(argv: list[str]) -> int:
    if not argv or argv[0] in ("help", "-h", "--help"):
        print(HELP, end="")
        return 0
    command, *rest = argv
    if command not in COMMANDS:
        error(f"unknown command '{command}'.")
        print(HELP, end="")
        return 2
    handler = COMMANDS[command]
    if command == "opencode":
        return handler(rest)
    if rest:
        error(f"'{command}' takes no arguments (got: {' '.join(rest)}).")
        return 2
    return handler()


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
