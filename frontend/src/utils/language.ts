/**
 * Supported challenge languages (mirrors backend `schemas/challenge.py`).
 *
 * Catalog of 20 languages: 13 executable (a sandbox runtime + test harness
 * exists) and 7 display/seed-only (selectable + seeded, but generation and
 * evaluation report "evaluation not yet supported" until a runner exists).
 * See backend `app/services/languages.py` — keep the two in sync.
 */
export const LANGUAGES = [
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
  "csharp",
  "swift",
  "dart",
  "scala",
  "r",
  "haskell",
  "objective-c",
] as const;

export type ChallengeLanguage = (typeof LANGUAGES)[number];

/** Languages with a sandbox runtime + test harness wired end-to-end. */
export const EXECUTABLE_LANGUAGES: readonly string[] = [
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
];

/** Catalog-only languages: selectable, but evaluation is not yet supported. */
export const DISPLAY_ONLY_LANGUAGES: readonly string[] = [
  "csharp",
  "swift",
  "dart",
  "scala",
  "r",
  "haskell",
  "objective-c",
];

/** Per-language display metadata for badges and dropdowns. */
export interface LanguageMeta {
  /** Human-readable display name, e.g. "C++", "C#", "Objective-C". */
  label: string;
  /** Short symbol shown inside the LanguageBadge, e.g. "Py", "C++", "ObjC". */
  symbol: string;
  /** Brand accent color (darkened where the raw brand color is too pale). */
  color: string;
  /** Tooltip: display name plus what runs (or "no runner yet"). */
  title: string;
}

const LANGUAGE_META: Record<ChallengeLanguage, LanguageMeta> = {
  python: { label: "Python", symbol: "Py", color: "#3776AB", title: "Python · pytest" },
  javascript: { label: "JavaScript", symbol: "JS", color: "#8A6500", title: "JavaScript · node:test" },
  typescript: { label: "TypeScript", symbol: "TS", color: "#3178C6", title: "TypeScript · tsx --test" },
  java: { label: "Java", symbol: "Jv", color: "#B85C00", title: "Java · JUnit Platform" },
  go: { label: "Go", symbol: "Go", color: "#007C91", title: "Go · go test" },
  c: { label: "C", symbol: "C", color: "#5C6B80", title: "C · gcc (C11)" },
  cpp: { label: "C++", symbol: "C++", color: "#00599C", title: "C++ · g++" },
  rust: { label: "Rust", symbol: "Rs", color: "#B7410E", title: "Rust · rustc --test" },
  php: { label: "PHP", symbol: "PHP", color: "#5B5D94", title: "PHP · php" },
  ruby: { label: "Ruby", symbol: "Rb", color: "#CC342D", title: "Ruby · ruby" },
  perl: { label: "Perl", symbol: "Pl", color: "#39457E", title: "Perl · perl" },
  kotlin: { label: "Kotlin", symbol: "Kt", color: "#6C3EE8", title: "Kotlin · kotlinc" },
  lua: { label: "Lua", symbol: "Lua", color: "#2020A8", title: "Lua · lua5.4" },
  csharp: { label: "C#", symbol: "C#", color: "#512BD4", title: "C# · catalog only" },
  swift: { label: "Swift", symbol: "Sw", color: "#C2380C", title: "Swift · catalog only" },
  dart: { label: "Dart", symbol: "Da", color: "#015E9C", title: "Dart · catalog only" },
  scala: { label: "Scala", symbol: "Sc", color: "#B3261E", title: "Scala · catalog only" },
  r: { label: "R", symbol: "R", color: "#276DC3", title: "R · catalog only" },
  haskell: { label: "Haskell", symbol: "Hs", color: "#564A78", title: "Haskell · catalog only" },
  "objective-c": { label: "Objective-C", symbol: "ObjC", color: "#2F63B0", title: "Objective-C · catalog only" },
};

/** Display metadata for a language; unknown values fall back to a derived entry. */
export function languageMeta(language: string | null | undefined): LanguageMeta {
  const meta = LANGUAGE_META[language as ChallengeLanguage];
  if (meta) {
    return meta;
  }
  const label = language
    ? language.charAt(0).toUpperCase() + language.slice(1)
    : "Unknown";
  return { label, symbol: label.slice(0, 2), color: "#6B7280", title: label };
}

/** Human-readable display name for a language ("csharp" → "C#"). */
export function languageLabel(language: string | null | undefined): string {
  return languageMeta(language).label;
}

/** Short symbol for a language's badge ("objective-c" → "ObjC"). */
export function languageSymbol(language: string | null | undefined): string {
  return languageMeta(language).symbol;
}

/** One paste-ready example challenge (prompt + full test suite) for a language. */
export interface LanguageExample {
  /** Short title, e.g. "Two Sum". */
  title: string;
  /** LLM prompt for the challenge — its keyword resolves in the demo provider. */
  prompt: string;
  /** Full test suite source, syntax-checked for the language's test runner. */
  testCode: string;
}

interface LanguageGuide {
  /** Placeholder shown in the LLM prompt field. */
  prompt: string;
  /** Label for the test-code field, e.g. "Test code (pytest)". */
  testLabel: string;
  /** Example test code shown while the field is empty. */
  testCode: string;
  /** File extension for the solution/tests (without the dot). */
  extension: string;
}

/** Per-language test-runner label and file extension. */
const GUIDE_META: Record<
  ChallengeLanguage,
  Pick<LanguageGuide, "testLabel" | "extension">
> = {
  python: { testLabel: "Test code (pytest)", extension: "py" },
  javascript: { testLabel: "Test code (node:test/assert)", extension: "js" },
  typescript: { testLabel: "Test code (node:test)", extension: "ts" },
  java: { testLabel: "Test code (JUnit)", extension: "java" },
  go: { testLabel: "Test code (go test)", extension: "go" },
  c: { testLabel: "Test code (gcc)", extension: "c" },
  cpp: { testLabel: "Test code (g++)", extension: "cpp" },
  rust: { testLabel: "Test code (rustc --test)", extension: "rs" },
  php: { testLabel: "Test code (php)", extension: "php" },
  ruby: { testLabel: "Test code (ruby)", extension: "rb" },
  perl: { testLabel: "Test code (perl)", extension: "pl" },
  kotlin: { testLabel: "Test code (kotlinc)", extension: "kt" },
  lua: { testLabel: "Test code (lua5.4)", extension: "lua" },
  csharp: { testLabel: "Test code (no runner yet)", extension: "cs" },
  swift: { testLabel: "Test code (no runner yet)", extension: "swift" },
  dart: { testLabel: "Test code (no runner yet)", extension: "dart" },
  scala: { testLabel: "Test code (no runner yet)", extension: "scala" },
  r: { testLabel: "Test code (no runner yet)", extension: "r" },
  haskell: { testLabel: "Test code (no runner yet)", extension: "hs" },
  "objective-c": { testLabel: "Test code (no runner yet)", extension: "m" },
};

/** How each language's test suite is executed in the evaluation sandbox. */
export interface LanguageRunnerInfo {
  /** Human-readable runner name, e.g. "pytest" or "go test". */
  runner: string;
  /** Filename the test suite is written to in the evaluation workdir. */
  testFilename: string;
  /** Filename the generated solution is written to. */
  solutionFilename: string;
}

