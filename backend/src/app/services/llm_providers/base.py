from abc import ABC, abstractmethod

SUPPORTED_LANGUAGES = {"python"}


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
