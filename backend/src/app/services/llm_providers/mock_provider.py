from __future__ import annotations

import re

from app.services.llm_providers.base import LLMProvider

# Named solutions keyed by prompt keyword, for every supported language.
# Each solution defines the functions the corresponding test file imports.

# --- Python ----------------------------------------------------------------
_PY_SOLUTIONS: dict[str, str] = {
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
    "reverse": ("def reverse_string(s):\n    return s[::-1]\n"),
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
    "sum": ("def sum_list(nums):\n    return sum(nums)\n"),
    "sort": ("def sort_list(items):\n    return sorted(items)\n"),
    "max": ("def find_max(nums):\n    if not nums:\n        return None\n    return max(nums)\n"),
}

# --- JavaScript -------------------------------------------------------------
_JS_SOLUTIONS: dict[str, str] = {
    "two_sum": (
        "function twoSum(nums, target) {\n"
        "  const seen = new Map();\n"
        "  for (let i = 0; i < nums.length; i++) {\n"
        "    const complement = target - nums[i];\n"
        "    if (seen.has(complement)) return [seen.get(complement), i];\n"
        "    seen.set(nums[i], i);\n"
        "  }\n"
        "  return [];\n"
        "}\n"
        "module.exports = { twoSum };\n"
    ),
    "fizzbuzz": (
        "function fizzBuzz(n) {\n"
        "  const result = [];\n"
        "  for (let i = 1; i <= n; i++) {\n"
        "    if (i % 15 === 0) result.push('FizzBuzz');\n"
        "    else if (i % 3 === 0) result.push('Fizz');\n"
        "    else if (i % 5 === 0) result.push('Buzz');\n"
        "    else result.push(String(i));\n"
        "  }\n"
        "  return result;\n"
        "}\n"
        "module.exports = { fizzBuzz };\n"
    ),
    "fibonacci": (
        "function fibonacci(n) {\n"
        "  if (n <= 0) return [];\n"
        "  if (n === 1) return [0];\n"
        "  const seq = [0, 1];\n"
        "  while (seq.length < n) seq.push(seq[seq.length - 1] + seq[seq.length - 2]);\n"
        "  return seq;\n"
        "}\n"
        "module.exports = { fibonacci };\n"
    ),
    "palindrome": (
        "function isPalindrome(s) {\n"
        "  const cleaned = s.toLowerCase().replace(/[^a-z0-9]/g, '');\n"
        "  return cleaned === cleaned.split('').reverse().join('');\n"
        "}\n"
        "module.exports = { isPalindrome };\n"
    ),
    "reverse": (
        "function reverseString(s) {\n"
        "  return s.split('').reverse().join('');\n"
        "}\n"
        "module.exports = { reverseString };\n"
    ),
    "factorial": (
        "function factorial(n) {\n"
        "  if (n < 0) throw new Error('n must be non-negative');\n"
        "  let result = 1;\n"
        "  for (let i = 2; i <= n; i++) result *= i;\n"
        "  return result;\n"
        "}\n"
        "module.exports = { factorial };\n"
    ),
    "is_prime": (
        "function isPrime(n) {\n"
        "  if (n < 2) return false;\n"
        "  for (let i = 2; i <= Math.sqrt(n); i++) if (n % i === 0) return false;\n"
        "  return true;\n"
        "}\n"
        "module.exports = { isPrime };\n"
    ),
    "sum": (
        "function sumList(nums) {\n"
        "  return nums.reduce((acc, n) => acc + n, 0);\n"
        "}\n"
        "module.exports = { sumList };\n"
    ),
    "sort": (
        "function sortList(items) {\n"
        "  return [...items].sort();\n"
        "}\n"
        "module.exports = { sortList };\n"
    ),
    "max": (
        "function findMax(nums) {\n"
        "  if (nums.length === 0) return null;\n"
        "  return Math.max(...nums);\n"
        "}\n"
        "module.exports = { findMax };\n"
    ),
}

