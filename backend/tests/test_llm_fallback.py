"""The generation fallback: primary fails → one retry with a fallback provider.

Covers :mod:`app.services.llm_fallback` in isolation (no DB, no network) and
the task wiring that records provenance in the result metrics.
"""

import httpx
import pytest

from app.config import settings
from app.services.llm import get_llm_provider
from app.services.llm_fallback import (
    MAX_ERROR_CHARS,
    GenerationError,
    generate_code,
)
from app.services.llm_providers import GroqProvider, MockProvider, OllamaProvider
from tests.conftest import fake_provider


def _down(message: str):
    """A ``behaviour`` for :func:`_patch_provider` where every provider is down."""

    def behaviour(name: str) -> str:
        raise _BoomError(message)

    return behaviour


def _only_primary_fails(primary: str, message: str = "429 rate limited", serves: str = "x = 1"):
    """A ``behaviour`` where the primary fails and the fallback still serves code."""

    def behaviour(name: str) -> str:
        if name == primary:
            raise _BoomError(message)
        return serves

    return behaviour


@pytest.fixture
def fallback(monkeypatch):
    """Enable a fallback provider, returning a setter for provider/model."""

    def configure(provider: str = "ollama", model: str = "tinyllama") -> None:
        monkeypatch.setattr(settings, "llm_fallback_provider", provider)
        monkeypatch.setattr(settings, "llm_fallback_model", model)

    monkeypatch.setattr(settings, "llm_fallback_provider", "")
    monkeypatch.setattr(settings, "llm_fallback_model", "")
    return configure


class _BoomError(RuntimeError):
    pass


def _patch_provider(monkeypatch, behaviour) -> tuple[list[dict], list]:
    """Replace ``get_llm_provider`` with a recorder returning scripted results.

    ``behaviour(name)`` returns the code string or raises. Calls are recorded so
    the tests can assert *which* providers ran, in order, and the returned
    second list exposes each provider's ``closed`` flag.
    """
    calls: list[dict] = []

    class Recorder:
        def __init__(self, name: str) -> None:
            self._name = name
            self.closed = False

        def generate_code(self, prompt, language="python", feedback=None):
            calls.append(
                {
                    "provider": self._name,
                    "prompt": prompt,
                    "language": language,
                    "feedback": feedback,
                }
            )
            return behaviour(self._name)

        def close(self):
            self.closed = True

    built: list[Recorder] = []

    def fake_get_llm_provider(name=None, api_key=None, model=None):
        provider = Recorder(str(name))
        built.append(provider)
        return provider

    monkeypatch.setattr("app.services.llm_fallback.get_llm_provider", fake_get_llm_provider)
    return calls, built


class TestNoFallbackConfigured:
    def test_success_returns_primary_provenance(self, fallback, monkeypatch):
        calls, built = _patch_provider(monkeypatch, lambda name: "code()")
        result = generate_code(provider_name="groq", prompt="two sum")
        assert result.code == "code()"
        assert result.provider == "groq"
        assert result.model is None
        assert result.used_fallback is False
        assert result.primary_error is None
        assert [c["provider"] for c in calls] == ["groq"]
        # The provider's transport is released even on the happy path.
        assert built[0].closed is True

    def test_metrics_are_empty_for_a_normal_run(self, fallback, monkeypatch):
        _patch_provider(monkeypatch, lambda name: "code()")
        assert generate_code(provider_name="groq", prompt="p").as_metrics() == {}

    def test_primary_failure_propagates_unchanged(self, fallback, monkeypatch):
        """No fallback configured → the caller sees exactly the provider error."""
        _patch_provider(monkeypatch, _down("429 rate limited"))
        with pytest.raises(_BoomError, match="429 rate limited"):
            generate_code(provider_name="groq", prompt="p")

    def test_provider_is_closed_when_generation_raises(self, fallback, monkeypatch):
        _, built = _patch_provider(monkeypatch, _down("boom"))
        with pytest.raises(_BoomError):
            generate_code(provider_name="groq", prompt="p")
        assert built[0].closed is True


