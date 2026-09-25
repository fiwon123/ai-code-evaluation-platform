"""LLM model catalog exposed to the UI.

The catalog powers the challenge page's model selector and ``GET
/api/models``. Every model listed here belongs to a provider the backend can
construct (see ``app/services/llm.py``); the provider is responsible for
rejecting unknown model ids at request time.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class LLMModel:
    """A single selectable model for one provider."""

    id: str
    provider: str
    label: str
    description: str


#: Default model per provider — mirrors the provider constructors' defaults in
#: ``app/services/llm_providers/*``. Used to resolve a submission's model when
#: the caller leaves the selector on "provider default".
PROVIDER_DEFAULTS: dict[str, str] = {
    "demo": "mock-coder",
    "openai": "gpt-4o-mini",
    "anthropic": "claude-3-5-haiku-latest",
    "gemini": "gemini-2.0-flash",
    "ollama": "qwen2.5-coder:7b",
}

MODELS_BY_PROVIDER: dict[str, list[LLMModel]] = {
    "demo": [
        LLMModel(
            id="mock-coder",
            provider="demo",
            label="Mock Coder",
            description="Free instant code generation — no API key, no network.",
        ),
    ],
    "openai": [
        LLMModel(
            id="gpt-4o-mini",
            provider="openai",
            label="GPT-4o Mini",
            description="Fast, low-cost workhorse for everyday coding tasks.",
        ),
        LLMModel(
            id="gpt-4o",
            provider="openai",
            label="GPT-4o",
            description="Strong general reasoning and coding ability.",
        ),
        LLMModel(
            id="gpt-4.1-mini",
            provider="openai",
            label="GPT-4.1 Mini",
            description="Latest mini line — cheaper and snappier than 4.1.",
        ),
        LLMModel(
            id="gpt-4.1",
            provider="openai",
            label="GPT-4.1",
            description="High-quality coding with a long context window.",
        ),
        LLMModel(
            id="o4-mini",
            provider="openai",
            label="o4-mini",
            description="Reasoning model for harder algorithmic problems.",
        ),
        LLMModel(
            id="o3",
            provider="openai",
            label="o3",
            description="Deep-reasoning flagship — slower, highest accuracy.",
        ),
    ],
    "anthropic": [
        LLMModel(
            id="claude-3-5-haiku-latest",
            provider="anthropic",
            label="Claude 3.5 Haiku",
            description="Fast and cost-effective for code completion.",
        ),
        LLMModel(
            id="claude-3-5-sonnet-latest",
            provider="anthropic",
            label="Claude 3.5 Sonnet",
            description="Balanced strength for complex coding tasks.",
        ),
        LLMModel(
            id="claude-3-7-sonnet-latest",
            provider="anthropic",
            label="Claude 3.7 Sonnet",
            description="Latest sonnet — extended thinking mode capable.",
        ),
        LLMModel(
            id="claude-3-opus-latest",
            provider="anthropic",
            label="Claude 3 Opus",
            description="Highest-capability model for hard problems.",
        ),
    ],
    "gemini": [
        LLMModel(
            id="gemini-2.0-flash",
            provider="gemini",
            label="Gemini 2.0 Flash",
            description="Fast, multimodal generation for everyday coding.",
        ),
        LLMModel(
            id="gemini-2.5-flash",
            provider="gemini",
            label="Gemini 2.5 Flash",
            description="Newer flash line — faster responses, still strong.",
        ),
        LLMModel(
            id="gemini-2.5-pro",
            provider="gemini",
            label="Gemini 2.5 Pro",
            description="Frontier reasoning with a very long context window.",
        ),
        LLMModel(
            id="gemini-1.5-pro",
            provider="gemini",
            label="Gemini 1.5 Pro",
            description="Previous-gen pro model — reliable and widely available.",
        ),
    ],
    "ollama": [
        LLMModel(
            id="qwen2.5-coder:7b",
            provider="ollama",
            label="Qwen 2.5 Coder 7B",
            description="Local 7B code model — good default for a laptop.",
        ),
        LLMModel(
            id="qwen2.5-coder:14b",
            provider="ollama",
            label="Qwen 2.5 Coder 14B",
            description="Local 14B code model — better accuracy, more RAM.",
        ),
        LLMModel(
            id="qwen2.5-coder:32b",
            provider="ollama",
            label="Qwen 2.5 Coder 32B",
            description="Local 32B code model — near-frontier quality locally.",
        ),
        LLMModel(
            id="codellama",
            provider="ollama",
            label="Code Llama",
            description="Meta's code-specialized Llama family.",
        ),
        LLMModel(
            id="deepseek-coder-v2",
            provider="ollama",
            label="DeepSeek Coder V2",
            description="Open code model with strong reasoning.",
        ),
        LLMModel(
            id="llama3.1",
            provider="ollama",
            label="Llama 3.1",
            description="General-purpose local model that codes well.",
        ),
    ],
}


def all_models() -> list[LLMModel]:
    """Flatten the catalog into one list, keeping provider order stable."""
    return [model for provider in MODELS_BY_PROVIDER for model in MODELS_BY_PROVIDER[provider]]


def is_known_model(model_id: str) -> bool:
    """Return True when ``model_id`` exists anywhere in the catalog."""
    return any(model.id == model_id for model in all_models())


def model_belongs_to_provider(model_id: str, provider: str) -> bool:
    """Return True when ``model_id`` is one of ``provider``'s catalog entries."""
    return any(
        model.id == model_id and model.provider == provider for model in all_models()
    )


def model_default(provider: str) -> str | None:
    """Return the catalog default model id for ``provider`` (None when unknown)."""
    return PROVIDER_DEFAULTS.get(provider)
