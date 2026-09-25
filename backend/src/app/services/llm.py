import os

from app.config import settings
from app.services.llm_providers import (
    LLMProvider,
    MockProvider,
)
from app.services.llm_providers.anthropic_provider import AnthropicProvider
from app.services.llm_providers.gemini_provider import GeminiProvider
from app.services.llm_providers.ollama_provider import OllamaProvider
from app.services.llm_providers.openai_provider import OpenAIProvider

#: Provider registry: name → provider class. The registry is data-driven —
#: add a provider here and (if it needs a key) in KEYED_PROVIDERS below.
_PROVIDERS: dict[str, type[LLMProvider]] = {
    "demo": MockProvider,
    "openai": OpenAIProvider,
    "anthropic": AnthropicProvider,
    "gemini": GeminiProvider,
    "ollama": OllamaProvider,
}

#: Providers that need an API key to generate code, mapped to the environment
#: variable the worker falls back to when no per-run key is supplied. Mirrors
#: ``KEY_REQUIRED_PROVIDERS`` in app/schemas/submission.py (validation) and the
#: requiresKey list in frontend/src/pages/ChallengeDetail.tsx — keep in sync.
#: Keyless providers (demo, ollama) are deliberately absent.
KEYED_PROVIDERS = {
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "gemini": "GEMINI_API_KEY",
}


def get_llm_provider(name: str | None = None, api_key: str | None = None) -> LLMProvider:
    """Return an LLM provider by name (falling back to configured default).

    ``demo`` is the free, network-independent provider; ``ollama`` targets a
    local Ollama server and needs no key. The keyed providers (``openai``,
    ``anthropic``, ``gemini``) require an API key — provided per-call via
    ``api_key`` or via the matching environment variable — and raise
    ``ValueError`` when the key is missing so callers can surface a clear
    failure.
    """
    provider_name = (name or settings.llm_provider or "demo").lower()
    provider_cls = _PROVIDERS.get(provider_name)
    if provider_cls is None:
        raise ValueError(
            f"Unknown LLM provider '{provider_name}' — available: {sorted(_PROVIDERS)}"
        )

    env_var = KEYED_PROVIDERS.get(provider_name)
    if env_var:
        key = api_key or os.getenv(env_var)
        if not key:
            raise ValueError(
                f"API key missing for '{provider_name}' — provide an api_key or set {env_var}"
            )
        return provider_cls(api_key=key)

    return provider_cls()
