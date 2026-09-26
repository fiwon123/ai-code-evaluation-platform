"""Fallback chain for code generation.

One LLM call is one chance to produce code, and providers fail for reasons that
have nothing to do with the challenge: a free tier runs out of quota, a gateway
returns 429, a laptop's Ollama server is not running, a key was mistyped. Every
one of those is a *generation* failure, so today it burns the whole submission
for a score of 0 — the sandbox is never even reached.

This module wraps the single ``generate_code`` call the pipeline makes: if the
primary provider raises, one retry is made with a configured fallback provider
(typically a small local model behind a generous cloud provider). The caller
records which provider actually produced the code, so a run served by the
fallback is visible in the report instead of silently looking like a normal one.

Deliberately narrow:

* **generation only.** A sandbox failure (code that does not compile, a test
  that hangs) is the *model's* problem, not the transport's — the repair loop
  in ``tasks/evaluate.py`` already handles it by feeding the failure back.
* **one retry, no chain.** A second failure surfaces the combined error. A
  longer chain would multiply latency on an already-slow worker and hide which
  provider was actually at fault.
* **opt-in.** With no ``llm_fallback_provider`` configured the primary error is
  re-raised unchanged, so existing behaviour is bit-for-bit identical.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass

from app.config import settings
from app.services.llm import KEYED_PROVIDERS, get_llm_provider

logger = logging.getLogger(__name__)

#: Cap on how much of the primary error is carried into metrics/logs. Provider
#: errors can embed the whole request (and with it a key fragment), and this
#: string is persisted and rendered in the report.
MAX_ERROR_CHARS = 300


@dataclass
class Generation:
    """One successful generation and the provenance needed to report it."""

    code: str
    provider: str
    model: str | None
    #: True when the primary provider failed and this code came from the
    #: fallback. ``primary_error`` then explains what went wrong.
    used_fallback: bool = False
    primary_error: str | None = None

    def as_metrics(self) -> dict[str, object]:
        """Metrics describing provenance, for the result row.

        Empty when the primary provider worked, so a normal run's metrics are
        exactly what they were before this feature existed.
        """
        if not self.used_fallback:
            return {}
        return {
            "fallback_used": True,
            "fallback_provider": self.provider,
            "fallback_model": self.model or "provider default",
            "primary_error": self.primary_error,
        }


class GenerationError(RuntimeError):
    """Both the primary and the fallback provider failed."""


def _redact(text: str, *secrets: str | None) -> str:
    """Strip known key material out of a string that is about to be kept.

    Both failure paths here are *logged* and, for a successful fallback, the
    primary error is *persisted* as a result metric and rendered in the report.
    Provider errors can echo the request that carried the key, so the key has to
    be scrubbed here — upstream, before the value reaches any of those.
    """
    for secret in secrets:
        if secret:
            text = text.replace(secret, "***")
    return text


def _env_key(provider_name: str) -> str | None:
    """The key a keyed provider would read from the environment, if any.

    A fallback is normally keyless (a local Ollama), but a *keyed* fallback reads
    its own variable through ``KEYED_PROVIDERS``. That key can end up inside the
    error the process persists, so it is treated as a secret to redact too.
    """
    env_var = KEYED_PROVIDERS.get(provider_name.lower())
    return os.getenv(env_var) if env_var else None


def _summarize(exc: BaseException, *secrets: str | None) -> str:
    """One short, single-line, key-free description of a failure, capped in total.

    The cap is applied to the finished string, not just the exception text: the
    class name is part of the message, and this value is persisted as a metric
    and rendered in the report.
    """
    text = " ".join(str(exc).split()) or exc.__class__.__name__
    summary = _redact(f"{exc.__class__.__name__}: {text}", *secrets)
    if len(summary) > MAX_ERROR_CHARS:
        summary = summary[: MAX_ERROR_CHARS - 1] + "…"
    return summary


def _generate(
    provider_name: str,
    *,
    api_key: str | None,
    model: str | None,
    prompt: str,
    language: str,
    feedback: str | None,
) -> str:
    """Run one generation through ``provider_name`` and close its client."""
    provider = get_llm_provider(provider_name, api_key=api_key, model=model)
    try:
        return provider.generate_code(prompt, language, feedback=feedback)
    finally:
        # The task used to leave the httpx client open; a repair chain builds a
        # new provider per attempt, so closing here keeps the worker from
        # accumulating sockets across a submission's attempts.
        provider.close()


def generate_code(
    *,
    provider_name: str,
    prompt: str,
    language: str = "python",
    feedback: str | None = None,
    api_key: str | None = None,
    model: str | None = None,
) -> Generation:
    """Generate code, retrying once with the configured fallback on failure.

    Raises the provider's own exception when no fallback is configured, and a
    :class:`GenerationError` naming both failures when the fallback also fails —
    the original error is the more useful of the two, so it leads the message.
    """
    try:
        code = _generate(
            provider_name,
            api_key=api_key,
            model=model,
            prompt=prompt,
            language=language,
            feedback=feedback,
        )
    except Exception as primary:  # noqa: BLE001 - any provider failure may fall back
        fallback_name = (settings.llm_fallback_provider or "").strip()
        if not fallback_name:
            raise
        if fallback_name.lower() == provider_name.lower():
            # A self-referential fallback would just repeat the same failure
            # (same key, same network path) and double the latency.
            logger.warning(
                "Fallback provider %r matches the primary provider for %s — skipping",
                fallback_name,
                provider_name,
            )
            raise

        primary_error = _summarize(primary, api_key)
        logger.warning(
            "Generation failed on %s (%s) — retrying with fallback %r/%s",
            provider_name,
            primary_error,
            fallback_name,
            settings.llm_fallback_model or "provider default",
        )
        try:
            code = _generate(
                fallback_name,
                # Deliberately no key: a fallback is expected to be keyless
                # (a local model), and reusing the primary's key would send it
                # to a different vendor's API. A keyed fallback can still read
                # its own environment variable through KEYED_PROVIDERS.
                api_key=None,
                model=settings.llm_fallback_model or None,
                prompt=prompt,
                language=language,
                feedback=feedback,
            )
        except Exception as secondary:  # noqa: BLE001 - reported as one failure
            secondary_error = _summarize(secondary, _env_key(fallback_name))
            logger.error(
                "Fallback %r also failed for a %s submission: %s",
                fallback_name,
                provider_name,
                secondary_error,
            )
            raise GenerationError(
                f"{provider_name} generation failed ({primary_error}) and the "
                f"{fallback_name} fallback failed too ({secondary_error})"
            ) from secondary

        return Generation(
            code=code,
            provider=fallback_name,
            model=settings.llm_fallback_model or None,
            used_fallback=True,
            primary_error=primary_error,
        )

    return Generation(code=code, provider=provider_name, model=model)
