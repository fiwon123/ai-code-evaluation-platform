"""Regression guard for the dev-sandbox host-identity wiring (issue #183).

`dev`, `celery` and `beat` bind-mount the workspace, so they must run as the
*host* user: a container running as root leaves every file it writes
(root-owned builds, `__pycache__`, agent edits) unreadable — "locked" — in the
host editor, and makes git fail with "dubious ownership" inside the sandbox.

These assertions are text-based on purpose: they guard the contract between
Makefile -> docker-compose.yml -> Dockerfile without pulling in a YAML parser
for an infra-only check.
"""

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
COMPOSE_FILE = REPO_ROOT / "docker-compose.yml"
DOCKERFILE = REPO_ROOT / "Dockerfile"
MAKEFILE = REPO_ROOT / "Makefile"

# Every service that bind-mounts the workspace and therefore writes host files.
WORKSPACE_SERVICES = ("dev", "celery", "beat")
# ... of which these also mount the Docker socket, so they need its group.
DOCKER_SOCKET_SERVICES = ("dev", "celery")

# The runtime user's home: compose mounts host config into it and the image
# bakes the account with this name.
DEV_USER_HOME = "/home/devuser"


def _compose_text() -> str:
    return COMPOSE_FILE.read_text()


def _service_block(service: str) -> str:
    """Return the compose YAML block for `service` (2-space service indent)."""
    lines = _compose_text().splitlines()
    start = next(
        i for i, line in enumerate(lines) if line.startswith(f"  {service}:")
    )
    end = len(lines)
    for i in range(start + 1, len(lines)):
        if re.fullmatch(r"  [A-Za-z0-9_-]+:\s*", lines[i]):
            end = i
            break
    return "\n".join(lines[start:end])


class TestComposeHostIdentity:
    def test_workspace_services_run_as_host_user(self):
        for service in WORKSPACE_SERVICES:
            block = _service_block(service)
            assert 'user: "${HOST_UID:-1000}:${HOST_GID:-1000}"' in block, (
                f"service {service!r} must run as the host user; without `user:` "
                "its workspace writes land as root:root (see issue #183)"
            )

    def test_image_build_args_match_runtime_user(self):
        for service in WORKSPACE_SERVICES:
            block = _service_block(service)
            assert "USER_ID: ${HOST_UID:-1000}" in block
            assert "GROUP_ID: ${HOST_GID:-1000}" in block

    def test_docker_socket_services_get_host_socket_group(self):
        for service in DOCKER_SOCKET_SERVICES:
            block = _service_block(service)
            assert "group_add:" in block, (
                f"service {service!r} mounts the Docker socket and must join the "
                "host socket group or evaluation container spawning breaks"
            )
            assert '"${DOCKER_GID:-0}"' in block

    def test_services_set_home_for_non_root_user(self):
        for service in WORKSPACE_SERVICES:
            block = _service_block(service)
            assert f"HOME={DEV_USER_HOME}" in block

    def test_host_config_mounts_target_runtime_home(self):
        dev = _service_block("dev")
        # gh CLI auth, opencode config and git identity land in the runtime
        # user's home; /root/... would be unreadable to a non-root process.
        assert f":{DEV_USER_HOME}/.config/gh:ro" in dev
        assert f":{DEV_USER_HOME}/.config/opencode:ro" in dev
        assert f":{DEV_USER_HOME}/.gitconfig:ro" in dev
        assert "/root/.config" not in _compose_text()
        assert "/root/.gitconfig" not in _compose_text()

    def test_no_workspace_service_runs_as_bare_root(self):
        for service in WORKSPACE_SERVICES:
            block = _service_block(service)
            assert not re.search(r"^\s*user:\s*[\"']?0:0", block, re.MULTILINE)


class TestImageRuntimeUser:
    def test_dockerfile_bakes_matching_non_root_user(self):
        text = DOCKERFILE.read_text()
        assert "ARG USER_ID=1000" in text
        assert "ARG GROUP_ID=1000" in text
        assert "useradd --uid ${USER_ID}" in text
        # Handing the baked venv to the runtime user keeps the runtime
        # `uv sync` guard (dev-entrypoint.sh, celery, beat) working.
        assert "chown -R ${USER_ID}:${GROUP_ID} /home/${USER_NAME} /opt/backend-venv" in text
        # Default to the non-root account so a new service can't silently
        # reintroduce root-owned workspace files.
        assert re.search(r"^USER \$\{USER_NAME\}$", text, re.MULTILINE)

    def test_dockerfile_does_not_depend_on_root_runtime_paths(self):
        text = DOCKERFILE.read_text()
        # /root keeps its sandbox rc for `exec -u root` debugging, but the
        # runtime user's rc files must be configured too.
        assert '"/home/${USER_NAME}/.zshrc"' in text
        assert '"/home/${USER_NAME}/.zprofile"' in text
        assert '"/home/${USER_NAME}/.bashrc"' in text


class TestMakefileHostIdentityExport:
    def test_derives_and_exports_host_ids(self):
        text = MAKEFILE.read_text()
        assert "HOST_UID ?= $(shell id -u)" in text
        assert "HOST_GID ?= $(shell id -g)" in text
        assert "DOCKER_GID ?= $(shell stat -c %g /var/run/docker.sock" in text
        assert "export HOST_UID HOST_GID DOCKER_GID" in text

    def test_does_not_rely_on_bash_uid_variable(self):
        # bash defines UID as a read-only, non-exported shell variable, so
        # compose interpolation of ${UID} silently falls back to 1000.
        text = MAKEFILE.read_text()
        assert not re.search(r"^UID \?= ", text, re.MULTILINE)
        assert not re.search(r"export .*\bUID\b", text, re.MULTILINE)
