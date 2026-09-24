"""Isolated Docker sandbox for executing untrusted evaluation code.

Each evaluation runs inside a one-shot, air-gapped container built from the
``eval-sandbox`` image (per-language runtimes pre-installed). The container
gets a read-only root filesystem, a tmpfs scratch space, a hard CPU/RAM cap,
no network access, and no Linux capabilities. Logs are capped and the
container is always removed afterwards.

Language-specific details (filenames, commands, environment, output parsing)
are resolved through :mod:`app.services.language_runner`, keeping the sandbox
behaviour identical to the subprocess fallback.

The Docker client is created lazily so this module can be imported without
a reachable daemon; callers should check :meth:`DockerSandbox.is_available`
(or fall back on ``DockerSandboxError``).
"""

from __future__ import annotations

import io
import tarfile
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING

from app.config import settings
from app.services.evaluation import EvaluationOutcome, parse_outcome
from app.services.language_runner import LanguageRunner, get_runner

if TYPE_CHECKING:
    import docker


class DockerSandboxError(RuntimeError):
    """Raised when the sandbox cannot be created or executed."""


@dataclass
class DockerSandbox:
    """Run generated code and its test suite in an isolated container."""

    client: docker.DockerClient | None = None
    image: str = settings.docker_image
    memory_limit: str = settings.docker_memory_limit
    cpu_limit: float = settings.docker_cpu_limit
    network_disabled: bool = settings.docker_network_disabled
    readonly_rootfs: bool = settings.docker_readonly_rootfs
    max_output_bytes: int = settings.docker_max_output_bytes
    timeout: int = settings.docker_timeout

    def _get_client(self) -> docker.DockerClient:
        """Return the Docker client, creating it lazily from the environment."""
        if self.client is None:
            import docker

            self.client = docker.from_env()
        return self.client

    def is_available(self) -> bool:
        """True when the Docker daemon is reachable and responsive."""
        try:
            self._get_client().ping()
            return True
        except Exception:  # noqa: BLE001 - any failure means "not available"
            return False

    def _build_code_tar(
        self,
        code: str,
        test_code: str,
        runner: LanguageRunner | None = None,
    ) -> bytes:
        """Package solution + tests (+ extra files) into an in-memory tar."""
        from app.services.language_runner import PYTHON_RUNNER

        runner = runner or PYTHON_RUNNER
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode="w") as tar:
            files: list[tuple[str, str]] = [
                (runner.solution_filename, code),
                (runner.test_filename, test_code),
                *runner.extra_files.items(),
            ]
            for name, content in files:
                data = content.encode("utf-8")
                info = tarfile.TarInfo(name=name)
                info.size = len(data)
                info.mode = 0o644
                info.mtime = int(time.time())
                tar.addfile(info, io.BytesIO(data))
        return stream.getvalue()

    @staticmethod
    def _run_environment(runner: LanguageRunner) -> dict[str, str]:
        """Base environment shared by every sandboxed run, plus runner extras."""
        env = {
            "HOME": "/tmp",
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONUNBUFFERED": "1",
            "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1",
        }
        env.update(runner.env)
        return env

    def run(
        self,
        code: str,
        test_code: str,
        language: str = "python",
        timeout: int | None = None,
    ) -> EvaluationOutcome:
        """Execute ``code`` against ``test_code`` inside the sandbox.

        Returns an :class:`EvaluationOutcome` with test counts, logs, and
        metrics. Raises :class:`ValueError` for unsupported languages and
        :class:`DockerSandboxError` when the container cannot be created or
        started (e.g. missing image or daemon failure).
        """
        started = time.monotonic()
        runner = get_runner(language)
        # Per-language budget when no explicit timeout is given (java/go
        # need extra headroom for compilation).
        timeout = timeout or runner.timeout or self.timeout

        if not self.is_available():
            raise DockerSandboxError("Docker daemon is not reachable")

        client = self._get_client()
        from docker.types import Mount  # noqa: PLC0415 - docker is an optional dep

        container = None
        try:
            container = client.containers.create(
                image=self.image,
                command=runner.command,
                working_dir="/code",
                user="nobody",
                network_disabled=self.network_disabled,
                mem_limit=self.memory_limit,
                nano_cpus=int(self.cpu_limit * 1_000_000_000),
                read_only=self.readonly_rootfs,
                # /tmp is tmpfs scratch for runtime artifacts; /code (the
                # injected solution+test files) is an anonymous *volume*
                # (Mount type=volume, no source). Docker refuses put_archive
                # into any path of a read-only rootfs — including tmpfs
                # mounts ("container rootfs is marked read-only") — but
                # volumes are writable even with a read-only rootfs. The
                # rootfs stays read-only; the volume is discarded with the
                # one-shot container.
                tmpfs={"/tmp": "size=64m"},
                mounts=[Mount(source="", target="/code", type="volume")],
                pids_limit=64,
                cap_drop=["ALL"],
                security_opt=["no-new-privileges"],
                environment=self._run_environment(runner),
                detach=True,
            )
        except Exception as exc:  # noqa: BLE001 - surface any create failure
            raise DockerSandboxError(
                f"Failed to create sandbox container from image '{self.image}': {exc}"
            ) from exc

        try:
            container.put_archive("/code", self._build_code_tar(code, test_code, runner))
            container.start()
        except Exception as exc:  # noqa: BLE001
            raise DockerSandboxError(f"Failed to start sandbox container: {exc}") from exc

        timed_out = False
        returncode = 1
        output = ""
        try:
            wait_result = container.wait(timeout=timeout)
            returncode = int(wait_result.get("StatusCode", 1))
            raw_logs = container.logs(stdout=True, stderr=True)
            if isinstance(raw_logs, bytes):
                raw_logs = raw_logs.decode("utf-8", errors="replace")
            output = str(raw_logs)[-self.max_output_bytes :]
        except Exception:  # noqa: BLE001 - wait timeout surfaces as an exception
            timed_out = True
            try:
                container.kill()
            except Exception:  # noqa: BLE001 - best effort
                pass
        finally:
            try:
                container.remove(force=True)
            except Exception:  # noqa: BLE001 - best effort cleanup
                pass

        elapsed_ms = int((time.monotonic() - started) * 1000)
        if timed_out:
            return EvaluationOutcome(
                logs=f"Evaluation timed out after {timeout}s",
                metrics={
                    "backend": "docker",
                    "error": "timeout",
                    "duration_ms": elapsed_ms,
                    "language": runner.language,
                    "image": self.image,
                },
            )

        outcome = parse_outcome(output, runner)
        outcome.metrics = {
            "backend": "docker",
            "language": runner.language,
            "returncode": returncode,
            "duration_ms": elapsed_ms,
            "image": self.image,
        }
        return outcome
