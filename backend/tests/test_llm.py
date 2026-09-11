import json

import httpx
import pytest

from app.services.llm import get_llm_provider
from app.services.llm_providers import (
    AnthropicProvider,
    MockProvider,
    OpenAIProvider,
    strip_code_fences,
)


class TestMockProvider:
    def test_generates_two_sum(self):
        code = MockProvider().generate_code(
            "Write a function two_sum that returns indices of two numbers that add up to a target"
        )
        assert "def two_sum(nums, target)" in code

    def test_generates_fizzbuzz(self):
        code = MockProvider().generate_code("Implement fizzbuzz for a number n")
        assert "def fizzbuzz(n)" in code

    def test_generates_fibonacci(self):
        code = MockProvider().generate_code("Return fibonacci sequence of length n")
        assert "def fibonacci(n)" in code

    def test_keyword_overlap_prefers_more_specific(self):
        # "two sum" contains "sum" — the more specific two_sum solution wins.
        code = MockProvider().generate_code("Solve two sum problem")
        assert "def two_sum" in code
        assert "def sum_list" not in code

    def test_unknown_prompt_returns_fallback(self):
        code = MockProvider().generate_code("Write a completely novel quantum algorithm")
        assert "def solution(*args)" in code

    def test_unsupported_language_raises(self):
        with pytest.raises(ValueError, match="not supported"):
            MockProvider().generate_code("anything", language="javascript")


class TestStripCodeFences:
    def test_plain_code_passthrough(self):
        assert strip_code_fences("def f():\n    pass") == "def f():\n    pass"

    def test_fenced_python_block(self):
        text = "```python\ndef f():\n    return 1\n```"
        assert strip_code_fences(text) == "def f():\n    return 1"

    def test_fenced_block_with_prose(self):
        text = "Here you go:\n```python\ndef f():\n    return 1\n```\nDone."
        assert strip_code_fences(text) == "def f():\n    return 1"


# OpenAI/Anthropic helpers
def _openai_handler(request: httpx.Request) -> httpx.Response:
    body = json.loads(request.content)
    assert body["model"] == "gpt-4o-mini"
    assert "system" in body["messages"][0]["role"]
    content = "```python\ndef two_sum(nums, target):\n    return []\n```"
    return httpx.Response(
        200,
        json={"choices": [{"message": {"content": content}}]},
    )


def _anthropic_handler(request: httpx.Request) -> httpx.Response:
    body = json.loads(request.content)
    assert body["model"] == "claude-3-5-haiku-latest"
    assert body["messages"][0]["role"] == "user"
    return httpx.Response(
        200,
        json={"content": [{"type": "text", "text": "def fibonacci(n):\n    return [0, 1]\n"}]},
    )


class TestOpenAIProvider:
    def test_generate_code_calls_api_and_strips_fences(self):
        provider = OpenAIProvider(
            api_key="test-key",
            transport=httpx.MockTransport(_openai_handler),
        )
        code = provider.generate_code("two sum please")
        assert code == "def two_sum(nums, target):\n    return []"
        provider.close()

    def test_missing_key_still_constructs_but_request_fails(self):
        # Construction is cheap; auth errors surface via raise_for_status.
        provider = OpenAIProvider(
            api_key="",
            transport=httpx.MockTransport(
                lambda request: httpx.Response(401, json={"error": "bad key"})
            ),
        )
        with pytest.raises(httpx.HTTPStatusError):
            provider.generate_code("two sum")
        provider.close()


class TestAnthropicProvider:
    def test_generate_code_calls_api(self):
        provider = AnthropicProvider(
            api_key="test-key",
            transport=httpx.MockTransport(_anthropic_handler),
        )
        code = provider.generate_code("fibonacci")
        assert code == "def fibonacci(n):\n    return [0, 1]"
        provider.close()

    def test_unsupported_language_raises_before_request(self):
        provider = AnthropicProvider(
            api_key="test-key",
            transport=httpx.MockTransport(_anthropic_handler),
        )
        with pytest.raises(ValueError, match="not supported"):
            provider.generate_code("anything", language="go")
        provider.close()


class TestGetLLMProvider:
    def test_default_is_demo(self, monkeypatch):
        monkeypatch.setattr("app.services.llm.settings.llm_provider", "demo")
        provider = get_llm_provider()
        assert isinstance(provider, MockProvider)

    def test_explicit_demo(self):
        assert isinstance(get_llm_provider("demo"), MockProvider)

    def test_openai_requires_key(self, monkeypatch):
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        with pytest.raises(ValueError, match="OPENAI_API_KEY"):
            get_llm_provider("openai")

    def test_anthropic_requires_key(self, monkeypatch):
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        with pytest.raises(ValueError, match="ANTHROPIC_API_KEY"):
            get_llm_provider("anthropic")

    def test_openai_with_key(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        assert isinstance(get_llm_provider("openai"), OpenAIProvider)

    def test_unknown_provider_raises(self):
        with pytest.raises(ValueError, match="Unknown LLM provider"):
            get_llm_provider("gemini")