# --- TypeScript -------------------------------------------------------------
_TS_SOLUTIONS: dict[str, str] = {
    "two_sum": (
        "export function twoSum(nums: number[], target: number): number[] {\n"
        "  const seen = new Map<number, number>();\n"
        "  for (let i = 0; i < nums.length; i++) {\n"
        "    const complement = target - nums[i];\n"
        "    if (seen.has(complement)) return [seen.get(complement)!, i];\n"
        "    seen.set(nums[i], i);\n"
        "  }\n"
        "  return [];\n"
        "}\n"
    ),
    "fizzbuzz": (
        "export function fizzBuzz(n: number): string[] {\n"
        "  const result: string[] = [];\n"
        "  for (let i = 1; i <= n; i++) {\n"
        "    if (i % 15 === 0) result.push('FizzBuzz');\n"
        "    else if (i % 3 === 0) result.push('Fizz');\n"
        "    else if (i % 5 === 0) result.push('Buzz');\n"
        "    else result.push(String(i));\n"
        "  }\n"
        "  return result;\n"
        "}\n"
    ),
    "fibonacci": (
        "export function fibonacci(n: number): number[] {\n"
        "  if (n <= 0) return [];\n"
        "  if (n === 1) return [0];\n"
        "  const seq = [0, 1];\n"
        "  while (seq.length < n) seq.push(seq[seq.length - 1] + seq[seq.length - 2]);\n"
        "  return seq;\n"
        "}\n"
    ),
    "palindrome": (
        "export function isPalindrome(s: string): boolean {\n"
        "  const cleaned = s.toLowerCase().replace(/[^a-z0-9]/g, '');\n"
        "  return cleaned === cleaned.split('').reverse().join('');\n"
        "}\n"
    ),
    "reverse": (
        "export function reverseString(s: string): string {\n"
        "  return s.split('').reverse().join('');\n"
        "}\n"
    ),
    "factorial": (
        "export function factorial(n: number): number {\n"
        "  if (n < 0) throw new Error('n must be non-negative');\n"
        "  let result = 1;\n"
        "  for (let i = 2; i <= n; i++) result *= i;\n"
        "  return result;\n"
        "}\n"
    ),
    "is_prime": (
        "export function isPrime(n: number): boolean {\n"
        "  if (n < 2) return false;\n"
        "  for (let i = 2; i <= Math.sqrt(n); i++) if (n % i === 0) return false;\n"
        "  return true;\n"
        "}\n"
    ),
    "sum": (
        "export function sumList(nums: number[]): number {\n"
        "  return nums.reduce((acc, n) => acc + n, 0);\n"
        "}\n"
    ),
    "sort": ("export function sortList<T>(items: T[]): T[] {\n  return [...items].sort();\n}\n"),
    "max": (
        "export function findMax(nums: number[]): number | null {\n"
        "  if (nums.length === 0) return null;\n"
        "  return Math.max(...nums);\n"
        "}\n"
    ),
}

# --- Java -------------------------------------------------------------------
_JAVA_SOLUTIONS: dict[str, str] = {
    "two_sum": (
        "import java.util.HashMap;\n"
        "import java.util.Map;\n"
        "\n"
        "public class Solution {\n"
        "    public static int[] twoSum(int[] nums, int target) {\n"
        "        Map<Integer, Integer> seen = new HashMap<>();\n"
        "        for (int i = 0; i < nums.length; i++) {\n"
        "            int complement = target - nums[i];\n"
        "            if (seen.containsKey(complement)) {\n"
        "                return new int[] { seen.get(complement), i };\n"
        "            }\n"
        "            seen.put(nums[i], i);\n"
        "        }\n"
        "        return new int[0];\n"
        "    }\n"
        "}\n"
    ),
    "fizzbuzz": (
        "import java.util.ArrayList;\n"
        "import java.util.List;\n"
        "\n"
        "public class Solution {\n"
        "    public static List<String> fizzBuzz(int n) {\n"
        "        List<String> result = new ArrayList<>();\n"
        "        for (int i = 1; i <= n; i++) {\n"
        '            if (i % 15 == 0) result.add("FizzBuzz");\n'
        '            else if (i % 3 == 0) result.add("Fizz");\n'
        '            else if (i % 5 == 0) result.add("Buzz");\n'
        "            else result.add(String.valueOf(i));\n"
        "        }\n"
        "        return result;\n"
        "    }\n"
        "}\n"
    ),
    "fibonacci": (
        "import java.util.ArrayList;\n"
        "import java.util.List;\n"
        "\n"
        "public class Solution {\n"
        "    public static List<Integer> fibonacci(int n) {\n"
        "        List<Integer> seq = new ArrayList<>();\n"
        "        if (n <= 0) return seq;\n"
        "        seq.add(0);\n"
        "        if (n == 1) return seq;\n"
        "        seq.add(1);\n"
        "        while (seq.size() < n) {\n"
        "            seq.add(seq.get(seq.size() - 1) + seq.get(seq.size() - 2));\n"
        "        }\n"
        "        return seq;\n"
        "    }\n"
        "}\n"
    ),
    "palindrome": (
        "public class Solution {\n"
        "    public static boolean isPalindrome(String s) {\n"
        '        String cleaned = s.toLowerCase().replaceAll("[^a-z0-9]", "");\n'
        "        return cleaned.equals(new StringBuilder(cleaned).reverse().toString());\n"
        "    }\n"
        "}\n"
    ),
    "reverse": (
        "public class Solution {\n"
        "    public static String reverseString(String s) {\n"
        "        return new StringBuilder(s).reverse().toString();\n"
        "    }\n"
        "}\n"
    ),
    "factorial": (
        "public class Solution {\n"
        "    public static long factorial(int n) {\n"
        '        if (n < 0) throw new IllegalArgumentException("n must be non-negative");\n'
        "        long result = 1;\n"
        "        for (int i = 2; i <= n; i++) result *= i;\n"
        "        return result;\n"
        "    }\n"
        "}\n"
    ),
    "is_prime": (
        "public class Solution {\n"
        "    public static boolean isPrime(int n) {\n"
        "        if (n < 2) return false;\n"
        "        for (int i = 2; i <= Math.sqrt(n); i++) {\n"
        "            if (n % i == 0) return false;\n"
        "        }\n"
        "        return true;\n"
        "    }\n"
        "}\n"
    ),
    "sum": (
        "public class Solution {\n"
        "    public static int sumList(int[] nums) {\n"
        "        int total = 0;\n"
        "        for (int num : nums) total += num;\n"
        "        return total;\n"
        "    }\n"
        "}\n"
    ),
    "sort": (
        "import java.util.Arrays;\n"
        "\n"
        "public class Solution {\n"
        "    public static int[] sortList(int[] items) {\n"
        "        int[] sorted = items.clone();\n"
        "        Arrays.sort(sorted);\n"
        "        return sorted;\n"
        "    }\n"
        "}\n"
    ),
    "max": (
        "public class Solution {\n"
        "    public static Integer findMax(int[] nums) {\n"
        "        if (nums.length == 0) return null;\n"
        "        int max = nums[0];\n"
        "        for (int num : nums) if (num > max) max = num;\n"
        "        return max;\n"
        "    }\n"
        "}\n"
    ),
}

