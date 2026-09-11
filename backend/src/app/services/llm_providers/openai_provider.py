from __future__ import annotations

import httpx

from app.services.llm_providers.base import LLMProvider, strip_code_fences

SYSTEM_PROMPT = (
    "You are a coding assistant. Write a complete, correct Python solution "
    "for the problem described by the user. Output ONLY the source code with "
    "no markdown fences, no explanations, and no tests."
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

    def generate_code(self, prompt: str, language: str = "python") -> str:
        self.validate_language(language)
        response = self._client.post(
            "/chat/completions",
            json={
                "model": self._model,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.2,
            },
        )
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
        return strip_code_fences(content)

    def close(self) -> None:
        self._client.close()
