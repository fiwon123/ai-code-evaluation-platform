import json

import httpx
import pytest

from app.services.llm import get_llm_provider
from app.services.llm_providers import (
    AnthropicProvider,
    GeminiProvider,
    MockProvider,
    OllamaProvider,
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
        # The good fizzbuzz example handles the empty/negative edge cases.
        assert "if n <= 0" in code

    def test_generates_fizzbuzz_empty_edges_every_language(self):
        # Every executable language's fizzbuzz solution guards n <= 0.
        edge_guards = {
            "python": "if n <= 0",
            "javascript": "if (n <= 0) return []",
            "typescript": "if (n <= 0) return []",
            "java": "if (n <= 0) return result",
            "go": "if n <= 0",
            "c": "if (n <= 0)",
            "cpp": "if (n <= 0) return result;",
            "rust": "if n <= 0 { return Vec::new(); }",
            "php": "if ($n <= 0) return [];",
            "ruby": "return [] if n <= 0",
            "perl": "return \\@result if $n <= 0;",
            "lua": "if n <= 0 then return result end",
            "kotlin": "if (n <= 0) return emptyList()",
        }
        for language, guard in edge_guards.items():
            code = MockProvider().generate_code("fizzbuzz", language=language)
            assert guard in code, f"missing n<=0 guard for {language}"

    def test_generates_valid_parentheses(self):
        code = MockProvider().generate_code(
            "Write a function valid_parentheses that checks balanced brackets"
        )
        assert "def valid_parentheses(s)" in code

    def test_generates_valid_parentheses_every_language(self):
        signatures = {
            "python": "def valid_parentheses(s)",
            "javascript": "function validParentheses(s)",
            "typescript": "export function validParentheses(s: string): boolean",
            "java": "public static boolean validParentheses(String s)",
            "go": "func ValidParentheses(s string) bool",
            "c": "bool valid_parentheses(const char* s)",
            "cpp": "bool valid_parentheses(const std::string& s)",
            "rust": "pub fn valid_parentheses(s: &str) -> bool",
            "php": "function valid_parentheses(string $s): bool",
            "ruby": "def valid_parentheses(s)",
            "perl": "sub valid_parentheses {",
            "lua": "function valid_parentheses(s)",
            "kotlin": "fun validParentheses(s: String): Boolean",
        }
        for language, signature in signatures.items():
            code = MockProvider().generate_code("valid parentheses", language=language)
            assert signature in code, f"missing valid_parentheses for {language}"

    def test_generates_longest_common_prefix(self):
        code = MockProvider().generate_code(
            "Find the longest common prefix among a list of strings"
        )
        assert "def longest_common_prefix(strs)" in code

    def test_generates_longest_common_prefix_every_language(self):
        signatures = {
            "python": "def longest_common_prefix(strs)",
            "javascript": "function longestCommonPrefix(strs)",
            "typescript": "export function longestCommonPrefix(strs: string[]): string",
            "java": "public static String longestCommonPrefix(String[] strs)",
            "go": "func LongestCommonPrefix(strs []string) string",
            "c": "char* longest_common_prefix(char** strs, int strs_size)",
            "cpp": "std::string longest_common_prefix(const std::vector<std::string>& strs)",
            "rust": "pub fn longest_common_prefix(strs: &[&str]) -> String",
            "php": "function longest_common_prefix(array $strs): string",
            "ruby": "def longest_common_prefix(strs)",
            "perl": "sub longest_common_prefix {",
            "lua": "function longest_common_prefix(strs)",
            "kotlin": "fun longestCommonPrefix(strs: Array<String>): String",
        }
        for language, signature in signatures.items():
            code = MockProvider().generate_code("longest common prefix", language=language)
            assert signature in code, f"missing longest_common_prefix for {language}"

    def test_camelcase_alias_for_new_keywords(self):
        # Frontend prompts may use camelCase forms ("validParentheses").
        code = MockProvider().generate_code("Write validParentheses", language="javascript")
        assert "function validParentheses" in code

    def test_all_languages_share_the_core_keyword_set(self):
        # The example corpus is mirrored across every executable language. The
        # five original languages also keep the extra trapping_rain_water
        # example, so the guarantee is a shared core, not identical sets.
        from app.services.languages import EXECUTABLE_LANGUAGES
        from app.services.llm_providers.mock_provider import SOLUTIONS_BY_LANGUAGE

        assert set(SOLUTIONS_BY_LANGUAGE) == EXECUTABLE_LANGUAGES
        core = {
            "two_sum",
            "valid_parentheses",
            "longest_common_prefix",
            "fizzbuzz",
            "fibonacci",
        }
        for language, solutions in SOLUTIONS_BY_LANGUAGE.items():
            assert core <= set(solutions), f"{language} is missing core keywords"
        # The original five retain the hard Trapping Rain Water example.
        for language in ("python", "javascript", "typescript", "java", "go"):
            assert "trapping_rain_water" in SOLUTIONS_BY_LANGUAGE[language]

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
            MockProvider().generate_code("anything", language="csharp")

    def test_generates_javascript_solution(self):
        code = MockProvider().generate_code(
            "Write a function twoSum for a two sum problem",
            language="javascript",
        )
        assert "function twoSum" in code
        assert "module.exports" in code

    def test_generates_typescript_solution(self):
        code = MockProvider().generate_code("twoSum", language="typescript")
        assert "export function twoSum" in code

    def test_generates_java_solution(self):
        code = MockProvider().generate_code("two sum", language="java")
        assert "public class Solution" in code
        assert "public static int[] twoSum" in code

    def test_generates_go_solution(self):
        code = MockProvider().generate_code("two sum", language="go")
        assert code.startswith("package main")
        assert "func TwoSum" in code

    def test_camelcase_prompt_matches(self):
        # Frontend prompts use camelCase ("isPrime") — must resolve to is_prime.
        code = MockProvider().generate_code("Write isPrime check", language="javascript")
        assert "function isPrime" in code

    def test_unknown_prompt_returns_language_fallback(self):
        code = MockProvider().generate_code("novel algorithm", language="go")
        assert code.startswith("package main")
        assert "func Solution" in code


class TestStripCodeFences:
    def test_plain_code_passthrough(self):
        assert strip_code_fences("def f():\n    pass") == "def f():\n    pass"

    def test_fenced_python_block(self):
        text = "```python\ndef f():\n    return 1\n```"
        assert strip_code_fences(text) == "def f():\n    return 1"

    def test_fenced_block_with_prose(self):
        text = "Here you go:\n```python\ndef f():\n    return 1\n```\nDone."
        assert strip_code_fences(text) == "def f():\n    return 1"

    def test_mid_string_fence_without_language_tag(self):
        text = "Sure, one moment.\n```\ndef f():\n    return 1\n```"
        assert strip_code_fences(text) == "def f():\n    return 1"

    def test_single_fence_does_not_split(self):
        # An odd/unbalanced fence leaves the text mostly untouched.
        text = "Here is ```python\ncode\n"
        assert "code" in strip_code_fences(text)


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
            provider.generate_code("anything", language="csharp")
        provider.close()


# Gemini/Ollama helpers
def _gemini_handler(request: httpx.Request) -> httpx.Response:
    assert request.url.params["key"] == "test-gemini-key"
    assert "gemini-2.0-flash:generateContent" in str(request.url)
    body = json.loads(request.content)
    assert "system_instruction" in body
    content = "```python\ndef two_sum(nums, target):\n    return []\n```"
    return httpx.Response(
        200,
        json={"candidates": [{"content": {"parts": [{"text": content}]}}]},
    )


def _ollama_handler(request: httpx.Request) -> httpx.Response:
    body = json.loads(request.content)
    assert body["model"] == "qwen2.5-coder:7b"
    assert body["stream"] is False
    assert "system" in body
    return httpx.Response(
        200,
        json={
            "model": "qwen2.5-coder:7b",
            "response": "def fibonacci(n):\n    return [0, 1]",
            "done": True,
        },
    )


class TestGeminiProvider:
    def test_generate_code_calls_api_and_strips_fences(self):
        provider = GeminiProvider(
            api_key="test-gemini-key",
            transport=httpx.MockTransport(_gemini_handler),
        )
        code = provider.generate_code("two sum please")
        assert code == "def two_sum(nums, target):\n    return []"
        provider.close()

    def test_no_candidates_raises(self):
        provider = GeminiProvider(
            api_key="test-gemini-key",
            transport=httpx.MockTransport(
                lambda request: httpx.Response(200, json={"candidates": []})
            ),
        )
        with pytest.raises(ValueError, match="no candidates"):
            provider.generate_code("anything")
        provider.close()

    def test_unsupported_language_raises_before_request(self):
        provider = GeminiProvider(
            api_key="test-gemini-key",
            transport=httpx.MockTransport(_gemini_handler),
        )
        with pytest.raises(ValueError, match="not supported"):
            provider.generate_code("anything", language="csharp")
        provider.close()

    def test_http_error_surfaces(self):
        provider = GeminiProvider(
            api_key="bad",
            transport=httpx.MockTransport(
                lambda request: httpx.Response(403, json={"error": "permission denied"})
            ),
        )
        with pytest.raises(httpx.HTTPStatusError):
            provider.generate_code("two sum")
        provider.close()


class TestOllamaProvider:
    def test_generate_code_calls_local_api(self):
        provider = OllamaProvider(transport=httpx.MockTransport(_ollama_handler))
        code = provider.generate_code("fibonacci")
        assert code == "def fibonacci(n):\n    return [0, 1]"
        provider.close()

    def test_different_model_via_constructor(self):
        def handler(request: httpx.Request) -> httpx.Response:
            body = json.loads(request.content)
            assert body["model"] == "codellama"
            return httpx.Response(200, json={"response": "def f():\n    pass", "done": True})

        provider = OllamaProvider(model="codellama", transport=httpx.MockTransport(handler))
        assert "def f():" in provider.generate_code("anything")
        provider.close()

    def test_connection_error_surfaces(self):
        provider = OllamaProvider(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(500, json={"error": "server error"})
            )
        )
        with pytest.raises(httpx.HTTPStatusError):
            provider.generate_code("fibonacci")
        provider.close()


