"""Tests for the DockerSandbox service — all with mocked Docker clients."""

import tarfile
from io import BytesIO

import pytest

from app.services.docker_sandbox import DockerSandbox, DockerSandboxError
from app.services.evaluation import EvaluationOutcome

TWO_SUM_CODE = (
    "def two_sum(nums, target):\n"
    "    seen = {}\n"
    "    for i, num in enumerate(nums):\n"
    "        complement = target - num\n"
    "        if complement in seen:\n"
    "            return [seen[complement], i]\n"
    "        seen[num] = i\n"
    "    return []\n"
)

TWO_SUM_TESTS = (
    "from solution import two_sum\n"
    "\n"
    "def test_basic():\n"
    "    assert two_sum([2, 7, 11, 15], 9) == [0, 1]\n"
    "\n"
    "def test_no_solution():\n"
    "    assert two_sum([1, 2, 3], 99) == []\n"
)


class FakeContainer:
    def __init__(self, logs="2 passed in 0.05s", wait_error=None):
        self.logs_output = logs
        self.wait_error = wait_error
        self.put_archive_calls = []
        self.started = False
        self.killed = False
        self.removed = False
        self.wait_timeout = None

    def put_archive(self, path, data):
        self.put_archive_calls.append((path, data))

    def start(self):
        self.started = True

    def wait(self, timeout=None):
        self.wait_timeout = timeout
        if self.wait_error:
            raise self.wait_error
        return {"StatusCode": 0}

    def logs(self, stdout=True, stderr=True):
        return self.logs_output.encode("utf-8")

    def kill(self):
        self.killed = True

    def remove(self, force=True):
        self.removed = True


class FakeContainers:
    def __init__(self, container=None, create_error=None):
        self.container = container or FakeContainer()
        self.create_error = create_error
        self.create_calls = []

    def create(self, **kwargs):
        self.create_calls.append(kwargs)
        if self.create_error:
            raise self.create_error
        return self.container


class FakeClient:
    def __init__(self, containers=None, ping_ok=True):
        self.containers = containers or FakeContainers()
        self._ping_ok = ping_ok

    def ping(self):
        if not self._ping_ok:
            raise RuntimeError("daemon down")
        return True


def _sandbox(**kwargs):
    return DockerSandbox(client=FakeClient(), **kwargs)


class TestIsAvailable:
    def test_true_when_daemon_reachable(self):
        assert _sandbox().is_available() is True

    def test_false_when_daemon_down(self):
        client = FakeClient(ping_ok=False)
        assert DockerSandbox(client=client).is_available() is False


class TestBuildCodeTar:
    def test_contains_both_files(self):
        tar_bytes = _sandbox()._build_code_tar(TWO_SUM_CODE, TWO_SUM_TESTS)
        with tarfile.open(fileobj=BytesIO(tar_bytes), mode="r") as tar:
            names = sorted(tar.getnames())
            assert names == ["solution.py", "test_solution.py"]
            assert tar.extractfile("solution.py").read().decode() == TWO_SUM_CODE
            assert tar.extractfile("test_solution.py").read().decode() == TWO_SUM_TESTS


