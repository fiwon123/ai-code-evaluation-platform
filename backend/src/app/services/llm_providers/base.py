from abc import ABC, abstractmethod

SUPPORTED_LANGUAGES = {"python", "javascript", "typescript", "java", "go"}

# Language-aware system prompts: each model must emit only source code, never
# prose or markdown fences. Go additionally requires an explicit `package`
# clause so `go test` can compile the solution.
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
}


def get_system_prompt(language: str) -> str:
    """Return the system prompt for ``language`` (falls back to Python's)."""
    return _SYSTEM_PROMPTS.get(language, _SYSTEM_PROMPTS["python"])


class LLMProvider(ABC):
    """Interface for LLM code generation providers."""

    name: str = "base"

    @abstractmethod
    def generate_code(self, prompt: str, language: str = "python") -> str:
        """Generate a code solution for the given prompt and language.

        Returns only the source code (no markdown fences, no prose).
        """
        raise NotImplementedError

    def validate_language(self, language: str) -> None:
        """Raise ValueError for languages this provider cannot handle."""
        if language not in SUPPORTED_LANGUAGES:
            raise ValueError(
                f"Language '{language}' is not supported — supported: {sorted(SUPPORTED_LANGUAGES)}"
            )


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
