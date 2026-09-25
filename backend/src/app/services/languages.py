"""Language catalog for the platform.

Two tiers:

- :data:`EXECUTABLE_LANGUAGES` — languages with a sandbox runtime and a test
  harness wired into ``services/language_runner.py``; the demo provider and
  the evaluation engine can run these end-to-end.
- :data:`DISPLAY_ONLY_LANGUAGES` — catalog-only languages. They appear in
  the UI (challenge creation, filters, seed examples) but generation and
  evaluation fail with a clean "not supported" message until a runner and
  provider support are added.

:data:`CATALOG_LANGUAGES` is the full set exposed to users and enforced by
the ``challenges.language`` check constraint.
"""

from __future__ import annotations

EXECUTABLE_LANGUAGES = frozenset(
    {
        "python",
        "javascript",
        "typescript",
        "java",
        "go",
        "c",
        "cpp",
        "rust",
        "php",
        "ruby",
        "perl",
        "kotlin",
        "lua",
    }
)

DISPLAY_ONLY_LANGUAGES = frozenset(
    {
        "csharp",
        "swift",
        "dart",
        "scala",
        "r",
        "haskell",
        "objective-c",
    }
)

CATALOG_LANGUAGES = EXECUTABLE_LANGUAGES | DISPLAY_ONLY_LANGUAGES
