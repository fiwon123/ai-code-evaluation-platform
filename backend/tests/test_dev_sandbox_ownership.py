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
SANDBOX_SCRIPT = REPO_ROOT / "scripts" / "open-in-sandbox.sh"

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

    def test_only_socket_consumers_join_the_socket_group(self):
        # `beat` only schedules sweeps; container-creation rights belong to the
        # two services that actually spawn eval-sandbox containers.
        assert "group_add:" not in _service_block("beat")

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
        assert "chown -R ${USER_ID}:${GROUP_ID} /home/devuser /opt/backend-venv" in text
        # Default to the non-root account so a new service can't silently
        # reintroduce root-owned workspace files.
        assert re.search(r"^USER devuser$", text, re.MULTILINE)

    def test_account_name_is_fixed_because_compose_pins_the_home(self):
        # compose hardcodes HOME=/home/devuser and the host-config mount
        # targets; a USER_NAME build arg could only build an image whose
        # account, $HOME and mounts disagree.
        text = DOCKERFILE.read_text()
        assert "ARG USER_NAME" not in text
        assert "${USER_NAME}" not in text
        assert "ENV HOME=/home/devuser" in text

    def test_dependency_caches_are_writable_by_the_runtime_user(self):
        # A root-owned 0755 cache dir is not writable by the non-root user the
        # entrypoint/celery/beat run as, which broke the `uv sync` / `npm ci`
        # bootstrap on a fresh workspace (node_modules absent) with EACCES.
        text = DOCKERFILE.read_text()
        assert "mkdir -p /tmp/uv-cache /tmp/npm-cache" in text
        # chown covers the normal matching-uid case, 1777 the "container runs as
        # a different uid than the build args" case; both are needed.
        assert "chown ${USER_ID}:${GROUP_ID} /tmp/uv-cache /tmp/npm-cache" in text
        assert "chmod 1777 /tmp/uv-cache /tmp/npm-cache" in text

    def test_uid_collision_fails_at_build_time(self):
        # useradd is conditional, so the account can still be missing at the
        # end (uid taken by another name). `USER devuser` is resolved before the
        # entrypoint's passwd fallback runs, so this must fail at build time
        # with a readable message instead of an opaque container start error.
        text = DOCKERFILE.read_text()
        assert "getent passwd devuser" in text

    def test_dockerfile_does_not_depend_on_root_runtime_paths(self):
        text = DOCKERFILE.read_text()
        # /root keeps its sandbox rc for `exec -u root` debugging, but the
        # runtime user's rc files must be configured too.
        assert "/home/devuser/.zshrc" in text
        assert "/home/devuser/.zprofile" in text
        assert "/home/devuser/.bashrc" in text


class TestMakefileHostIdentityExport:
    def test_derives_and_exports_host_ids(self):
        text = MAKEFILE.read_text()
        assert "HOST_UID ?= $(shell id -u)" in text
        assert "HOST_GID ?= $(shell id -g)" in text
        # GNU stat (-c) first, BSD/macOS stat (-f) second, 0 as last resort:
        # a macOS host must not silently end up with the wrong socket group.
        assert re.search(
            r"^DOCKER_GID \?= \$\(shell stat -c %g /var/run/docker\.sock .*"
            r"stat -f %g /var/run/docker\.sock .*\|\| echo 0\)$",
            text,
            re.MULTILINE,
        )
        assert "export HOST_UID HOST_GID DOCKER_GID" in text

    def test_does_not_rely_on_bash_uid_variable(self):
        # bash defines UID as a read-only, non-exported shell variable, so
        # compose interpolation of ${UID} silently falls back to 1000.
        text = MAKEFILE.read_text()
        assert not re.search(r"^UID \?= ", text, re.MULTILINE)
        assert not re.search(r"export .*\bUID\b", text, re.MULTILINE)

    def test_dev_build_rebuilds_every_workspace_service(self):
        # celery/beat build from the same Dockerfile into their own images;
        # building only `dev` left the worker on the pre-fix image.
        text = MAKEFILE.read_text()
        assert re.search(
            r"^dev-build:.*\n\t\$\(COMPOSE\) build dev celery beat$", text, re.MULTILINE
        )


class TestSandboxScriptHostIdentity:
    """`scripts/open-in-sandbox.sh` starts the stack itself, so it must export
    the same identity the Makefile does — otherwise compose falls back to
    1000:1000 + socket group 0 and the bug of issue #183 returns."""

    def test_exports_host_identity(self):
        text = SANDBOX_SCRIPT.read_text()
        assert 'export HOST_UID="${HOST_UID:-$(id -u)}"' in text
        assert 'export HOST_GID="${HOST_GID:-$(id -g)}"' in text
        assert re.search(r"DOCKER_GID=.*stat -c %g .*stat -f %g", text)

    def test_exports_happen_before_compose_runs(self):
        # Compare against the first *executed* compose call, not the prose in
        # the header comments.
        lines = SANDBOX_SCRIPT.read_text().splitlines()
        first_compose = next(
            i
            for i, line in enumerate(lines)
            if re.match(r"\s*(if .*;\s*)?(exec )?docker compose", line)
        )
        first_export = next(i for i, line in enumerate(lines) if "export HOST_UID" in line)
        assert first_export < first_compose
