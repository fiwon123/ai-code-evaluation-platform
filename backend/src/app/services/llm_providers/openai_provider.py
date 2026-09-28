from __future__ import annotations

import httpx

from app.services.llm_providers.base import (
    LLMProvider,
    build_user_message,
    get_system_prompt,
    strip_code_fences,
)


class OpenAIProvider(LLMProvider):
    """Code generation via the OpenAI Chat Completions API."""

    name = "openai"

    def __init__(
        self,
        api_key: str,
        model: str = "gpt-4o-mini",
        base_url: str = "https://api.openai.com/v1",
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._api_key = api_key
        self._model = model
        self._client = httpx.Client(
            base_url=base_url,
            transport=transport,
            timeout=60,
            headers={"Authorization": f"Bearer {api_key}"},
        )

    def generate_code(
        self, prompt: str, language: str = "python", feedback: str | None = None
    ) -> str:
        self.validate_language(language)
        response = self._client.post(
            "/chat/completions",
            json={
                "model": self._model,
                "messages": [
                    {"role": "system", "content": get_system_prompt(language)},
                    {"role": "user", "content": build_user_message(prompt, feedback)},
                ],
                "temperature": 0.2,
            },
        )
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
        return strip_code_fences(content)

    def close(self) -> None:
        self._client.close()