# --- Go ---------------------------------------------------------------------
_GO_SOLUTIONS: dict[str, str] = {
    "two_sum": (
        "package main\n"
        "\n"
        "func TwoSum(nums []int, target int) []int {\n"
        "    seen := make(map[int]int)\n"
        "    for i, num := range nums {\n"
        "        complement := target - num\n"
        "        if idx, ok := seen[complement]; ok {\n"
        "            return []int{idx, i}\n"
        "        }\n"
        "        seen[num] = i\n"
        "    }\n"
        "    return []int{}\n"
        "}\n"
    ),
    "fizzbuzz": (
        "package main\n"
        "\n"
        'import "strconv"\n'
        "\n"
        "func FizzBuzz(n int) []string {\n"
        "    result := make([]string, 0, n)\n"
        "    for i := 1; i <= n; i++ {\n"
        "        switch {\n"
        "        case i%15 == 0:\n"
        '            result = append(result, "FizzBuzz")\n'
        "        case i%3 == 0:\n"
        '            result = append(result, "Fizz")\n'
        "        case i%5 == 0:\n"
        '            result = append(result, "Buzz")\n'
        "        default:\n"
        "            result = append(result, strconv.Itoa(i))\n"
        "        }\n"
        "    }\n"
        "    return result\n"
        "}\n"
    ),
    "fibonacci": (
        "package main\n"
        "\n"
        "func Fibonacci(n int) []int {\n"
        "    if n <= 0 {\n"
        "        return []int{}\n"
        "    }\n"
        "    if n == 1 {\n"
        "        return []int{0}\n"
        "    }\n"
        "    seq := []int{0, 1}\n"
        "    for len(seq) < n {\n"
        "        seq = append(seq, seq[len(seq)-1]+seq[len(seq)-2])\n"
        "    }\n"
        "    return seq\n"
        "}\n"
    ),
    "palindrome": (
        "package main\n"
        "\n"
        "import (\n"
        '    "regexp"\n'
        '    "strings"\n'
        ")\n"
        "\n"
        "var nonAlnum = regexp.MustCompile(`[^a-z0-9]`)\n"
        "\n"
        "func IsPalindrome(s string) bool {\n"
        '    cleaned := nonAlnum.ReplaceAllString(strings.ToLower(s), "")\n'
        "    runes := []rune(cleaned)\n"
        "    for i, j := 0, len(runes)-1; i < j; i, j = i+1, j-1 {\n"
        "        if runes[i] != runes[j] {\n"
        "            return false\n"
        "        }\n"
        "    }\n"
        "    return true\n"
        "}\n"
    ),
    "reverse": (
        "package main\n"
        "\n"
        "func ReverseString(s string) string {\n"
        "    runes := []rune(s)\n"
        "    for i, j := 0, len(runes)-1; i < j; i, j = i+1, j-1 {\n"
        "        runes[i], runes[j] = runes[j], runes[i]\n"
        "    }\n"
        "    return string(runes)\n"
        "}\n"
    ),
    "factorial": (
        "package main\n"
        "\n"
        'import "errors"\n'
        "\n"
        "func Factorial(n int) (int, error) {\n"
        "    if n < 0 {\n"
        '        return 0, errors.New("n must be non-negative")\n'
        "    }\n"
        "    result := 1\n"
        "    for i := 2; i <= n; i++ {\n"
        "        result *= i\n"
        "    }\n"
        "    return result, nil\n"
        "}\n"
    ),
    "is_prime": (
        "package main\n"
        "\n"
        "func IsPrime(n int) bool {\n"
        "    if n < 2 {\n"
        "        return false\n"
        "    }\n"
        "    for i := 2; i*i <= n; i++ {\n"
        "        if n%i == 0 {\n"
        "            return false\n"
        "        }\n"
        "    }\n"
        "    return true\n"
        "}\n"
    ),
    "sum": (
        "package main\n"
        "\n"
        "func SumList(nums []int) int {\n"
        "    total := 0\n"
        "    for _, num := range nums {\n"
        "        total += num\n"
        "    }\n"
        "    return total\n"
        "}\n"
    ),
    "sort": (
        "package main\n"
        "\n"
        'import "sort"\n'
        "\n"
        "func SortList(items []int) []int {\n"
        "    sorted := make([]int, len(items))\n"
        "    copy(sorted, items)\n"
        "    sort.Ints(sorted)\n"
        "    return sorted\n"
        "}\n"
    ),
    "max": (
        "package main\n"
        "\n"
        "func FindMax(nums []int) *int {\n"
        "    if len(nums) == 0 {\n"
        "        return nil\n"
        "    }\n"
        "    max := nums[0]\n"
        "    for _, num := range nums {\n"
        "        if num > max {\n"
        "            max = num\n"
        "        }\n"
        "    }\n"
        "    return &max\n"
        "}\n"
    ),
}

