from __future__ import annotations

import httpx

from app.services.llm_providers.base import (
    LLMProvider,
    build_user_message,
    get_system_prompt,
    strip_code_fences,
)


class AnthropicProvider(LLMProvider):
    """Code generation via the Anthropic Messages API."""

    name = "anthropic"

    def __init__(
        self,
        api_key: str,
        model: str = "claude-3-5-haiku-latest",
        base_url: str = "https://api.anthropic.com",
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._api_key = api_key
        self._model = model
        self._client = httpx.Client(
            base_url=base_url,
            transport=transport,
            timeout=60,
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
            },
        )

    def generate_code(
        self, prompt: str, language: str = "python", feedback: str | None = None
    ) -> str:
        self.validate_language(language)
        response = self._client.post(
            "/v1/messages",
            json={
                "model": self._model,
                "max_tokens": 2048,
                "system": get_system_prompt(language),
                "messages": [{"role": "user", "content": build_user_message(prompt, feedback)}],
            },
        )
        response.raise_for_status()
        content = response.json()["content"][0]["text"]
        return strip_code_fences(content)

    def close(self) -> None:
        self._client.close()
