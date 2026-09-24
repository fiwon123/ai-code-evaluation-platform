/** Supported challenge languages (mirrors backend `schemas/challenge.py`). */
export const LANGUAGES = ["python", "javascript", "typescript", "java", "go"] as const;

export type ChallengeLanguage = (typeof LANGUAGES)[number];

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
 * Mirrors backend/src/app/services/language_runner.py — keep the two in sync.
 * The filenames/commands shown here are exactly what the sandbox executes.
 */
export const LANGUAGE_RUNNERS: Record<ChallengeLanguage, LanguageRunnerInfo> = {
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
};

/** Runner metadata for a challenge language, or null when unsupported. */
export function runnerForLanguage(language: string): LanguageRunnerInfo | null {
  return LANGUAGE_RUNNERS[language as ChallengeLanguage] ?? null;
}

/**
 * Curated example challenges — 2-3 per language. Each prompt keyword resolves
 * to a canned solution in the backend demo provider (mock_provider.py), and
 * each test suite targets that solution's exact exported names, so pasting an
 * example and running it against the demo provider passes out of the box.
 */
export const LANGUAGE_EXAMPLES: Record<ChallengeLanguage, LanguageExample[]> = {
  python: [
    {
      title: "Two Sum",
      prompt:
        "Write a Python function two_sum(nums, target) that returns the indices of the two numbers that add up to target, or [] when there is no solution.",
      testCode: `from solution import two_sum

def test_basic():
    assert two_sum([2, 7, 11, 15], 9) == [0, 1]

def test_no_solution():
    assert two_sum([1, 2, 3], 99) == []`,
    },
    {
      title: "Valid Parentheses",
      prompt:
        "Write a Python function valid_parentheses(s) that returns True when the parentheses, brackets, and braces in s are properly balanced.",
      testCode: `from solution import valid_parentheses

def test_balanced():
    assert valid_parentheses("()[]{}")

def test_mismatched():
    assert not valid_parentheses("(]")

def test_unclosed():
    assert not valid_parentheses("([)")`,
    },
    {
      title: "Longest Common Prefix",
      prompt:
        "Write a Python function longest_common_prefix(strs) that returns the longest common prefix shared by a list of strings, or an empty string when there is none.",
      testCode: `from solution import longest_common_prefix

def test_common_prefix():
    assert longest_common_prefix(["flower", "flow", "flight"]) == "fl"

def test_no_common_prefix():
    assert longest_common_prefix(["dog", "racecar", "car"]) == ""`,
    },
  ],
  javascript: [
    {
      title: "Two Sum",
      prompt:
        "Write a JavaScript function twoSum(nums, target) that returns the indices of the two numbers that add up to target, or [] when there is no solution.",
      testCode: `const { twoSum } = require('./solution.js');
const { test } = require('node:test');
const assert = require('assert');

test('twoSum', () => {
  assert.deepStrictEqual(twoSum([2, 7, 11, 15], 9), [0, 1]);
});

test('no solution', () => {
  assert.deepStrictEqual(twoSum([1, 2, 3], 99), []);
});`,
    },
    {
      title: "Valid Parentheses",
      prompt:
        "Write a JavaScript function validParentheses(s) that returns true when the parentheses, brackets, and braces in s are properly balanced.",
      testCode: `const { validParentheses } = require('./solution.js');
const { test } = require('node:test');
const assert = require('assert');

test('balanced', () => {
  assert.equal(validParentheses('()[]{}'), true);
});

test('mismatched', () => {
  assert.equal(validParentheses('(]'), false);
});`,
    },
    {
      title: "Longest Common Prefix",
      prompt:
        "Write a JavaScript function longestCommonPrefix(strs) that returns the longest common prefix shared by a list of strings, or an empty string when there is none.",
      testCode: `const { longestCommonPrefix } = require('./solution.js');
const { test } = require('node:test');
const assert = require('assert');

test('common prefix', () => {
  assert.equal(longestCommonPrefix(['flower', 'flow', 'flight']), 'fl');
});

test('no common prefix', () => {
  assert.equal(longestCommonPrefix(['dog', 'racecar', 'car']), '');
});`,
    },
  ],
  typescript: [
    {
      title: "Two Sum",
      prompt:
        "Write a TypeScript function twoSum(nums: number[], target: number): number[] that returns the indices of the two numbers that add up to target, or [] when there is no solution.",
      testCode: `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { twoSum } from './solution.ts';

test('twoSum', () => {
  assert.deepEqual(twoSum([2, 7, 11, 15], 9), [0, 1]);
});

test('no solution', () => {
  assert.deepEqual(twoSum([1, 2, 3], 99), []);
});`,
    },
    {
      title: "Valid Parentheses",
      prompt:
        "Write a TypeScript function validParentheses(s: string): boolean that returns true when the parentheses, brackets, and braces in s are properly balanced.",
      testCode: `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validParentheses } from './solution.ts';

test('balanced', () => {
  assert.equal(validParentheses('()[]{}'), true);
});

test('mismatched', () => {
  assert.equal(validParentheses('(]'), false);
});`,
    },
    {
      title: "Longest Common Prefix",
      prompt:
        "Write a TypeScript function longestCommonPrefix(strs: string[]): string that returns the longest common prefix shared by a list of strings, or an empty string when there is none.",
      testCode: `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { longestCommonPrefix } from './solution.ts';

test('common prefix', () => {
  assert.equal(longestCommonPrefix(['flower', 'flow', 'flight']), 'fl');
});

test('no common prefix', () => {
  assert.equal(longestCommonPrefix(['dog', 'racecar', 'car']), '');
});`,
    },
  ],
  java: [
    {
      title: "Two Sum",
      prompt:
        "Write a Java method int[] twoSum(int[] nums, int target) in the class Solution that returns the indices of the two numbers that add up to target, or an empty array when there is no solution.",
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
}`,
    },
    {
      title: "Valid Parentheses",
      prompt:
        "Write a Java method boolean validParentheses(String s) in the class Solution that returns true when the parentheses, brackets, and braces in s are properly balanced.",
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
}`,
    },
    {
      title: "Longest Common Prefix",
      prompt:
        "Write a Java method String longestCommonPrefix(String[] strs) in the class Solution that returns the longest common prefix shared by the strings, or an empty string when there is none.",
      testCode: `import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class SolutionTest {
    @Test
    void testCommonPrefix() {
        assertEquals(
            "fl",
            Solution.longestCommonPrefix(
                new String[] { "flower", "flow", "flight" }));
    }

    @Test
    void testNoCommonPrefix() {
        assertEquals(
            "",
            Solution.longestCommonPrefix(new String[] { "dog", "racecar", "car" }));
    }
}`,
    },
  ],
  go: [
    {
      title: "Two Sum",
      prompt:
        "Write a Go function TwoSum(nums []int, target int) []int that returns the indices of the two numbers that add up to target, or an empty slice when there is no solution.",
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
}`,
    },
    {
      title: "Valid Parentheses",
      prompt:
        "Write a Go function ValidParentheses(s string) bool that returns true when the parentheses, brackets, and braces in s are properly balanced.",
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
}`,
    },
    {
      title: "Longest Common Prefix",
      prompt:
        "Write a Go function LongestCommonPrefix(strs []string) string that returns the longest common prefix shared by the strings, or an empty string when there is none.",
      testCode: `package main

import "testing"

func TestLongestCommonPrefix(t *testing.T) {
    if got := LongestCommonPrefix([]string{"flower", "flow", "flight"}); got != "fl" {
        t.Errorf("expected fl, got %q", got)
    }
}

func TestLongestCommonPrefixNone(t *testing.T) {
    if got := LongestCommonPrefix([]string{"dog", "racecar", "car"}); got != "" {
        t.Errorf("expected empty string, got %q", got)
    }
}`,
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
 * Curated example challenges for a language (2-3 per language), used by the
 * challenge form's "start from an example" picker.
 */
export function examplesForLanguage(language: string): LanguageExample[] {
  return LANGUAGE_EXAMPLES[language as ChallengeLanguage] ?? [];
}