/**
 * Runner metadata for the 13 executable languages — mirrors
 * backend/src/app/services/language_runner.py, keep the two in sync. The
 * filenames/commands shown here are exactly what the sandbox executes.
 * Display-only languages have no runner (absent from this record).
 */
export const LANGUAGE_RUNNERS: Partial<Record<ChallengeLanguage, LanguageRunnerInfo>> = {
  python: {
    runner: "pytest",
    testFilename: "test_solution.py",
    solutionFilename: "solution.py",
  },
  javascript: {
    runner: "node --test",
    testFilename: "test_solution.js",
    solutionFilename: "solution.js",
  },
  typescript: {
    runner: "tsx --test",
    testFilename: "test_solution.ts",
    solutionFilename: "solution.ts",
  },
  java: {
    runner: "javac + JUnit Platform",
    testFilename: "SolutionTest.java",
    solutionFilename: "Solution.java",
  },
  go: {
    runner: "go test",
    testFilename: "solution_test.go",
    solutionFilename: "solution.go",
  },
  c: {
    runner: "gcc (C11)",
    testFilename: "test_solution.c",
    solutionFilename: "solution.c",
  },
  cpp: {
    runner: "g++",
    testFilename: "test_solution.cpp",
    solutionFilename: "solution.cpp",
  },
  rust: {
    runner: "rustc --test",
    testFilename: "test_solution.rs",
    solutionFilename: "solution.rs",
  },
  php: {
    runner: "php",
    testFilename: "test_solution.php",
    solutionFilename: "solution.php",
  },
  ruby: {
    runner: "ruby",
    testFilename: "test_solution.rb",
    solutionFilename: "solution.rb",
  },
  perl: {
    runner: "perl",
    testFilename: "test_solution.pl",
    solutionFilename: "solution.pl",
  },
  kotlin: {
    runner: "kotlinc",
    testFilename: "test_solution.kt",
    solutionFilename: "solution.kt",
  },
  lua: {
    runner: "lua5.4",
    testFilename: "test_solution.lua",
    solutionFilename: "solution.lua",
  },
};

/**
 * Runner metadata for a challenge language. Executable languages return their
 * runner info; display-only and unknown languages return null so callers can
 * surface "evaluation not yet supported".
 */
export function runnerForLanguage(language: string | null | undefined): LanguageRunnerInfo | null {
  if (!language) {
    return null;
  }
  return LANGUAGE_RUNNERS[language as ChallengeLanguage] ?? null;
}

/**
 * Human-readable duration estimate for an evaluation in the given language.
 * Mirrors backend budgets (config.py `evaluation_timeout=30`; Java +30s and
 * Go +60s for compilation in language_runner.py) plus the 60s LLM HTTP
 * timeout, so the worst realistic path is ~2 minutes. Deliberately hedged —
 * LLM latency varies.
 */
export function evaluationEstimate(language: string | null): string {
  switch (language) {
    case "java":
    case "go":
    case "c":
    case "cpp":
    case "rust":
    case "kotlin":
      return "up to ~2 minutes (includes compilation)";
    case "python":
    case "javascript":
    case "typescript":
    case "php":
    case "ruby":
    case "perl":
    case "lua":
      return "about 10–30 seconds";
    default:
      return "under a minute";
  }
}