class TestRun:
    def test_runs_and_parses_outcome(self):
        containers = FakeContainers(container=FakeContainer(logs="2 passed in 0.05s"))
        outcome = DockerSandbox(client=FakeClient(containers=containers)).run(
            TWO_SUM_CODE, TWO_SUM_TESTS
        )
        assert outcome.passed == 2
        assert outcome.total == 2
        assert outcome.score == 100.0
        assert outcome.success
        assert outcome.metrics["backend"] == "docker"
        assert "duration_ms" in outcome.metrics

    def test_container_created_with_hardening(self):
        containers = FakeContainers()
        DockerSandbox(client=FakeClient(containers=containers)).run(TWO_SUM_CODE, TWO_SUM_TESTS)
        kwargs = containers.create_calls[0]
        assert kwargs["image"] == "eval-sandbox:latest"
        assert kwargs["command"] == [
            "pytest",
            "test_solution.py",
            "-q",
            "--no-header",
            "--tb=short",
            "-p",
            "no:cacheprovider",
        ]
        assert kwargs["working_dir"] == "/code"
        assert kwargs["user"] == "nobody"
        assert kwargs["network_disabled"] is True
        assert kwargs["mem_limit"] == "128m"
        assert kwargs["nano_cpus"] == int(0.5 * 1_000_000_000)
        assert kwargs["read_only"] is True
        assert kwargs["tmpfs"] == {"/tmp": "size=64m"}
        assert kwargs["pids_limit"] == 64
        assert kwargs["cap_drop"] == ["ALL"]
        assert kwargs["security_opt"] == ["no-new-privileges"]
        assert kwargs["detach"] is True

    def test_code_injected_via_archive(self):
        containers = FakeContainers()
        sandbox = DockerSandbox(client=FakeClient(containers=containers))
        sandbox.run(TWO_SUM_CODE, TWO_SUM_TESTS)
        path, data = containers.container.put_archive_calls[0]
        assert path == "/code"
        with tarfile.open(fileobj=BytesIO(data), mode="r") as tar:
            assert tar.getnames() == ["solution.py", "test_solution.py"]

    def test_container_removed_after_success(self):
        container = FakeContainer()
        DockerSandbox(client=FakeClient(containers=FakeContainers(container=container))).run(
            TWO_SUM_CODE, TWO_SUM_TESTS
        )
        assert container.removed is True
        assert container.started is True
        assert container.killed is False

    def test_timeout_returns_timed_out_outcome_and_cleans_up(self):
        container = FakeContainer(wait_error=RuntimeError("ReadTimeout"))
        sandbox = DockerSandbox(client=FakeClient(containers=FakeContainers(container=container)))
        outcome = sandbox.run(TWO_SUM_CODE, TWO_SUM_TESTS, timeout=5)
        assert outcome.total == 0
        assert "timed out after 5s" in outcome.logs
        assert outcome.metrics["error"] == "timeout"
        assert container.killed is True
        assert container.removed is True

    def test_failed_tests_parsed(self):
        container = FakeContainer(logs="1 passed, 1 failed in 0.1s")
        sandbox = DockerSandbox(client=FakeClient(containers=FakeContainers(container=container)))
        outcome = sandbox.run(TWO_SUM_CODE, TWO_SUM_TESTS)
        assert outcome.passed == 1
        assert outcome.total == 2
        assert outcome.score == 50.0
        assert not outcome.passed_all

    def test_no_tests_ran(self):
        container = FakeContainer(logs="no tests ran")
        sandbox = DockerSandbox(client=FakeClient(containers=FakeContainers(container=container)))
        outcome = sandbox.run(TWO_SUM_CODE, TWO_SUM_TESTS)
        assert outcome.total == 0
        assert outcome.score == 0.0
        assert not outcome.success

    def test_logs_capped_to_limit(self):
        container = FakeContainer(logs="2 passed in 0.05s")
        sandbox = DockerSandbox(
            client=FakeClient(containers=FakeContainers(container=container)),
            max_output_bytes=8,
        )
        outcome = sandbox.run(TWO_SUM_CODE, TWO_SUM_TESTS)
        assert len(outcome.logs) <= 8

    def test_create_failure_raises_and_surfaces_image(self):
        containers = FakeContainers(create_error=RuntimeError("No such image"))
        with pytest.raises(DockerSandboxError, match="eval-sandbox"):
            DockerSandbox(client=FakeClient(containers=containers)).run(TWO_SUM_CODE, TWO_SUM_TESTS)

    def test_unreachable_daemon_raises(self):
        sandbox = DockerSandbox(client=FakeClient(ping_ok=False))
        with pytest.raises(DockerSandboxError, match="not reachable"):
            sandbox.run(TWO_SUM_CODE, TWO_SUM_TESTS)

    def test_returns_evaluation_outcome_type(self):
        containers = FakeContainers(container=FakeContainer(logs="1 passed in 0.01s"))
        outcome = DockerSandbox(client=FakeClient(containers=containers)).run(
            "x = 1", "def test_a():\n    assert True\n"
        )
        assert isinstance(outcome, EvaluationOutcome)


class TestRunPerLanguage:
    def test_javascript_command_and_env(self):
        containers = FakeContainers(container=FakeContainer(logs="# pass 2\n# fail 0\n# tests 2"))
        sandbox = DockerSandbox(client=FakeClient(containers=containers))
        outcome = sandbox.run("console.log(1)", "", language="javascript")
        assert outcome.passed == 2
        assert outcome.total == 2
        kwargs = containers.create_calls[0]
        assert kwargs["command"] == ["node", "--test", "test_solution.js"]

    def test_go_command_tar_and_env(self):
        containers = FakeContainers(container=FakeContainer(logs="--- PASS: TestTwoSum\nok"))
        sandbox = DockerSandbox(client=FakeClient(containers=containers))
        outcome = sandbox.run("package main", "", language="go")
        assert outcome.passed == 1
        assert outcome.total == 1
        kwargs = containers.create_calls[0]
        assert kwargs["command"] == ["go", "test", "-v", "."]
        assert kwargs["environment"]["GOCACHE"] == "/tmp/go-build"
        # go.mod must be packaged alongside the solution and test files.
        path, data = containers.container.put_archive_calls[0]
        assert path == "/code"
        with tarfile.open(fileobj=BytesIO(data), mode="r") as tar:
            assert set(tar.getnames()) == {"solution.go", "solution_test.go", "go.mod"}

    def test_java_command_includes_compile_step(self):
        containers = FakeContainers(container=FakeContainer(logs="2 tests successful"))
        sandbox = DockerSandbox(client=FakeClient(containers=containers))
        outcome = sandbox.run("public class Solution {}", "", language="java")
        assert outcome.passed == 2
        assert outcome.total == 2
        kwargs = containers.create_calls[0]
        assert kwargs["command"][0] == "sh"
        assert "javac" in kwargs["command"][-1]
        assert "junit-platform-console-standalone.jar" in kwargs["command"][-1]

    def test_metrics_record_actual_language(self):
        containers = FakeContainers(container=FakeContainer(logs="# pass 1\n# fail 0"))
        outcome = DockerSandbox(client=FakeClient(containers=containers)).run(
            "x", "", language="typescript"
        )
        assert outcome.metrics["language"] == "typescript"

    def test_unsupported_language_raises_before_client_use(self):
        sandbox = DockerSandbox(client=FakeClient())
        with pytest.raises(ValueError, match="not supported"):
            sandbox.run("x", "", language="ruby")