class TestFallbackUsed:
    def test_falls_back_and_reports_provenance(self, fallback, monkeypatch):
        fallback()
        calls, built = _patch_provider(
            monkeypatch, _only_primary_fails("groq", serves="def tiny(): pass")
        )
        result = generate_code(provider_name="groq", prompt="two sum", model="openai/gpt-oss-20b")

        assert result.code == "def tiny(): pass"
        assert result.provider == "ollama"
        assert result.model == "tinyllama"
        assert result.used_fallback is True
        assert "429 rate limited" in (result.primary_error or "")
        assert [c["provider"] for c in calls] == ["groq", "ollama"]
        assert all(p.closed for p in built)

    def test_metrics_describe_the_fallback(self, fallback, monkeypatch):
        fallback()
        _patch_provider(monkeypatch, _only_primary_fails("groq", message="500 boom"))
        metrics = generate_code(provider_name="groq", prompt="p").as_metrics()
        assert metrics["fallback_used"] is True
        assert metrics["fallback_provider"] == "ollama"
        assert metrics["fallback_model"] == "tinyllama"
        assert "500 boom" in metrics["primary_error"]

    def test_fallback_receives_the_prompt_language_and_repair_feedback(self, fallback, monkeypatch):
        fallback()
        calls, _ = _patch_provider(monkeypatch, _only_primary_fails("groq", message="down"))
        generate_code(
            provider_name="groq",
            prompt="fizzbuzz",
            language="go",
            feedback="previous attempt failed",
        )
        fallback_call = calls[1]
        assert fallback_call["prompt"] == "fizzbuzz"
        assert fallback_call["language"] == "go"
        assert fallback_call["feedback"] == "previous attempt failed"

    def test_fallback_without_a_model_uses_the_provider_default(self, fallback, monkeypatch):
        fallback(provider="ollama", model="")
        _patch_provider(monkeypatch, _only_primary_fails("groq", message="down"))
        result = generate_code(provider_name="groq", prompt="p")
        assert result.model is None
        assert result.as_metrics()["fallback_model"] == "provider default"

    def test_whitespace_only_fallback_config_is_off(self, fallback, monkeypatch):
        fallback(provider="   ", model="tinyllama")
        _patch_provider(monkeypatch, _down("still down"))
        with pytest.raises(_BoomError, match="still down"):
            generate_code(provider_name="groq", prompt="p")

    def test_self_referential_fallback_is_skipped(self, fallback, monkeypatch):
        """Falling back to the same provider would repeat the same failure."""
        fallback(provider="groq", model="tinyllama")
        calls, _ = _patch_provider(monkeypatch, _down("401 bad key"))
        with pytest.raises(_BoomError, match="401 bad key"):
            generate_code(provider_name="groq", prompt="p")
        # Exactly one attempt: no pointless second call to the same provider.
        assert [c["provider"] for c in calls] == ["groq"]

    def test_fallback_case_does_not_count_as_a_different_provider(self, fallback, monkeypatch):
        fallback(provider="GROQ", model="tinyllama")
        calls, _ = _patch_provider(monkeypatch, _down("boom"))
        with pytest.raises(_BoomError):
            generate_code(provider_name="groq", prompt="p")
        assert len(calls) == 1

    def test_primary_error_is_truncated(self, fallback, monkeypatch):
        fallback()
        _patch_provider(
            monkeypatch,
            _only_primary_fails("groq", message="x" * (MAX_ERROR_CHARS * 3), serves="ok"),
        )
        result = generate_code(provider_name="groq", prompt="p")
        assert result.primary_error is not None
        assert len(result.primary_error) <= MAX_ERROR_CHARS
        assert result.primary_error.endswith("…")

    def test_primary_error_is_a_single_line(self, fallback, monkeypatch):
        """A multi-line error would wreck the report's pre-line summary."""
        fallback()
        _patch_provider(
            monkeypatch,
            _only_primary_fails("groq", message="line one\nline two\nline three", serves="ok"),
        )
        result = generate_code(provider_name="groq", prompt="p")
        assert "\n" not in (result.primary_error or "")
        assert "line one line two line three" in (result.primary_error or "")


class TestBothFail:
    def test_error_names_both_providers(self, fallback, monkeypatch):
        fallback()
        def _both_down(name: str) -> str:
            raise _BoomError("429 rate limited" if name == "groq" else "connection refused")

        _patch_provider(monkeypatch, _both_down)
        with pytest.raises(GenerationError) as excinfo:
            generate_code(provider_name="groq", prompt="p")
        message = str(excinfo.value)
        assert "429 rate limited" in message
        assert "connection refused" in message
        assert "ollama" in message

    def test_generation_error_is_a_runtime_error(self, fallback):
        """The task's broad `except Exception` must still catch it."""
        assert issubclass(GenerationError, RuntimeError)