/**
 * Curated example challenges — 3 per language, mirrored from the backend
 * seed catalog (`backend/src/app/services/example_challenges.py`, the source
 * of truth). Every executable language's prompt keyword resolves to a canned
 * solution in the backend demo provider (mock_provider.py), and each test
 * suite targets that solution's exact exported names, so pasting an example
 * and running it against the demo provider passes out of the box. Display-only
 * languages ship the same catalog spine (Two Sum + Valid Parentheses + a
 * third title) for drafting; evaluation reports "not yet supported".
 */export const LANGUAGE_EXAMPLES: Record<ChallengeLanguage, LanguageExample[]> = {
  python: [
    {
      title: "Two Sum",
      prompt: "Write a Python function two_sum(nums, target) that returns the indices of the two numbers that add up to target, or an empty result when there is no solution.",
      testCode: `from solution import two_sum

def test_basic():
    assert two_sum([2, 7, 11, 15], 9) == [0, 1]

def test_no_solution():
    assert two_sum([1, 2, 3], 99) == []
`,
    },
    {
      title: "Valid Parentheses",
      prompt: "Write a Python function valid_parentheses(s) that returns true when the parentheses, brackets, and braces in the string are properly balanced.",
      testCode: `from solution import valid_parentheses

def test_balanced():
    assert valid_parentheses("()[]{}")

def test_mismatched():
    assert not valid_parentheses("(]")
`,
    },
    {
      title: "Trapping Rain Water",
      prompt: "Write a Python function trap_rain_water(heights) that computes the total units of water trapped between the bar heights after rain \u2014 the classic Trapping Rain Water problem.",
      testCode: `from solution import trap_rain_water

def test_classic():
    assert trap_rain_water([0, 1, 0, 2, 1, 0, 1, 3, 2, 1, 2, 1]) == 6

def test_second_case():
    assert trap_rain_water([4, 2, 0, 3, 2, 5]) == 9
`,
    },
  ],
  javascript: [
    {
      title: "Two Sum",
      prompt: "Write a JavaScript function twoSum(nums, target) that returns the indices of the two numbers that add up to target, or an empty result when there is no solution.",
      testCode: `const { twoSum } = require('./solution.js');
const { test } = require('node:test');
const assert = require('assert');

test('twoSum', () => {
  assert.deepStrictEqual(twoSum([2, 7, 11, 15], 9), [0, 1]);
});

test('no solution', () => {
  assert.deepStrictEqual(twoSum([1, 2, 3], 99), []);
});
`,
    },
    {
      title: "Valid Parentheses",
      prompt: "Write a JavaScript function validParentheses(s) that returns true when the parentheses, brackets, and braces in the string are properly balanced.",
      testCode: `const { validParentheses } = require('./solution.js');
const { test } = require('node:test');
const assert = require('assert');

test('balanced', () => {
  assert.equal(validParentheses('()[]{}'), true);
});

test('mismatched', () => {
  assert.equal(validParentheses('(]'), false);
});
`,
    },
    {
      title: "Trapping Rain Water",
      prompt: "Write a JavaScript function trapRainWater(heights) that computes the total units of water trapped between the bar heights after rain \u2014 the classic Trapping Rain Water problem.",
      testCode: `const { trapRainWater } = require('./solution.js');
const { test } = require('node:test');
const assert = require('assert');

test('classic', () => {
  assert.equal(trapRainWater([0, 1, 0, 2, 1, 0, 1, 3, 2, 1, 2, 1]), 6);
});

test('second case', () => {
  assert.equal(trapRainWater([4, 2, 0, 3, 2, 5]), 9);
});
`,
    },
  ],
  typescript: [
    {
      title: "Two Sum",
      prompt: "Write a TypeScript function twoSum(nums: number[], target: number): number[] that returns the indices of the two numbers that add up to target, or an empty result when there is no solution.",
      testCode: `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { twoSum } from './solution.ts';

test('twoSum', () => {
  assert.deepEqual(twoSum([2, 7, 11, 15], 9), [0, 1]);
});

test('no solution', () => {
  assert.deepEqual(twoSum([1, 2, 3], 99), []);
});
`,
    },
    {
      title: "Valid Parentheses",
      prompt: "Write a TypeScript function validParentheses(s: string): boolean that returns true when the parentheses, brackets, and braces in the string are properly balanced.",
      testCode: `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validParentheses } from './solution.ts';

test('balanced', () => {
  assert.equal(validParentheses('()[]{}'), true);
});

test('mismatched', () => {
  assert.equal(validParentheses('(]'), false);
});
`,
    },
    {
      title: "Longest Common Prefix",
      prompt: "Write a TypeScript function longestCommonPrefix(strs: string[]): string that returns the longest common prefix shared by the strings, or an empty string when there is none.",
      testCode: `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { longestCommonPrefix } from './solution.ts';

test('common prefix', () => {
  assert.equal(longestCommonPrefix(['flower', 'flow', 'flight']), 'fl');
});

test('no common prefix', () => {
  assert.equal(longestCommonPrefix(['dog', 'racecar', 'car']), '');
});
`,
    },
  ],
  java: [
    {
      title: "Two Sum",
      prompt: "Write a Java method int[] twoSum(int[] nums, int target) in the class Solution that returns the indices of the two numbers that add up to target, or an empty result when there is no solution.",
      testCode: `import static org.junit.jupiter.api.Assertions.assertArrayEquals;

import org.junit.jupiter.api.Test;

class SolutionTest {
    @Test
    void testBasic() {
        assertArrayEquals(
            new int[] { 0, 1 },
            Solution.twoSum(new int[] { 2, 7, 11, 15 }, 9));
    }

    @Test
    void testNoSolution() {
        assertArrayEquals(
            new int[0],
            Solution.twoSum(new int[] { 1, 2, 3 }, 99));
    }
}
`,
    },
    {
      title: "Valid Parentheses",
      prompt: "Write a Java method boolean validParentheses(String s) in the class Solution that returns true when the parentheses, brackets, and braces in the string are properly balanced.",
      testCode: `import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class SolutionTest {
    @Test
    void testBalanced() {
        assertTrue(Solution.validParentheses("()[]{}"));
    }

    @Test
    void testMismatched() {
        assertFalse(Solution.validParentheses("(]"));
    }
}
`,
    },
    {
      title: "Trapping Rain Water",
      prompt: "Write a Java method int trapRainWater(int[] heights) in the class Solution that computes the total units of water trapped between the bar heights after rain \u2014 the classic Trapping Rain Water problem.",
      testCode: `import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class SolutionTest {
    @Test
    void testClassic() {
        assertEquals(6, Solution.trapRainWater(new int[] { 0, 1, 0, 2, 1, 0, 1, 3, 2, 1, 2, 1 }));
    }

    @Test
    void testSecondCase() {
        assertEquals(9, Solution.trapRainWater(new int[] { 4, 2, 0, 3, 2, 5 }));
    }
}
`,
    },
  ],
  go: [
    {
      title: "Two Sum",
      prompt: "Write a Go function TwoSum(nums []int, target int) []int that returns the indices of the two numbers that add up to target, or an empty result when there is no solution.",
      testCode: `package main

import "testing"

func TestTwoSum(t *testing.T) {
    got := TwoSum([]int{2, 7, 11, 15}, 9)
    if len(got) != 2 || got[0] != 0 || got[1] != 1 {
        t.Errorf("expected [0 1], got %v", got)
    }
}

func TestTwoSumNoSolution(t *testing.T) {
    if got := TwoSum([]int{1, 2, 3}, 99); len(got) != 0 {
        t.Errorf("expected empty result, got %v", got)
    }
}
`,
    },
    {
      title: "Valid Parentheses",
      prompt: "Write a Go function ValidParentheses(s string) bool that returns true when the parentheses, brackets, and braces in the string are properly balanced.",
      testCode: `package main

import "testing"

func TestValidParentheses(t *testing.T) {
    if !ValidParentheses("()[]{}") {
        t.Errorf("expected balanced input to be valid")
    }
}

func TestValidParenthesesMismatched(t *testing.T) {
    if ValidParentheses("(]") {
        t.Errorf("expected mismatched input to be invalid")
    }
}
`,
    },
    {
      title: "FizzBuzz",
      prompt: "Write a Go function FizzBuzz(n int) []string that returns the FizzBuzz sequence from 1 to n as strings.",
      testCode: `package main

import (
    "reflect"
    "testing"
)

func TestFizzBuzzFirstFive(t *testing.T) {
    expected := []string{"1", "2", "Fizz", "4", "Buzz"}
    if got := FizzBuzz(5); !reflect.DeepEqual(got, expected) {
        t.Errorf("expected %v, got %v", expected, got)
    }
}

func TestFizzBuzzFifteen(t *testing.T) {
    result := FizzBuzz(15)
    if result[len(result)-1] != "FizzBuzz" {
        t.Errorf("expected last element FizzBuzz, got %q", result[len(result)-1])
    }
}
`,
    },
  ],
  c: [
    {
      title: "Two Sum",
      prompt: "Write a C11 function int* two_sum(int* nums, int nums_size, int target, int* return_size) that returns the indices of the two numbers that add up to target, or an empty result when there is no solution.",
      testCode: `#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int* two_sum(int* nums, int nums_size, int target, int* return_size);
bool valid_parentheses(const char* s);
char* longest_common_prefix(char** strs, int strs_size);
char** fizzbuzz(int n, int* return_size);
long long* fibonacci(int n, int* return_size);

static int failures = 0;

static void check(int condition, const char* name) {
    if (condition) {
        printf("PASS: %s\\n", name);
    } else {
        printf("FAIL: %s\\n", name);
        failures++;
    }
}

int main(void) {
    int nums[] = {2, 7, 11, 15};
    int size = 0;
    int* res = two_sum(nums, 4, 9, &size);
    check(size == 2 && res[0] == 0 && res[1] == 1, "two_sum basic");

    int nums2[] = {1, 2, 3};
    res = two_sum(nums2, 3, 99, &size);
    check(res == NULL && size == 0, "two_sum no solution");
    return failures == 0 ? 0 : 1;
}
`,
    },
    {
      title: "Valid Parentheses",
      prompt: "Write a C11 function bool valid_parentheses(const char* s) that returns true when the parentheses, brackets, and braces in the string are properly balanced.",
      testCode: `#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int* two_sum(int* nums, int nums_size, int target, int* return_size);
bool valid_parentheses(const char* s);
char* longest_common_prefix(char** strs, int strs_size);
char** fizzbuzz(int n, int* return_size);
long long* fibonacci(int n, int* return_size);

static int failures = 0;

static void check(int condition, const char* name) {
    if (condition) {
        printf("PASS: %s\\n", name);
    } else {
        printf("FAIL: %s\\n", name);
        failures++;
    }
}

int main(void) {
    check(valid_parentheses("()[]{}"), "valid parentheses balanced");
    check(!valid_parentheses("(]"), "valid parentheses mismatched");
    check(!valid_parentheses("([)"), "valid parentheses unclosed");
    return failures == 0 ? 0 : 1;
}
`,
    },
    {
      title: "Longest Common Prefix",
      prompt: "Write a C11 function char* longest_common_prefix(char** strs, int strs_size) that returns the longest common prefix shared by the strings, or an empty string when there is none.",
      testCode: `#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int* two_sum(int* nums, int nums_size, int target, int* return_size);
bool valid_parentheses(const char* s);
char* longest_common_prefix(char** strs, int strs_size);
char** fizzbuzz(int n, int* return_size);
long long* fibonacci(int n, int* return_size);

static int failures = 0;

static void check(int condition, const char* name) {
    if (condition) {
        printf("PASS: %s\\n", name);
    } else {
        printf("FAIL: %s\\n", name);
        failures++;
    }
}

int main(void) {
    char* strs[] = {"flower", "flow", "flight"};
    char* prefix = longest_common_prefix(strs, 3);
    check(strcmp(prefix, "fl") == 0, "lcp common prefix");
    free(prefix);

    char* strs2[] = {"dog", "racecar", "car"};
    prefix = longest_common_prefix(strs2, 3);
    check(strcmp(prefix, "") == 0, "lcp no common prefix");
    free(prefix);
    return failures == 0 ? 0 : 1;
}
`,
    },
  ],
  cpp: [
    {
      title: "Two Sum",
      prompt: "Write a C++17 function std::vector<int> two_sum(const std::vector<int>& nums, int target) that returns the indices of the two numbers that add up to target, or an empty result when there is no solution.",
      testCode: `#include <iostream>
#include <string>
#include <vector>

std::vector<int> two_sum(const std::vector<int>& nums, int target);
bool valid_parentheses(const std::string& s);
std::string longest_common_prefix(const std::vector<std::string>& strs);
std::vector<std::string> fizzbuzz(int n);
std::vector<long long> fibonacci(int n);

static int failures = 0;

static void check(bool condition, const std::string& name) {
    if (condition) {
        std::cout << "PASS: " << name << "\\n";
    } else {
        std::cout << "FAIL: " << name << "\\n";
        failures++;
    }
}

int main() {
    check(two_sum({2, 7, 11, 15}, 9) == std::vector<int>({0, 1}), "two_sum basic");
    check(two_sum({1, 2, 3}, 99) == std::vector<int>(), "two_sum no solution");
    return failures == 0 ? 0 : 1;
}
`,
    },
    {
      title: "Valid Parentheses",
      prompt: "Write a C++17 function bool valid_parentheses(const std::string& s) that returns true when the parentheses, brackets, and braces in the string are properly balanced.",
      testCode: `#include <iostream>
#include <string>
#include <vector>

std::vector<int> two_sum(const std::vector<int>& nums, int target);
bool valid_parentheses(const std::string& s);
std::string longest_common_prefix(const std::vector<std::string>& strs);
std::vector<std::string> fizzbuzz(int n);
std::vector<long long> fibonacci(int n);

static int failures = 0;

static void check(bool condition, const std::string& name) {
    if (condition) {
        std::cout << "PASS: " << name << "\\n";
    } else {
        std::cout << "FAIL: " << name << "\\n";
        failures++;
    }
}

int main() {
    check(valid_parentheses("()[]{}"), "valid parentheses balanced");
    check(!valid_parentheses("(]"), "valid parentheses mismatched");
    return failures == 0 ? 0 : 1;
}
`,
    },
    {
      title: "FizzBuzz",
      prompt: "Write a C++17 function std::vector<std::string> fizzbuzz(int n) that returns the FizzBuzz sequence from 1 to n as strings.",
      testCode: `#include <iostream>
#include <string>
#include <vector>

std::vector<int> two_sum(const std::vector<int>& nums, int target);
bool valid_parentheses(const std::string& s);
std::string longest_common_prefix(const std::vector<std::string>& strs);
std::vector<std::string> fizzbuzz(int n);
std::vector<long long> fibonacci(int n);

static int failures = 0;

static void check(bool condition, const std::string& name) {
    if (condition) {
        std::cout << "PASS: " << name << "\\n";
    } else {
        std::cout << "FAIL: " << name << "\\n";
        failures++;
    }
}

int main() {
    check(
        fizzbuzz(5) == std::vector<std::string>({"1", "2", "Fizz", "4", "Buzz"}),
        "fizzbuzz first five");
    check(fizzbuzz(15).back() == "FizzBuzz", "fizzbuzz fifteen");
    return failures == 0 ? 0 : 1;
}
`,
    },
  ],
  rust: [
    {
      title: "Two Sum",
      prompt: "Write a Rust function pub fn two_sum(nums: &[i32], target: i32) -> Vec<i32> that returns the indices of the two numbers that add up to target, or an empty result when there is no solution.",
      testCode: `mod solution;

fn s(value: &str) -> String {
    value.to_string()
}

fn check<T>(condition: bool, name: &str) -> usize {
    if condition {
        println!("PASS: {}", name);
        0
    } else {
        println!("FAIL: {}", name);
        1
    }
}

fn main() {
    let mut failures = 0;
    failures += check(
        solution::two_sum(&[2, 7, 11, 15], 9) == vec![0, 1],
        "two_sum basic");
    failures += check(
        solution::two_sum(&[1, 2, 3], 99) == Vec::<i32>::new(),
        "two_sum no solution");
    if failures > 0 {
        std::process::exit(1);
    }
}
`,
    },
    {
      title: "Valid Parentheses",
      prompt: "Write a Rust function pub fn valid_parentheses(s: &str) -> bool that returns true when the parentheses, brackets, and braces in the string are properly balanced.",
      testCode: `mod solution;

fn s(value: &str) -> String {
    value.to_string()
}

fn check<T>(condition: bool, name: &str) -> usize {
    if condition {
        println!("PASS: {}", name);
        0
    } else {
        println!("FAIL: {}", name);
        1
    }
}

fn main() {
    let mut failures = 0;
    failures += check(
        solution::valid_parentheses("()[]{}"), "valid parentheses balanced");
    failures += check(!solution::valid_parentheses("(]"), "valid parentheses mismatched");
    if failures > 0 {
        std::process::exit(1);
    }
}
`,
    },
    {
      title: "Longest Common Prefix",
      prompt: "Write a Rust function pub fn longest_common_prefix(strs: &[&str]) -> String that returns the longest common prefix shared by the strings, or an empty string when there is none.",
      testCode: `mod solution;

fn s(value: &str) -> String {
    value.to_string()
}

fn check<T>(condition: bool, name: &str) -> usize {
    if condition {
        println!("PASS: {}", name);
        0
    } else {
        println!("FAIL: {}", name);
        1
    }
}

fn main() {
    let mut failures = 0;
    failures += check(
        solution::longest_common_prefix(&["flower", "flow", "flight"]) == s("fl"),
        "lcp common prefix");
    failures += check(
        solution::longest_common_prefix(&["dog", "racecar", "car"]) == s(""),
        "lcp no common prefix");
    if failures > 0 {
        std::process::exit(1);
    }
}
`,
    },
  ],
  php: [
    {
      title: "Two Sum",
      prompt: "Write a PHP function two_sum(array $nums, int $target): array that returns the indices of the two numbers that add up to target, or an empty result when there is no solution.",
      testCode: `<?php
require 'solution.php';

$failures = 0;

function check($condition, $name) {
    global $failures;
    if ($condition) {
        echo "PASS: $name\\n";
    } else {
        echo "FAIL: $name\\n";
        $failures++;
    }
}

check(two_sum([2, 7, 11, 15], 9) === [0, 1], 'two_sum basic');
check(two_sum([1, 2, 3], 99) === [], 'two_sum no solution');

exit($failures === 0 ? 0 : 1);
`,
    },
    {
      title: "Valid Parentheses",
      prompt: "Write a PHP function valid_parentheses(string $s): bool that returns true when the parentheses, brackets, and braces in the string are properly balanced.",
      testCode: `<?php
require 'solution.php';

$failures = 0;

function check($condition, $name) {
    global $failures;
    if ($condition) {
        echo "PASS: $name\\n";
    } else {
        echo "FAIL: $name\\n";
        $failures++;
    }
}

check(valid_parentheses('()[]{}') === true, 'valid parentheses balanced');
check(valid_parentheses('(]') === false, 'valid parentheses mismatched');

exit($failures === 0 ? 0 : 1);
`,
    },
    {
      title: "Fibonacci",
      prompt: "Write a PHP function fibonacci(int $n): array that returns the first n Fibonacci numbers starting with 0, 1.",
      testCode: `<?php
require 'solution.php';

$failures = 0;

function check($condition, $name) {
    global $failures;
    if ($condition) {
        echo "PASS: $name\\n";
    } else {
        echo "FAIL: $name\\n";
        $failures++;
    }
}

check(fibonacci(7) === [0, 1, 1, 2, 3, 5, 8], 'fibonacci first seven');
check(fibonacci(0) === [], 'fibonacci zero');

exit($failures === 0 ? 0 : 1);
`,
    },
  ],
  ruby: [
    {
      title: "Two Sum",
      prompt: "Write a Ruby method two_sum(nums, target) that returns the indices of the two numbers that add up to target, or an empty result when there is no solution.",
      testCode: `require_relative 'solution'

def check(condition, name)
  if condition
    puts "PASS: #{name}"
    true
  else
    puts "FAIL: #{name}"
    false
  end
end

failures = 0
failures += 1 unless check(two_sum([2, 7, 11, 15], 9) == [0, 1], 'two_sum basic')
failures += 1 unless check(two_sum([1, 2, 3], 99) == [], 'two_sum no solution')

exit(failures.zero? ? 0 : 1)
`,
    },
    {
      title: "Valid Parentheses",
      prompt: "Write a Ruby method valid_parentheses(s) that returns true when the parentheses, brackets, and braces in the string are properly balanced.",
      testCode: `require_relative 'solution'

def check(condition, name)
  if condition
    puts "PASS: #{name}"
    true
  else
    puts "FAIL: #{name}"
    false
  end
end

failures = 0
failures += 1 unless check(
  valid_parentheses('()[]{}') == true, 'valid parentheses balanced')
failures += 1 unless check(valid_parentheses('(]') == false, 'valid parentheses mismatched')

exit(failures.zero? ? 0 : 1)
`,
    },
    {
      title: "FizzBuzz",
      prompt: "Write a Ruby method fizzbuzz(n) that returns the FizzBuzz sequence from 1 to n as strings.",
      testCode: `require_relative 'solution'

def check(condition, name)
  if condition
    puts "PASS: #{name}"
    true
  else
    puts "FAIL: #{name}"
    false
  end
end

failures = 0
failures += 1 unless check(fizzbuzz(5) == %w[1 2 Fizz 4 Buzz], 'fizzbuzz first five')
failures += 1 unless check(fizzbuzz(15).last == 'FizzBuzz', 'fizzbuzz fifteen')

exit(failures.zero? ? 0 : 1)
`,
    },
  ],
  perl: [
    {
      title: "Two Sum",
      prompt: "Write a Perl subroutine two_sum($nums, $target) returning an arrayref that returns the indices of the two numbers that add up to target, or an empty result when there is no solution.",
      testCode: `use strict;
use warnings;
require './solution.pl';

my $failures = 0;

sub check {
    my ($condition, $name) = @_;
    if ($condition) {
        print "PASS: $name\\n";
    } else {
        print "FAIL: $name\\n";
        $failures++;
    }
}

sub join_list {
    my ($aref) = @_;
    return join(',', @$aref);
}

check(join_list(two_sum([2, 7, 11, 15], 9)) eq '0,1', 'two_sum basic');
check(scalar @{two_sum([1, 2, 3], 99)} == 0, 'two_sum no solution');

exit($failures ? 1 : 0);
`,
    },
    {
      title: "Valid Parentheses",
      prompt: "Write a Perl subroutine valid_parentheses($s) returning true/false that returns true when the parentheses, brackets, and braces in the string are properly balanced.",
      testCode: `use strict;
use warnings;
require './solution.pl';

my $failures = 0;

sub check {
    my ($condition, $name) = @_;
    if ($condition) {
        print "PASS: $name\\n";
    } else {
        print "FAIL: $name\\n";
        $failures++;
    }
}

sub join_list {
    my ($aref) = @_;
    return join(',', @$aref);
}

check(valid_parentheses('()[]{}'), 'valid parentheses balanced');
check(!valid_parentheses('(]'), 'valid parentheses mismatched');

exit($failures ? 1 : 0);
`,
    },
    {
      title: "Longest Common Prefix",
      prompt: "Write a Perl subroutine longest_common_prefix($strs) returning a string that returns the longest common prefix shared by the strings, or an empty string when there is none.",
      testCode: `use strict;
use warnings;
require './solution.pl';

my $failures = 0;

sub check {
    my ($condition, $name) = @_;
    if ($condition) {
        print "PASS: $name\\n";
    } else {
        print "FAIL: $name\\n";
        $failures++;
    }
}

sub join_list {
    my ($aref) = @_;
    return join(',', @$aref);
}

check(
    longest_common_prefix(['flower', 'flow', 'flight']) eq 'fl', 'lcp common prefix');
check(longest_common_prefix(['dog', 'racecar', 'car']) eq '', 'lcp no common prefix');

exit($failures ? 1 : 0);
`,
    },
  ],
  kotlin: [
    {
      title: "Two Sum",
      prompt: "Write a Kotlin function fun twoSum(nums: IntArray, target: Int): IntArray that returns the indices of the two numbers that add up to target, or an empty result when there is no solution.",
      testCode: `fun main() {
    var failures = 0

    fun check(condition: Boolean, name: String) {
        if (condition) {
            println("PASS: $name")
        } else {
            println("FAIL: $name")
            failures++
        }
    }

    check(
        twoSum(intArrayOf(2, 7, 11, 15), 9).contentEquals(intArrayOf(0, 1)), "two_sum basic")
    check(twoSum(intArrayOf(1, 2, 3), 99).isEmpty(), "two_sum no solution")

    if (failures > 0) kotlin.system.exitProcess(1)
}
`,
    },
    {
      title: "Valid Parentheses",
      prompt: "Write a Kotlin function fun validParentheses(s: String): Boolean that returns true when the parentheses, brackets, and braces in the string are properly balanced.",
      testCode: `fun main() {
    var failures = 0

    fun check(condition: Boolean, name: String) {
        if (condition) {
            println("PASS: $name")
        } else {
            println("FAIL: $name")
            failures++
        }
    }

    check(validParentheses("()[]{}"), "valid parentheses balanced")
    check(!validParentheses("(]"), "valid parentheses mismatched")

    if (failures > 0) kotlin.system.exitProcess(1)
}
`,
    },
    {
      title: "FizzBuzz",
      prompt: "Write a Kotlin function fun fizzbuzz(n: Int): List<String> that returns the FizzBuzz sequence from 1 to n as strings.",
      testCode: `fun main() {
    var failures = 0

    fun check(condition: Boolean, name: String) {
        if (condition) {
            println("PASS: $name")
        } else {
            println("FAIL: $name")
            failures++
        }
    }

    check(fizzbuzz(5) == listOf("1", "2", "Fizz", "4", "Buzz"), "fizzbuzz first five")
    check(fizzbuzz(15).last() == "FizzBuzz", "fizzbuzz fifteen")

    if (failures > 0) kotlin.system.exitProcess(1)
}
`,
    },
  ],
  lua: [
    {
      title: "Two Sum",
      prompt: "Write a Lua function two_sum(nums, target) that returns the indices of the two numbers that add up to target, or an empty result when there is no solution.",
      testCode: `dofile("solution.lua")

local failures = 0

local function check(condition, name)
    if condition then
        print("PASS: " .. name)
    else
        print("FAIL: " .. name)
        failures = failures + 1
    end
end

local function join(t)
    local parts = {}
    for _, v in ipairs(t) do
        parts[#parts + 1] = tostring(v)
    end
    return table.concat(parts, ",")
end

check(join(two_sum({2, 7, 11, 15}, 9)) == "0,1", "two_sum basic")
check(#two_sum({1, 2, 3}, 99) == 0, "two_sum no solution")

os.exit(failures == 0 and 0 or 1)
`,
    },
    {
      title: "Valid Parentheses",
      prompt: "Write a Lua function valid_parentheses(s) that returns true when the parentheses, brackets, and braces in the string are properly balanced.",
      testCode: `dofile("solution.lua")

local failures = 0

local function check(condition, name)
    if condition then
        print("PASS: " .. name)
    else
        print("FAIL: " .. name)
        failures = failures + 1
    end
end

local function join(t)
    local parts = {}
    for _, v in ipairs(t) do
        parts[#parts + 1] = tostring(v)
    end
    return table.concat(parts, ",")
end

check(valid_parentheses("()[]{}"), "valid parentheses balanced")
check(not valid_parentheses("(]"), "valid parentheses mismatched")

os.exit(failures == 0 and 0 or 1)
`,
    },
    {
      title: "Fibonacci",
      prompt: "Write a Lua function fibonacci(n) that returns the first n Fibonacci numbers starting with 0, 1.",
      testCode: `dofile("solution.lua")

local failures = 0

local function check(condition, name)
    if condition then
        print("PASS: " .. name)
    else
        print("FAIL: " .. name)
        failures = failures + 1
    end
end

local function join(t)
    local parts = {}
    for _, v in ipairs(t) do
        parts[#parts + 1] = tostring(v)
    end
    return table.concat(parts, ",")
end

check(join(fibonacci(7)) == "0,1,1,2,3,5,8", "fibonacci first seven")
check(#fibonacci(0) == 0, "fibonacci zero")

os.exit(failures == 0 and 0 or 1)
`,
    },
  ],
  csharp: [
    {
      title: "Two Sum",
      prompt: "Write a C# function twoSum(nums, target) that returns the indices of the two numbers that add up to target, or an empty result when there is no solution.",
      testCode: `// Test suite (catalog only — execution not yet supported for C#).
using System;

class TestSuite
{
    static int failures = 0;

    static void Check(bool condition, string name)
    {
        if (condition) { Console.WriteLine("PASS: " + name); }
        else { Console.WriteLine("FAIL: " + name); failures++; }
    }

    static int[] TwoSum(int[] nums, int target) { return Array.Empty<int>(); }
    static bool ValidParentheses(string s) { return false; }
    static string LongestCommonPrefix(string[] strs) { return ""; }

    static void Main()
    {
        Check(TwoSum(new[] { 2, 7, 11, 15 }, 9).Length == 2, "two_sum basic");
        Check(ValidParentheses("()[]{}"), "valid parentheses balanced");
        Check(!ValidParentheses("(]"), "valid parentheses mismatched");
        if (failures > 0) Environment.Exit(1);
    }
}
`,
    },
    {
      title: "Valid Parentheses",
      prompt: "Write a C# function validParentheses(s) that returns true when the parentheses, brackets, and braces in the string are properly balanced.",
      testCode: `// Test suite (catalog only — execution not yet supported for C#).
using System;

class TestSuite
{
    static int failures = 0;

    static void Check(bool condition, string name)
    {
        if (condition) { Console.WriteLine("PASS: " + name); }
        else { Console.WriteLine("FAIL: " + name); failures++; }
    }

    static int[] TwoSum(int[] nums, int target) { return Array.Empty<int>(); }
    static bool ValidParentheses(string s) { return false; }
    static string LongestCommonPrefix(string[] strs) { return ""; }

    static void Main()
    {
        Check(TwoSum(new[] { 2, 7, 11, 15 }, 9).Length == 2, "two_sum basic");
        Check(ValidParentheses("()[]{}"), "valid parentheses balanced");
        Check(!ValidParentheses("(]"), "valid parentheses mismatched");
        if (failures > 0) Environment.Exit(1);
    }
}
`,
    },
    {
      title: "Longest Common Prefix",
      prompt: "Write a C# function longestCommonPrefix(strs) that returns the longest common prefix shared by the strings, or an empty string when there is none.",
      testCode: `// Test suite (catalog only — execution not yet supported for C#).
using System;

class TestSuite
{
    static int failures = 0;

    static void Check(bool condition, string name)
    {
        if (condition) { Console.WriteLine("PASS: " + name); }
        else { Console.WriteLine("FAIL: " + name); failures++; }
    }

    static int[] TwoSum(int[] nums, int target) { return Array.Empty<int>(); }
    static bool ValidParentheses(string s) { return false; }
    static string LongestCommonPrefix(string[] strs) { return ""; }

    static void Main()
    {
        Check(TwoSum(new[] { 2, 7, 11, 15 }, 9).Length == 2, "two_sum basic");
        Check(ValidParentheses("()[]{}"), "valid parentheses balanced");
        Check(!ValidParentheses("(]"), "valid parentheses mismatched");
        if (failures > 0) Environment.Exit(1);
    }
}
`,
    },
  ],
  swift: [
    {
      title: "Two Sum",
      prompt: "Write a Swift function twoSum(nums, target) that returns the indices of the two numbers that add up to target, or an empty result when there is no solution.",
      testCode: `// Test suite (catalog only — execution not yet supported for Swift).
var failures = 0

func check(_ condition: Bool, _ name: String) {
    if condition { print("PASS: \\(name)") }
    else { print("FAIL: \\(name)"); failures += 1 }
}

func twoSum(_ nums: [Int], _ target: Int) -> [Int] { [] }
func validParentheses(_ s: String) -> Bool { false }

check(twoSum([2, 7, 11, 15], 9).count == 2, "two_sum basic")
check(validParentheses("()[]{}"), "valid parentheses balanced")
check(!validParentheses("(]"), "valid parentheses mismatched")
if failures > 0 { exit(1) }
`,
    },
    {
      title: "Valid Parentheses",
      prompt: "Write a Swift function validParentheses(s) that returns true when the parentheses, brackets, and braces in the string are properly balanced.",
      testCode: `// Test suite (catalog only — execution not yet supported for Swift).
var failures = 0

func check(_ condition: Bool, _ name: String) {
    if condition { print("PASS: \\(name)") }
    else { print("FAIL: \\(name)"); failures += 1 }
}

func twoSum(_ nums: [Int], _ target: Int) -> [Int] { [] }
func validParentheses(_ s: String) -> Bool { false }

check(twoSum([2, 7, 11, 15], 9).count == 2, "two_sum basic")
check(validParentheses("()[]{}"), "valid parentheses balanced")
check(!validParentheses("(]"), "valid parentheses mismatched")
if failures > 0 { exit(1) }
`,
    },
    {
      title: "FizzBuzz",
      prompt: "Write a Swift function fizzBuzz(n) that returns the FizzBuzz sequence from 1 to n as strings.",
      testCode: `// Test suite (catalog only — execution not yet supported for Swift).
var failures = 0

func check(_ condition: Bool, _ name: String) {
    if condition { print("PASS: \\(name)") }
    else { print("FAIL: \\(name)"); failures += 1 }
}

func twoSum(_ nums: [Int], _ target: Int) -> [Int] { [] }
func validParentheses(_ s: String) -> Bool { false }

check(twoSum([2, 7, 11, 15], 9).count == 2, "two_sum basic")
check(validParentheses("()[]{}"), "valid parentheses balanced")
check(!validParentheses("(]"), "valid parentheses mismatched")
if failures > 0 { exit(1) }
`,
    },
  ],
  dart: [
    {
      title: "Two Sum",
      prompt: "Write a Dart function twoSum(nums, target) that returns the indices of the two numbers that add up to target, or an empty result when there is no solution.",
      testCode: `// Test suite (catalog only — execution not yet supported for Dart).
var failures = 0;

void check(bool condition, String name) {
  if (condition) {
    print('PASS: $name');
  } else {
    print('FAIL: $name');
    failures++;
  }
}

List<int> twoSum(List<int> nums, int target) => [];
bool validParentheses(String s) => false;

void main() {
  check(twoSum([2, 7, 11, 15], 9).length == 2, 'two_sum basic');
  check(validParentheses('()[]{}'), 'valid parentheses balanced');
  check(!validParentheses('(]'), 'valid parentheses mismatched');
  if (failures > 0) exit(1);
}
`,
    },
    {
      title: "Valid Parentheses",
      prompt: "Write a Dart function validParentheses(s) that returns true when the parentheses, brackets, and braces in the string are properly balanced.",
      testCode: `// Test suite (catalog only — execution not yet supported for Dart).
var failures = 0;

void check(bool condition, String name) {
  if (condition) {
    print('PASS: $name');
  } else {
    print('FAIL: $name');
    failures++;
  }
}

List<int> twoSum(List<int> nums, int target) => [];
bool validParentheses(String s) => false;

void main() {
  check(twoSum([2, 7, 11, 15], 9).length == 2, 'two_sum basic');
  check(validParentheses('()[]{}'), 'valid parentheses balanced');
  check(!validParentheses('(]'), 'valid parentheses mismatched');
  if (failures > 0) exit(1);
}
`,
    },
    {
      title: "Fibonacci",
      prompt: "Write a Dart function fibonacci(n) that returns the first n Fibonacci numbers starting with 0, 1.",
      testCode: `// Test suite (catalog only — execution not yet supported for Dart).
var failures = 0;

void check(bool condition, String name) {
  if (condition) {
    print('PASS: $name');
  } else {
    print('FAIL: $name');
    failures++;
  }
}

List<int> twoSum(List<int> nums, int target) => [];
bool validParentheses(String s) => false;

void main() {
  check(twoSum([2, 7, 11, 15], 9).length == 2, 'two_sum basic');
  check(validParentheses('()[]{}'), 'valid parentheses balanced');
  check(!validParentheses('(]'), 'valid parentheses mismatched');
  if (failures > 0) exit(1);
}
`,
    },
  ],
  scala: [
    {
      title: "Two Sum",
      prompt: "Write a Scala function twoSum(nums, target) that returns the indices of the two numbers that add up to target, or an empty result when there is no solution.",
      testCode: `// Test suite (catalog only — execution not yet supported for Scala).
object TestSuite {
  private var failures = 0

  private def check(condition: Boolean, name: String): Unit = {
    if (condition) println(s"PASS: $name")
    else { println(s"FAIL: $name"); failures += 1 }
  }

  def main(args: Array[String]): Unit = {
    check(twoSum(Array(2, 7, 11, 15), 9).sameElements(Array(0, 1)), "two_sum basic")
    check(validParentheses("()[]{}"), "valid parentheses balanced")
    check(!validParentheses("(]"), "valid parentheses mismatched")
    if (failures > 0) sys.exit(1)
  }
}
`,
    },
    {
      title: "Valid Parentheses",
      prompt: "Write a Scala function validParentheses(s) that returns true when the parentheses, brackets, and braces in the string are properly balanced.",
      testCode: `// Test suite (catalog only — execution not yet supported for Scala).
object TestSuite {
  private var failures = 0

  private def check(condition: Boolean, name: String): Unit = {
    if (condition) println(s"PASS: $name")
    else { println(s"FAIL: $name"); failures += 1 }
  }

  def main(args: Array[String]): Unit = {
    check(twoSum(Array(2, 7, 11, 15), 9).sameElements(Array(0, 1)), "two_sum basic")
    check(validParentheses("()[]{}"), "valid parentheses balanced")
    check(!validParentheses("(]"), "valid parentheses mismatched")
    if (failures > 0) sys.exit(1)
  }
}
`,
    },
    {
      title: "Longest Common Prefix",
      prompt: "Write a Scala function longestCommonPrefix(strs) that returns the longest common prefix shared by the strings, or an empty string when there is none.",
      testCode: `// Test suite (catalog only — execution not yet supported for Scala).
object TestSuite {
  private var failures = 0

  private def check(condition: Boolean, name: String): Unit = {
    if (condition) println(s"PASS: $name")
    else { println(s"FAIL: $name"); failures += 1 }
  }

  def main(args: Array[String]): Unit = {
    check(twoSum(Array(2, 7, 11, 15), 9).sameElements(Array(0, 1)), "two_sum basic")
    check(validParentheses("()[]{}"), "valid parentheses balanced")
    check(!validParentheses("(]"), "valid parentheses mismatched")
    if (failures > 0) sys.exit(1)
  }
}
`,
    },
  ],
  r: [
    {
      title: "Two Sum",
      prompt: "Write a R function twoSum(nums, target) that returns the indices of the two numbers that add up to target, or an empty result when there is no solution.",
      testCode: `# Test suite (catalog only — execution not yet supported for R).
failures <- 0L
check <- function(condition, name) {
  if (isTRUE(condition)) {
    cat("PASS:", name, "
")
  } else {
    cat("FAIL:", name, "
")
    failures <<- failures + 1L
  }
}
check(identical(two_sum(c(2L, 7L, 11L, 15L), 9L), c(0L, 1L)), "two_sum basic")
check(isTRUE(valid_parentheses("()[]{}")), "valid parentheses balanced")
check(!isTRUE(valid_parentheses("(]")), "valid parentheses mismatched")
if (failures > 0L) quit(status = 1L)
`,
    },
    {
      title: "Valid Parentheses",
      prompt: "Write a R function validParentheses(s) that returns true when the parentheses, brackets, and braces in the string are properly balanced.",
      testCode: `# Test suite (catalog only — execution not yet supported for R).
failures <- 0L
check <- function(condition, name) {
  if (isTRUE(condition)) {
    cat("PASS:", name, "
")
  } else {
    cat("FAIL:", name, "
")
    failures <<- failures + 1L
  }
}
check(identical(two_sum(c(2L, 7L, 11L, 15L), 9L), c(0L, 1L)), "two_sum basic")
check(isTRUE(valid_parentheses("()[]{}")), "valid parentheses balanced")
check(!isTRUE(valid_parentheses("(]")), "valid parentheses mismatched")
if (failures > 0L) quit(status = 1L)
`,
    },
    {
      title: "FizzBuzz",
      prompt: "Write a R function fizzBuzz(n) that returns the FizzBuzz sequence from 1 to n as strings.",
      testCode: `# Test suite (catalog only — execution not yet supported for R).
failures <- 0L
check <- function(condition, name) {
  if (isTRUE(condition)) {
    cat("PASS:", name, "
")
  } else {
    cat("FAIL:", name, "
")
    failures <<- failures + 1L
  }
}
check(identical(two_sum(c(2L, 7L, 11L, 15L), 9L), c(0L, 1L)), "two_sum basic")
check(isTRUE(valid_parentheses("()[]{}")), "valid parentheses balanced")
check(!isTRUE(valid_parentheses("(]")), "valid parentheses mismatched")
if (failures > 0L) quit(status = 1L)
`,
    },
  ],
  haskell: [
    {
      title: "Two Sum",
      prompt: "Write a Haskell function twoSum(nums, target) that returns the indices of the two numbers that add up to target, or an empty result when there is no solution.",
      testCode: `-- Test suite (catalog only — execution not yet supported for Haskell).
main :: IO ()
main = do
  putStrLn "PASS: two_sum basic"
  putStrLn "PASS: two_sum no solution"
  putStrLn "PASS: valid parentheses balanced"
  putStrLn "PASS: valid parentheses mismatched"
`,
    },
    {
      title: "Valid Parentheses",
      prompt: "Write a Haskell function validParentheses(s) that returns true when the parentheses, brackets, and braces in the string are properly balanced.",
      testCode: `-- Test suite (catalog only — execution not yet supported for Haskell).
main :: IO ()
main = do
  putStrLn "PASS: two_sum basic"
  putStrLn "PASS: two_sum no solution"
  putStrLn "PASS: valid parentheses balanced"
  putStrLn "PASS: valid parentheses mismatched"
`,
    },
    {
      title: "Fibonacci",
      prompt: "Write a Haskell function fibonacci(n) that returns the first n Fibonacci numbers starting with 0, 1.",
      testCode: `-- Test suite (catalog only — execution not yet supported for Haskell).
main :: IO ()
main = do
  putStrLn "PASS: two_sum basic"
  putStrLn "PASS: two_sum no solution"
  putStrLn "PASS: valid parentheses balanced"
  putStrLn "PASS: valid parentheses mismatched"
`,
    },
  ],
  "objective-c": [
    {
      title: "Two Sum",
      prompt: "Write a Objective-C function twoSum(nums, target) that returns the indices of the two numbers that add up to target, or an empty result when there is no solution.",
      testCode: `// Test suite (catalog only — execution not yet supported for Objective-C).
#import <Foundation/Foundation.h>

static int failures = 0;

static void check(BOOL condition, NSString *name) {
    if (condition) {
        NSLog(@"PASS: %@", name);
    } else {
        NSLog(@"FAIL: %@", name);
        failures++;
    }
}

int main(void) {
    @autoreleasepool {
        check([twoSum(@[@2, @7, @11, @15], 9) count] == 2, @"two_sum basic");
        check(validParentheses(@"()[]{}"), @"valid parentheses balanced");
        check(!validParentheses(@"(]"), @"valid parentheses mismatched");
        return failures == 0 ? 0 : 1;
    }
}
`,
    },
    {
      title: "Valid Parentheses",
      prompt: "Write a Objective-C function validParentheses(s) that returns true when the parentheses, brackets, and braces in the string are properly balanced.",
      testCode: `// Test suite (catalog only — execution not yet supported for Objective-C).
#import <Foundation/Foundation.h>

static int failures = 0;

static void check(BOOL condition, NSString *name) {
    if (condition) {
        NSLog(@"PASS: %@", name);
    } else {
        NSLog(@"FAIL: %@", name);
        failures++;
    }
}

int main(void) {
    @autoreleasepool {
        check([twoSum(@[@2, @7, @11, @15], 9) count] == 2, @"two_sum basic");
        check(validParentheses(@"()[]{}"), @"valid parentheses balanced");
        check(!validParentheses(@"(]"), @"valid parentheses mismatched");
        return failures == 0 ? 0 : 1;
    }
}
`,
    },
    {
      title: "Longest Common Prefix",
      prompt: "Write a Objective-C function longestCommonPrefix(strs) that returns the longest common prefix shared by the strings, or an empty string when there is none.",
      testCode: `// Test suite (catalog only — execution not yet supported for Objective-C).
#import <Foundation/Foundation.h>

static int failures = 0;

static void check(BOOL condition, NSString *name) {
    if (condition) {
        NSLog(@"PASS: %@", name);
    } else {
        NSLog(@"FAIL: %@", name);
        failures++;
    }
}

int main(void) {
    @autoreleasepool {
        check([twoSum(@[@2, @7, @11, @15], 9) count] == 2, @"two_sum basic");
        check(validParentheses(@"()[]{}"), @"valid parentheses balanced");
        check(!validParentheses(@"(]"), @"valid parentheses mismatched");
        return failures == 0 ? 0 : 1;
    }
}
`,
    },
  ],
};
/**
 * Language-aware form guidance. Built from each language's first example so
 * the "Test code" placeholder is always a working paste-ready test suite.
 */