# keyword → per-language solution lookup.
SOLUTIONS_BY_LANGUAGE: dict[str, dict[str, str]] = {
    "python": _PY_SOLUTIONS,
    "javascript": _JS_SOLUTIONS,
    "typescript": _TS_SOLUTIONS,
    "java": _JAVA_SOLUTIONS,
    "go": _GO_SOLUTIONS,
}

DEFAULT_SOLUTIONS: dict[str, str] = {
    "python": (
        "def solution(*args):\n"
        '    """Default fallback for unrecognized prompts."""\n'
        "    return None\n"
    ),
    "javascript": (
        "function solution() {\n"
        "  // Default fallback for unrecognized prompts.\n"
        "  return null;\n"
        "}\n"
        "module.exports = { solution };\n"
    ),
    "typescript": (
        "export function solution(): null {\n"
        "  // Default fallback for unrecognized prompts.\n"
        "  return null;\n"
        "}\n"
    ),
    "java": (
        "public class Solution {\n"
        "    // Default fallback for unrecognized prompts.\n"
        "    public static Integer solution() {\n"
        "        return null;\n"
        "    }\n"
        "}\n"
    ),
    "go": (
        "package main\n"
        "\n"
        "// Default fallback for unrecognized prompts.\n"
        "func Solution() *int {\n"
        "    return nil\n"
        "}\n"
    ),
}

# Aliases so camelCase keywords in prompts ("twoSum", "isPrime") match the
# snake_case keys above.
_CAMEL_ALIASES: dict[str, str] = {
    "twosum": "two_sum",
    "sumlist": "sum",
    "sortlist": "sort",
    "findmax": "max",
    "reversestring": "reverse",
    "isprime": "is_prime",
    "fizzbuzz": "fizzbuzz",
    "fibonacci": "fibonacci",
    "palindrome": "palindrome",
}


def normalize_prompt(prompt: str) -> str:
    """Lowercase prompt with all non-alphanumeric characters removed."""
    return re.sub(r"[^a-z0-9]", "", prompt.lower())


class MockProvider(LLMProvider):
    """Deterministic demo provider — no API key or network required."""

    name = "demo"

    def generate_code(self, prompt: str, language: str = "python") -> str:
        self.validate_language(language)
        solutions = SOLUTIONS_BY_LANGUAGE[language]
        normalized = normalize_prompt(prompt)
        # Match natural wording ("two sum" → "twosum"), camelCase,
        # and the underscored form.
        for keyword in _CAMEL_ALIASES:
            if keyword in normalized:
                solution_key = _CAMEL_ALIASES[keyword]
                if solution_key in solutions:
                    return solutions[solution_key]
        plain = prompt.lower()
        for keyword, solution in solutions.items():
            if keyword in plain or keyword.replace("_", " ") in plain:
                return solution
        return DEFAULT_SOLUTIONS[language]
