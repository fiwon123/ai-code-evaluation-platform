from abc import ABC, abstractmethod

from app.services.languages import EXECUTABLE_LANGUAGES

#: Languages the LLM providers can generate code for. Display-only catalog
#: languages (see ``app.services.languages``) intentionally fail validation
#: here so generation reports a clean "not supported" error.
SUPPORTED_LANGUAGES = EXECUTABLE_LANGUAGES

# Language-aware system prompts: each model must emit only source code, never
# prose or markdown fences. Go additionally requires an explicit `package`
# clause so `go test` can compile the solution; C/C++/Rust/Kotlin need a
# visible `main`/entry point so the harness can compile and run them.
_SYSTEM_PROMPTS: dict[str, str] = {
    "python": (
        "You are a coding assistant. Write a complete, correct Python solution "
        "for the problem described by the user. Output ONLY the source code with "
        "no markdown fences, no explanations, and no tests."
    ),
    "javascript": (
        "You are a coding assistant. Write a complete, correct JavaScript "
        "(Node.js) solution for the problem described by the user. Export any "
        "functions the tests will import. Output ONLY the source code with "
        "no markdown fences, no explanations, and no tests."
    ),
    "typescript": (
        "You are a coding assistant. Write a complete, correct TypeScript "
        "solution for the problem described by the user. Export any functions "
        "the tests will import. Output ONLY the source code with "
        "no markdown fences, no explanations, and no tests."
    ),
    "java": (
        "You are a coding assistant. Write a complete, correct Java solution for "
        "the problem described by the user. Put the solution in a public class "
        "named `Solution`. Output ONLY the source code with no markdown fences, "
        "no explanations, and no tests."
    ),
    "go": (
        "You are a coding assistant. Write a complete, correct Go solution for "
        "the problem described by the user. The file must start with "
        "`package main`. Output ONLY the source code with no markdown fences, "
        "no explanations, and no tests."
    ),
    "c": (
        "You are a coding assistant. Write a complete, correct C11 solution for "
        "the problem described by the user. The file must start with the "
        "required includes and define the functions the tests call; do not add "
        "a main() unless the tests need one. Output ONLY the source code with "
        "no markdown fences, no explanations, and no tests."
    ),
    "cpp": (
        "You are a coding assistant. Write a complete, correct C++17 solution "
        "for the problem described by the user. The file must include the "
        "needed standard headers and define the functions the tests call; do "
        "not add a main() unless the tests need one. Output ONLY the source "
        "code with no markdown fences, no explanations, and no tests."
    ),
    "rust": (
        "You are a coding assistant. Write a complete, correct Rust solution "
        "for the problem described by the user. Define the functions or items "
        "the tests call; do not add a main() unless the tests need one. Output "
        "ONLY the source code with no markdown fences, no explanations, and no "
        "tests."
    ),
    "php": (
        "You are a coding assistant. Write a complete, correct PHP solution "
        "for the problem described by the user. Use `<?php` (no closing tag) "
        "and define the functions the tests call. Output ONLY the source code "
        "with no markdown fences, no explanations, and no tests."
    ),
    "ruby": (
        "You are a coding assistant. Write a complete, correct Ruby solution "
        "for the problem described by the user. Define the methods the tests "
        "call. Output ONLY the source code with no markdown fences, no "
        "explanations, and no tests."
    ),
    "perl": (
        "You are a coding assistant. Write a complete, correct Perl solution "
        "for the problem described by the user. Start with `use strict;` and "
        "`use warnings;` and define the subroutines the tests call. Output "
        "ONLY the source code with no markdown fences, no explanations, and "
        "no tests."
    ),
    "kotlin": (
        "You are a coding assistant. Write a complete, correct Kotlin solution "
        "for the problem described by the user. Put top-level functions or a "
        "solvable class named `Solution` where the tests expect it; do not "
        "wrap code in a package. Output ONLY the source code with no markdown "
        "fences, no explanations, and no tests."
    ),
    "lua": (
        "You are a coding assistant. Write a complete, correct Lua 5.4 "
        "solution for the problem described by the user. Define the functions "
        "the tests call as globals (no module/return wrapping). Output ONLY "
        "the source code with no markdown fences, no explanations, and no "
        "tests."
    ),
}


def get_system_prompt(language: str) -> str:
    """Return the system prompt for ``language`` (falls back to Python's)."""
    return _SYSTEM_PROMPTS.get(language, _SYSTEM_PROMPTS["python"])


#: Prepended to the user message when the worker retries a failed attempt. Kept
#: separate from the per-language system prompts because "fix your own code" is
#: orthogonal to the language.
REPAIR_PREAMBLE = (
    "You are fixing code you wrote yourself for this prompt. The previous "
    "attempt failed its test suite — use the failure output below to produce a "
    "corrected version. Return only the complete corrected source code."
)


def build_user_message(prompt: str, feedback: str | None) -> str:
    """Compose the user turn, appending repair ``feedback`` when present.

    Every provider sends a single user message, so this keeps the repair path
    consistent across them: same ordering, same instruction, no provider needs
    to know the retry protocol.
    """
    if not feedback:
        return prompt
    return f"{REPAIR_PREAMBLE}\n\n{prompt}\n\n{feedback}"


class LLMProvider(ABC):
    """Interface for LLM code generation providers."""

    name: str = "base"

    @abstractmethod
    def generate_code(
        self, prompt: str, language: str = "python", feedback: str | None = None
    ) -> str:
        """Generate a code solution for the given prompt and language.

        ``feedback`` carries the previous attempt's code and failure output
        when the worker is retrying; providers pass it through
        :func:`build_user_message`. Omitted for a first attempt.

        Returns only the source code (no markdown fences, no prose).
        """
        raise NotImplementedError

    def validate_language(self, language: str) -> None:
        """Raise ValueError for languages this provider cannot handle."""
        if language not in SUPPORTED_LANGUAGES:
            raise ValueError(
                f"Language '{language}' is not supported — supported: {sorted(SUPPORTED_LANGUAGES)}"
            )

    def close(self) -> None:
        """Release any transport the provider holds.

        Part of the interface (rather than an optional extra) because the
        evaluation pipeline closes every provider it builds: a submission's
        repair chain constructs a fresh provider per attempt, and the HTTP
        providers each own an ``httpx.Client``. Keyless, in-process providers
        like the demo one have nothing to release.
        """
        return None


def strip_code_fences(code: str) -> str:
    """Remove markdown code fences and surrounding prose from LLM output."""
    text = code.strip()
    if text.startswith("```"):
        first_newline = text.find("\n")
        if first_newline != -1:
            text = text[first_newline + 1 :]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
    elif "```" in text:
        # Extract the first fenced block if present anywhere in the output.
        segments = text.split("```")
        if len(segments) >= 3:
            block = segments[1]
            first_line_end = block.find("\n")
            text = block[first_line_end + 1 :] if first_line_end != -1 else block
            text = text.strip()
    return text