class TestGroqProvider:
    def test_calls_the_groq_endpoint_and_strips_fences(self):
        seen: dict[str, object] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            import json

            seen["url"] = str(request.url)
            seen["auth"] = request.headers.get("Authorization")
            seen["body"] = json.loads(request.content)
            return httpx.Response(
                200,
                json={
                    "choices": [
                        {
                            "message": {
                                "content": "```python\ndef two_sum(a, b):\n    return []\n```"
                            }
                        }
                    ]
                },
            )

        provider = GroqProvider(api_key="gsk-test", transport=httpx.MockTransport(handler))
        code = provider.generate_code("two sum")

        assert code == "def two_sum(a, b):\n    return []"
        assert seen["url"] == "https://api.groq.com/openai/v1/chat/completions"
        assert seen["auth"] == "Bearer gsk-test"
        body = seen["body"]
        assert isinstance(body, dict)
        assert body["model"] == "openai/gpt-oss-20b"
        assert body["messages"][0]["role"] == "system"
        provider.close()

    def test_default_base_url_is_groq_not_openai(self):
        provider = GroqProvider(api_key="k")
        assert str(provider._client.base_url).startswith("https://api.groq.com/openai/v1")
        provider.close()

    def test_unsupported_language_raises_before_request(self):
        called = False

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal called
            called = True
            return httpx.Response(200, json={"choices": [{"message": {"content": "x"}}]})

        provider = GroqProvider(api_key="k", transport=httpx.MockTransport(handler))
        with pytest.raises(ValueError, match="not supported"):
            provider.generate_code("anything", language="brainfuck")
        assert called is False
        provider.close()

    def test_rate_limit_surfaces_as_an_http_error(self):
        provider = GroqProvider(
            api_key="k",
            transport=httpx.MockTransport(
                lambda request: httpx.Response(429, json={"error": {"message": "rate limit"}})
            ),
        )
        with pytest.raises(httpx.HTTPStatusError):
            provider.generate_code("two sum")
        provider.close()

    def test_registry_builds_it_from_the_env_key(self, monkeypatch):
        monkeypatch.setenv("GROQ_API_KEY", "gsk-env")
        provider = get_llm_provider("groq")
        assert isinstance(provider, GroqProvider)
        assert provider._model == "openai/gpt-oss-20b"
        provider.close()

    def test_registry_requires_a_key(self, monkeypatch):
        monkeypatch.delenv("GROQ_API_KEY", raising=False)
        with pytest.raises(ValueError, match="GROQ_API_KEY"):
            get_llm_provider("groq")

    def test_registry_forwards_the_model(self, monkeypatch):
        monkeypatch.delenv("GROQ_API_KEY", raising=False)
        provider = get_llm_provider("groq", api_key="gsk-call", model="qwen/qwen3.8-27b")
        assert provider._model == "qwen/qwen3.8-27b"
        provider.close()

    def test_mock_provider_close_is_a_no_op(self):
        # The pipeline closes every provider it builds; the demo one has no
        # transport to release.
        MockProvider().close()


