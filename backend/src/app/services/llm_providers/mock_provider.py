from __future__ import annotations

from typing import TYPE_CHECKING

from app.services.llm_providers.base import LLMProvider

if TYPE_CHECKING:
    pass

# Named solutions keyed by prompt keyword (case-insensitive).
# Each solution must define a single function; tests import from solution.py.
SOLUTIONS: dict[str, str] = {
    "two_sum": (
        "def two_sum(nums, target):\n"
        "    seen = {}\n"
        "    for i, num in enumerate(nums):\n"
        "        complement = target - num\n"
        "        if complement in seen:\n"
        "            return [seen[complement], i]\n"
        "        seen[num] = i\n"
        "    return []\n"
    ),
    "fizzbuzz": (
        "def fizzbuzz(n):\n"
        "    result = []\n"
        "    for i in range(1, n + 1):\n"
        "        if i % 15 == 0:\n"
        "            result.append('FizzBuzz')\n"
        "        elif i % 3 == 0:\n"
        "            result.append('Fizz')\n"
        "        elif i % 5 == 0:\n"
        "            result.append('Buzz')\n"
        "        else:\n"
        "            result.append(str(i))\n"
        "    return result\n"
    ),
    "fibonacci": (
        "def fibonacci(n):\n"
        "    if n <= 0:\n"
        "        return []\n"
        "    if n == 1:\n"
        "        return [0]\n"
        "    seq = [0, 1]\n"
        "    while len(seq) < n:\n"
        "        seq.append(seq[-1] + seq[-2])\n"
        "    return seq\n"
    ),
    "palindrome": (
        "def is_palindrome(s):\n"
        "    cleaned = ''.join(c.lower() for c in s if c.isalnum())\n"
        "    return cleaned == cleaned[::-1]\n"
    ),
    "reverse": (
        "def reverse_string(s):\n"
        "    return s[::-1]\n"
    ),
    "factorial": (
        "def factorial(n):\n"
        "    if n < 0:\n"
        "        raise ValueError('n must be non-negative')\n"
        "    result = 1\n"
        "    for i in range(2, n + 1):\n"
        "        result *= i\n"
        "    return result\n"
    ),
    "is_prime": (
        "def is_prime(n):\n"
        "    if n < 2:\n"
        "        return False\n"
        "    for i in range(2, int(n ** 0.5) + 1):\n"
        "        if n % i == 0:\n"
        "            return False\n"
        "    return True\n"
    ),
    "sum": (
        "def sum_list(nums):\n"
        "    return sum(nums)\n"
    ),
    "sort": (
        "def sort_list(items):\n"
        "    return sorted(items)\n"
    ),
    "max": (
        "def find_max(nums):\n"
        "    if not nums:\n"
        "        return None\n"
        "    return max(nums)\n"
    ),
}

DEFAULT_SOLUTION = (
    "def solution(*args):\n"
    "    \"\"\"Default fallback for unrecognized prompts.\"\"\"\n"
    "    return None\n"
)


class MockProvider(LLMProvider):
    """Deterministic demo provider — no API key or network required."""

    name = "demo"

    def __init__(self) -> None:
        self._solutions: dict[str, str] = SOLUTIONS

    def generate_code(self, prompt: str, language: str = "python") -> str:
        self.validate_language(language)
        normalized = prompt.lower()
        for keyword, solution in self._solutions.items():
            # Match both the underscored form ("two_sum") and the natural
            # wording ("two sum") in the prompt.
            if keyword in normalized or keyword.replace("_", " ") in normalized:
                return solution
        return DEFAULT_SOLUTION
