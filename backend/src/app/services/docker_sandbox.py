"""Isolated Docker sandbox for executing untrusted evaluation code.

Each evaluation runs inside a one-shot, air-gapped container built from the
``eval-sandbox`` image (pytest pre-installed). The container gets a
read-only root filesystem, a tmpfs scratch space, a hard CPU/RAM cap, no
network access, and no Linux capabilities. Logs are capped and the
container is always removed afterwards.

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
from app.services.evaluation import EvaluationOutcome, parse_summary

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

    def _build_code_tar(self, code: str, test_code: str) -> bytes:
        """Package solution + tests into an in-memory tar for ``put_archive``."""
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode="w") as tar:
            for name, content in (("solution.py", code), ("test_solution.py", test_code)):
                data = content.encode("utf-8")
                info = tarfile.TarInfo(name=name)
                info.size = len(data)
                info.mode = 0o644
                info.mtime = int(time.time())
                tar.addfile(info, io.BytesIO(data))
        return stream.getvalue()

    @staticmethod
    def _pytest_args() -> list[str]:
        """Command executed inside the container (non-root, cache-free pytest)."""
        return [
            "pytest",
            "-q",
            "--no-header",
            "--tb=short",
            "-p",
            "no:cacheprovider",
            "/code/test_solution.py",
        ]

    def run(self, code: str, test_code: str, timeout: int | None = None) -> EvaluationOutcome:
        """Execute ``code`` against ``test_code`` inside the sandbox.

        Returns an :class:`EvaluationOutcome` with pytest counts, logs, and
        metrics. Raises :class:`DockerSandboxError` when the container cannot
        be created or started (e.g. missing image or daemon failure).
        """
        started = time.monotonic()
        timeout = timeout or self.timeout

        if not self.is_available():
            raise DockerSandboxError("Docker daemon is not reachable")

        client = self._get_client()
        container = None
        try:
            container = client.containers.create(
                image=self.image,
                command=self._pytest_args(),
                working_dir="/code",
                user="nobody",
                network_disabled=self.network_disabled,
                mem_limit=self.memory_limit,
                nano_cpus=int(self.cpu_limit * 1_000_000_000),
                read_only=self.readonly_rootfs,
                tmpfs={"/tmp": "size=64m"},
                pids_limit=64,
                cap_drop=["ALL"],
                security_opt=["no-new-privileges"],
                environment={
                    "HOME": "/tmp",
                    "PYTHONDONTWRITEBYTECODE": "1",
                    "PYTHONUNBUFFERED": "1",
                    "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1",
                },
                detach=True,
            )
        except Exception as exc:  # noqa: BLE001 - surface any create failure
            raise DockerSandboxError(
                f"Failed to create sandbox container from image '{self.image}': {exc}"
            ) from exc

        try:
            container.put_archive("/code", self._build_code_tar(code, test_code))
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
                    "image": self.image,
                },
            )

        passed, total = parse_summary(output)
        score = round((passed / total) * 100, 1) if total else 0.0

        return EvaluationOutcome(
            passed=passed,
            total=total,
            score=score,
            logs=output,
            metrics={
                "backend": "docker",
                "language": "python",
                "returncode": returncode,
                "duration_ms": elapsed_ms,
                "image": self.image,
            },
        )
