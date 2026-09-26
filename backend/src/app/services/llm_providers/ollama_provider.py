from __future__ import annotations

import httpx

from app.services.llm_providers.base import (
    LLMProvider,
    build_user_message,
    get_system_prompt,
    strip_code_fences,
)


class OllamaProvider(LLMProvider):
    """Code generation via a local Ollama server (no API key)."""

    name = "ollama"

    def __init__(
        self,
        model: str = "qwen2.5-coder:7b",
        base_url: str = "http://localhost:11434",
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._model = model
        self._client = httpx.Client(base_url=base_url, transport=transport, timeout=60)

    def generate_code(
        self, prompt: str, language: str = "python", feedback: str | None = None
    ) -> str:
        self.validate_language(language)
        response = self._client.post(
            "/api/generate",
            json={
                "model": self._model,
                "system": get_system_prompt(language),
                "prompt": build_user_message(prompt, feedback),
                "stream": False,
            },
        )
        response.raise_for_status()
        text = response.json().get("response", "")
        return strip_code_fences(text)

    def close(self) -> None:
        self._client.close()
