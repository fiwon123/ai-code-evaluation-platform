from __future__ import annotations

import httpx

from app.services.llm_providers.base import (
    LLMProvider,
    build_user_message,
    get_system_prompt,
    strip_code_fences,
)


class GeminiProvider(LLMProvider):
    """Code generation via the Google Gemini (generativelanguage) API."""

    name = "gemini"

    def __init__(
        self,
        api_key: str,
        model: str = "gemini-2.0-flash",
        base_url: str = "https://generativelanguage.googleapis.com/v1beta",
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._api_key = api_key
        self._model = model
        self._client = httpx.Client(base_url=base_url, transport=transport, timeout=60)

    def generate_code(
        self, prompt: str, language: str = "python", feedback: str | None = None
    ) -> str:
        self.validate_language(language)
        response = self._client.post(
            f"/models/{self._model}:generateContent",
            params={"key": self._api_key},
            json={
                "system_instruction": {"parts": [{"text": get_system_prompt(language)}]},
                "contents": [
                    {
                        "role": "user",
                        "parts": [{"text": build_user_message(prompt, feedback)}],
                    }
                ],
                "generationConfig": {"temperature": 0.2},
            },
        )
        response.raise_for_status()
        candidates = response.json().get("candidates") or []
        if not candidates:
            raise ValueError("Gemini returned no candidates")
        parts = candidates[0].get("content", {}).get("parts") or []
        text = "".join(part.get("text", "") for part in parts if isinstance(part, dict))
        return strip_code_fences(text)

    def close(self) -> None:
        self._client.close()