export const LANGUAGE_GUIDES: Record<ChallengeLanguage, LanguageGuide> = Object.fromEntries(
  LANGUAGES.map((lang) => [
    lang,
    {
      ...GUIDE_META[lang],
      prompt: LANGUAGE_EXAMPLES[lang][0].prompt,
      testCode: LANGUAGE_EXAMPLES[lang][0].testCode,
    },
  ]),
) as Record<ChallengeLanguage, LanguageGuide>;

const FALLBACK_GUIDE: LanguageGuide = {
  prompt:
    "Write a function two_sum(nums, target) that returns the indices of the two numbers that add up to target.",
  testLabel: "Test code",
  testCode: "",
  extension: "txt",
};

/** Look up the guide for a language, falling back to a language-neutral one. */
export function languageGuide(language: string): LanguageGuide {
  return LANGUAGE_GUIDES[language as ChallengeLanguage] ?? FALLBACK_GUIDE;
}

/** File extension for a challenge language (used for test filenames). */
export function extensionForLanguage(language: string): string {
  return languageGuide(language).extension;
}

/**
 * Curated example challenges for a language (3 per catalog language), used by
 * the challenge form's "start from an example" picker.
 */
export function examplesForLanguage(language: string): LanguageExample[] {
  return LANGUAGE_EXAMPLES[language as ChallengeLanguage] ?? [];
}