class TestProviderErrorPaths:
    """HTTP failures (rate limits, server errors) must surface as errors."""

    def test_openai_429_rate_limit_raises(self):
        provider = OpenAIProvider(
            api_key="test-key",
            transport=httpx.MockTransport(
                lambda request: httpx.Response(429, json={"error": {"message": "rate limited"}})
            ),
        )
        with pytest.raises(httpx.HTTPStatusError):
            provider.generate_code("two sum")
        provider.close()

    def test_openai_500_server_error_raises(self):
        provider = OpenAIProvider(
            api_key="test-key",
            transport=httpx.MockTransport(
                lambda request: httpx.Response(500, json={"error": "boom"})
            ),
        )
        with pytest.raises(httpx.HTTPStatusError):
            provider.generate_code("two sum")
        provider.close()

    def test_anthropic_429_rate_limit_raises(self):
        provider = AnthropicProvider(
            api_key="test-key",
            transport=httpx.MockTransport(
                lambda request: httpx.Response(429, json={"error": "rate limited"})
            ),
        )
        with pytest.raises(httpx.HTTPStatusError):
            provider.generate_code("fibonacci")
        provider.close()

    def test_anthropic_500_server_error_raises(self):
        provider = AnthropicProvider(
            api_key="test-key",
            transport=httpx.MockTransport(
                lambda request: httpx.Response(500, json={"error": "boom"})
            ),
        )
        with pytest.raises(httpx.HTTPStatusError):
            provider.generate_code("fibonacci")
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

    def test_openai_explicit_key_without_env(self, monkeypatch):
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        provider = get_llm_provider("openai", api_key="sk-call")
        assert isinstance(provider, OpenAIProvider)

    def test_openai_explicit_key_preferred_over_env(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-env")
        provider = get_llm_provider("openai", api_key="sk-call")
        assert isinstance(provider, OpenAIProvider)

    def test_anthropic_explicit_key_without_env(self, monkeypatch):
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        provider = get_llm_provider("anthropic", api_key="sk-ant-call")
        assert isinstance(provider, AnthropicProvider)

    def test_anthropic_requires_key(self, monkeypatch):
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        with pytest.raises(ValueError, match="ANTHROPIC_API_KEY"):
            get_llm_provider("anthropic")

    def test_openai_with_key(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        assert isinstance(get_llm_provider("openai"), OpenAIProvider)

    def test_gemini_requires_key(self, monkeypatch):
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        with pytest.raises(ValueError, match="GEMINI_API_KEY"):
            get_llm_provider("gemini")

    def test_gemini_explicit_key_without_env(self, monkeypatch):
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        provider = get_llm_provider("gemini", api_key="sk-gem-call")
        assert isinstance(provider, GeminiProvider)

    def test_gemini_env_key(self, monkeypatch):
        monkeypatch.setenv("GEMINI_API_KEY", "sk-gem-env")
        assert isinstance(get_llm_provider("gemini"), GeminiProvider)

    def test_ollama_is_keyless(self, monkeypatch):
        # No API key and no env var — Ollama must still construct (local server).
        monkeypatch.delenv("OLLAMA_API_KEY", raising=False)
        provider = get_llm_provider("ollama")
        assert isinstance(provider, OllamaProvider)

    def test_unknown_provider_raises(self):
        with pytest.raises(ValueError, match="Unknown LLM provider"):
            get_llm_provider("watson")

    def test_model_forwarded_to_keyed_provider(self, monkeypatch):
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        provider = get_llm_provider("openai", api_key="sk-call", model="gpt-4o")
        assert isinstance(provider, OpenAIProvider)
        assert provider._model == "gpt-4o"

    def test_model_forwarded_to_ollama(self):
        provider = get_llm_provider("ollama", model="codellama")
        assert isinstance(provider, OllamaProvider)
        assert provider._model == "codellama"

    def test_model_ignored_when_default_for_keyed_provider(self, monkeypatch):
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        provider = get_llm_provider("openai", api_key="sk-call")
        assert provider._model == "gpt-4o-mini"

    def test_demo_ignores_model(self):
        # The demo provider is fixed — passing a model must not break it.
        assert isinstance(get_llm_provider("demo", model="mock-coder"), MockProvider)
