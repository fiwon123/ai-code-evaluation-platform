from __future__ import annotations

import httpx

from app.config import settings
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
        base_url: str | None = None,
        timeout: float | None = None,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._model = model
        # Resolved per construction rather than as a default argument: the
        # worker reads it from the environment at call time, and a containerized
        # worker needs `host.docker.internal`, not its own localhost.
        self._base_url = base_url or settings.ollama_base_url
        # A local model runs on this machine's CPU, so a 1.5B code model can take
        # minutes to emit a solution on a weak host. The hosted providers' 60s is
        # sized for a fast API and would fail a slow-but-correct local run as if
        # Ollama were broken. See `settings.ollama_timeout`.
        self._timeout = settings.ollama_timeout if timeout is None else timeout
        self._client = httpx.Client(
            base_url=self._base_url, transport=transport, timeout=self._timeout
        )

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
