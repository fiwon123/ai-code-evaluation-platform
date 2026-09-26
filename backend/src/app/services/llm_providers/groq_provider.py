from __future__ import annotations

import httpx

from app.services.llm_providers.base import (
    LLMProvider,
    build_user_message,
    get_system_prompt,
    strip_code_fences,
)


class GroqProvider(LLMProvider):
    """Code generation via Groq's OpenAI-compatible Chat Completions API.

    Groq serves the same ``/chat/completions`` shape as OpenAI from its own
    base URL, so this is :class:`OpenAIProvider` with a different endpoint and
    key. It is implemented separately rather than subclassed so the
    ``name``/defaults stay readable side by side with the other providers.
    """

    name = "groq"

    def __init__(
        self,
        api_key: str,
        model: str = "llama-3.1-8b-instant",
        base_url: str = "https://api.groq.com/openai/v1",
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
