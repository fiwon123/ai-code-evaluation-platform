"""The task budget must contain the generation cap it protects (#272).

The limits used to be a flat ``240``/``300`` while a single Ollama generation
may use ``ollama_timeout`` (300s). Nothing caught that, because nothing related
the two numbers: the worker killed the task while the provider was still
legitimately working, and the soft limit surfaced as an ordinary ``Exception``,
so the row was recorded as an opaque provider error.

These tests exist to make the relationship explicit and keep it explicit. They
are cheap and they read like arithmetic on purpose — the bug was two constants
that were individually plausible and jointly wrong.
"""

from __future__ import annotations

import importlib

import pytest
from billiard.exceptions import SoftTimeLimitExceeded

from app.config import settings
from app.core import celery_app as celery_module
from app.core.celery_app import celery_app
from app.tasks.evaluate import _error_kind


def _soft_limit_for(ollama_timeout: int) -> int:
    """The soft limit the module computes for a given generation cap.

    The limits are derived at import time, so the only honest way to test that
    they *track* the setting is to re-derive them the same way and read the
    result. Asserting ``max(900, 60) + 90 == 990`` would only prove arithmetic.
    The module's own ``celery_app`` object is put back afterwards, because other
    modules hold a reference to the original.
    """
    original_setting = settings.ollama_timeout
    original_app = celery_module.celery_app
    try:
        settings.ollama_timeout = ollama_timeout
        importlib.reload(celery_module)
        return celery_module.celery_app.conf.task_soft_time_limit
    finally:
        settings.ollama_timeout = original_setting
        importlib.reload(celery_module)
        celery_module.celery_app = original_app


class TestBudgetContainsTheGenerationCap:
    def test_soft_limit_exceeds_the_generation_cap(self):
        """The regression: 240 < 300, so a full-length generation was killed."""
        assert celery_app.conf.task_soft_time_limit > settings.ollama_timeout

    def test_soft_limit_leaves_room_for_the_test_run(self):
        """A generation that used the whole cap must still leave time to test."""
        assert (
            celery_app.conf.task_soft_time_limit
            >= settings.ollama_timeout + celery_module._TEST_BUDGET_S
        )

    def test_hard_limit_is_beyond_the_soft_limit(self):
        """The gap is what lets the worker unwind and persist the result."""
        assert celery_app.conf.task_time_limit > celery_app.conf.task_soft_time_limit
        assert (
            celery_app.conf.task_time_limit - celery_app.conf.task_soft_time_limit
            == celery_module._HARD_LIMIT_MARGIN_S
        )

    def test_the_limits_are_the_derived_ones(self):
        assert celery_app.conf.task_soft_time_limit == celery_module.ATTEMPT_BUDGET_S
        assert celery_app.conf.task_time_limit == (
            celery_module.ATTEMPT_BUDGET_S + celery_module._HARD_LIMIT_MARGIN_S
        )

    def test_a_larger_generation_cap_raises_the_budget(self):
        """The drift guard that matters: raising OLLAMA_TIMEOUT must not be
        silently clamped by the task's own soft limit, which is exactly what a
        fixed number does to an operator who tunes it."""
        assert _soft_limit_for(900) == 900 + celery_module._TEST_BUDGET_S
        assert _soft_limit_for(900) > _soft_limit_for(300)

    def test_a_smaller_generation_cap_still_clears_the_hosted_providers(self):
        """The hosted providers hardcode a 60s client timeout, so the floor
        exists: an operator who lowers ollama_timeout must not end up with a
        budget below what Groq already spends."""
        assert celery_module._MIN_GENERATION_BUDGET_S == 60
        assert _soft_limit_for(10) == 60 + celery_module._TEST_BUDGET_S

    def test_the_old_values_are_not_reintroduced(self):
        """Catches a straight revert even if the relationship tests are also
        edited alongside it."""
        assert celery_app.conf.task_soft_time_limit != 240
        assert celery_app.conf.task_time_limit != 300


class TestSoftLimitIsClassified:
    def test_soft_time_limit_is_named(self):
        assert _error_kind(SoftTimeLimitExceeded()) == "task_soft_time_limit"

    @pytest.mark.parametrize(
        "exc",
        [
            RuntimeError("403 Access denied"),
            TimeoutError("provider timed out"),
            ValueError("bad response"),
        ],
    )
    def test_other_failures_are_not_classified(self, exc):
        """Unclassified means the key is omitted, so a null never renders."""
        assert _error_kind(exc) is None