class TestBlockedPrimaryFallsBack:
    """A 403 from the primary is a *generation* failure, so it must fall back.

    The suite above proves the fallback recovers from a scripted exception and
    that a 429 surfaces as an ``HTTPStatusError``. Neither is quite the failure
    a real environment produces when a provider's edge rejects the worker: a
    WAF answers ``403 Forbidden`` **before auth**, so the request never reaches
    the API and the key is irrelevant. That is a different failure with
    different causes — a bad key, a blocked network, a wrong region — and it is
    the one that actually happens.

    These tests drive a real :class:`GroqProvider` over a mock transport rather
    than a hand-raised error, so what is proven is that the real provider
    surfaces the real 403 as an exception the fallback recovers from.
    """

    @staticmethod
    def _blocked_403(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            403,
            json={"error": {"message": "Access denied. Please check your network settings."}},
        )

    def _patch_real_primary(self, monkeypatch, status: int = 403) -> list[httpx.Request]:
        """Serve ``status`` to the primary Groq provider; record what it was asked.

        The fallback leg is a real :class:`OllamaProvider` over its own mock
        transport, so the whole chain runs the way the worker runs it: a real
        Groq request that is refused, then a real Ollama request that answers.
        """
        seen: list[httpx.Request] = []

        def blocked(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            if status == 403:
                return self._blocked_403(request)
            return httpx.Response(status, json={"error": {"message": "upstream says no"}})

        def answered(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={"response": "```python\ndef two_sum(nums, target):\n    return []\n```"},
            )

        def fake_get_llm_provider(name=None, api_key=None, model=None):
            if str(name) == "groq":
                return GroqProvider(
                    api_key=api_key or "gsk-key-that-never-gets-checked",
                    model=model or "openai/gpt-oss-20b",
                    transport=httpx.MockTransport(blocked),
                )
            return OllamaProvider(
                model=model or "tinyllama",
                base_url="http://ollama.test",
                transport=httpx.MockTransport(answered),
            )

        monkeypatch.setattr("app.services.llm_fallback.get_llm_provider", fake_get_llm_provider)
        return seen

    def test_a_403_from_the_primary_answers_from_the_fallback(self, fallback, monkeypatch):
        fallback("ollama", "tinyllama")
        self._patch_real_primary(monkeypatch, 403)

        result = generate_code(provider_name="groq", prompt="two sum", api_key="gsk-bad")

        assert result.used_fallback is True
        assert result.provider == "ollama"
        assert result.model == "tinyllama"
        assert "def two_sum" in result.code

    def test_the_403_is_reported_as_the_primary_error(self, fallback, monkeypatch):
        """The report has to say *why* the primary was skipped, not just that it was."""
        fallback("ollama", "tinyllama")
        self._patch_real_primary(monkeypatch, 403)

        metrics = generate_code(
            provider_name="groq", prompt="two sum", api_key="gsk-bad"
        ).as_metrics()

        assert metrics["fallback_used"] is True
        assert metrics["fallback_provider"] == "ollama"
        assert metrics["fallback_model"] == "tinyllama"
        assert "403" in metrics["primary_error"]

    def test_a_403_with_no_fallback_configured_still_raises(self, fallback, monkeypatch):
        """Opt-in stays opt-in: blocking the primary must not silently change provider.

        Without this, "the fallback saved the run" and "the run quietly used a
        different model" become indistinguishable from the outside.
        """
        fallback("")  # the default: no fallback
        self._patch_real_primary(monkeypatch, 403)

        with pytest.raises(httpx.HTTPStatusError) as excinfo:
            generate_code(provider_name="groq", prompt="two sum", api_key="gsk-bad")

        assert excinfo.value.response.status_code == 403

    def test_the_key_is_not_the_cause_of_a_403(self, fallback, monkeypatch):
        """A WAF 403 arrives before auth, so a valid-looking key must not help.

        This is the case that made the fallback look broken in a live run: the
        submission's key was deliberately invalid *and* the network was blocked,
        and the only way to tell those apart from the outside is the status
        code and the provider's own message landing in ``primary_error``.
        """
        fallback("ollama", "tinyllama")
        seen = self._patch_real_primary(monkeypatch, 403)

        result = generate_code(
            provider_name="groq", prompt="two sum", api_key="gsk_deliberately_invalid"
        )

        assert len(seen) == 1, "the primary was called exactly once — no retry storm"
        assert seen[0].headers["Authorization"] == "Bearer gsk_deliberately_invalid"
        assert "gsk_deliberately_invalid" not in (result.primary_error or "")


class TestOllamaBaseUrl:
    def test_the_shipped_default_is_the_container_localhost(self):
        # Guard the real setting, not a monkeypatched stand-in: a container's
        # localhost is the container, so compose must override this. If the
        # default ever moves, the override in compose has to move with it.
        from app.config import Settings

        assert Settings().ollama_base_url == "http://localhost:11434"

    def test_the_default_is_the_off_switch_for_the_fallback(self):
        from app.config import Settings

        fresh = Settings()
        assert fresh.llm_fallback_provider == ""
        assert fresh.llm_fallback_model == ""

    def test_defaults_to_localhost(self, monkeypatch):
        monkeypatch.setattr(settings, "ollama_base_url", "http://localhost:11434")
        from app.services.llm_providers import OllamaProvider

        provider = OllamaProvider()
        assert str(provider._client.base_url).startswith("http://localhost:11434")
        provider.close()

    def test_reads_the_configured_url(self, monkeypatch):
        """A containerized worker must reach Ollama on the host, not itself."""
        monkeypatch.setattr(settings, "ollama_base_url", "http://host.docker.internal:11434")
        from app.services.llm_providers import OllamaProvider

        provider = OllamaProvider()
        assert str(provider._client.base_url).startswith("http://host.docker.internal:11434")
        provider.close()

    def test_explicit_argument_wins(self, monkeypatch):
        monkeypatch.setattr(settings, "ollama_base_url", "http://from-settings:11434")
        from app.services.llm_providers import OllamaProvider

        provider = OllamaProvider(base_url="http://explicit:11434")
        assert str(provider._client.base_url).startswith("http://explicit:11434")
        provider.close()


class TestSecretHygiene:
    """A failure summary is logged *and* persisted — a key must not survive it.

    Provider SDKs can echo the request that carried the key into their error
    text, so the summary scrubs the per-run key before it is written anywhere.
    """

    def test_primary_error_never_carries_the_per_run_key(self, monkeypatch):
        monkeypatch.setattr(settings, "llm_fallback_provider", "ollama")
        monkeypatch.setattr(settings, "llm_fallback_model", "tinyllama")

        def fake_get(name, api_key=None, model=None):
            def generate_code(self, prompt, language="python", feedback=None):
                if name == "groq":
                    raise RuntimeError("401 invalid key sk-live-primary-secret")
                return "x = 1"

            return fake_provider(generate_code=generate_code)

        monkeypatch.setattr("app.services.llm_fallback.get_llm_provider", fake_get)

        gen = generate_code(
            provider_name="groq",
            prompt="p",
            api_key="sk-live-primary-secret",
        )
        assert gen.used_fallback is True
        assert "sk-live-primary-secret" not in gen.primary_error
        assert "***" in gen.primary_error
        assert "401" in gen.primary_error
        # The code itself still came through — redaction is not all-or-nothing.
        assert gen.code == "x = 1"

    def test_persisted_metrics_are_scrubbed_too(self, monkeypatch):
        monkeypatch.setattr(settings, "llm_fallback_provider", "ollama")
        monkeypatch.setattr(settings, "llm_fallback_model", "tinyllama")

        def fake_get(name, api_key=None, model=None):
            def generate_code(self, prompt, language="python", feedback=None):
                if name == "groq":
                    raise RuntimeError("bad key sk-leak")
                return "x = 1"

            return fake_provider(generate_code=generate_code)

        monkeypatch.setattr("app.services.llm_fallback.get_llm_provider", fake_get)

        metrics = generate_code(provider_name="groq", prompt="p", api_key="sk-leak").as_metrics()
        assert "sk-leak" not in str(metrics)

    def test_both_failures_in_the_raised_error_are_scrubbed(self, monkeypatch):
        monkeypatch.setattr(settings, "llm_fallback_provider", "anthropic")
        monkeypatch.setattr(settings, "llm_fallback_model", None)
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-env-secret")

        def fake_get(name, api_key=None, model=None):
            def generate_code(self, prompt, language="python", feedback=None):
                if name == "groq":
                    raise RuntimeError("primary rejected sk-primary-key")
                raise RuntimeError("fallback rejected sk-ant-env-secret")

            return fake_provider(generate_code=generate_code)

        monkeypatch.setattr("app.services.llm_fallback.get_llm_provider", fake_get)

        with pytest.raises(GenerationError) as excinfo:
            generate_code(provider_name="groq", prompt="p", api_key="sk-primary-key")

        message = str(excinfo.value)
        assert "sk-primary-key" not in message
        assert "sk-ant-env-secret" not in message
        # Both failures stay visible — only the secrets are removed.
        assert "primary rejected" in message
        assert "fallback rejected" in message

    def test_the_logged_warning_does_not_leak_the_key(self, monkeypatch, caplog):
        monkeypatch.setattr(settings, "llm_fallback_provider", "ollama")
        monkeypatch.setattr(settings, "llm_fallback_model", "tinyllama")

        def fake_get(name, api_key=None, model=None):
            def generate_code(self, prompt, language="python", feedback=None):
                if name == "groq":
                    raise RuntimeError("upstream said sk-log-secret")
                return "x = 1"

            return fake_provider(generate_code=generate_code)

        monkeypatch.setattr("app.services.llm_fallback.get_llm_provider", fake_get)

        with caplog.at_level("WARNING", logger="app.services.llm_fallback"):
            generate_code(provider_name="groq", prompt="p", api_key="sk-log-secret")

        assert "sk-log-secret" not in caplog.text
        assert "retrying with fallback" in caplog.text

    def test_an_unchanged_error_is_left_alone_when_there_is_no_fallback(
        self, fallback, monkeypatch
    ):
        """No fallback configured → the provider's own exception surfaces as-is."""
        fallback(provider="", model="")  # no fallback configured
        _patch_provider(monkeypatch, _down("model not supported"))

        with pytest.raises(_BoomError, match="model not supported"):
            generate_code(provider_name="groq", prompt="p", api_key="sk-whatever")
