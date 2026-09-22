/** Supported challenge languages (mirrors backend `schemas/challenge.py`). */
export const LANGUAGES = ["python", "javascript", "typescript", "java", "go"] as const;

export type ChallengeLanguage = (typeof LANGUAGES)[number];

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

/**
 * Language-aware form guidance. Keeps examples in the same language as the
 * selected challenge so "Test code" is no longer always pytest/Python.
 */
export const LANGUAGE_GUIDES: Record<ChallengeLanguage, LanguageGuide> = {
  python: {
    prompt:
      "Write a Python function two_sum(nums, target) that returns the indices of the two numbers that add up to target.",
    testLabel: "Test code (pytest)",
    testCode: "def test_two_sum():\n    assert two_sum([2, 7, 11, 15], 9) == [0, 1]",
    extension: "py",
  },
  javascript: {
    prompt:
      "Write a JavaScript function twoSum(nums, target) that returns the indices of the two numbers that add up to target.",
    testLabel: "Test code (node:test/assert)",
    testCode:
      "const assert = require('assert');\ntest('twoSum', () => {\n  assert.deepStrictEqual(twoSum([2, 7, 11, 15], 9), [0, 1]);\n});",
    extension: "js",
  },
  typescript: {
    prompt:
      "Write a TypeScript function twoSum(nums: number[], target: number): number[] that returns the indices of the two numbers that add up to target.",
    testLabel: "Test code (vitest)",
    testCode:
      "import { expect, test } from 'vitest';\ntest('twoSum', () => {\n  expect(twoSum([2, 7, 11, 15], 9)).toEqual([0, 1]);\n});",
    extension: "ts",
  },
  java: {
    prompt:
      "Write a Java method int[] twoSum(int[] nums, int target) that returns the indices of the two numbers that add up to target.",
    testLabel: "Test code (JUnit)",
    testCode:
      "@Test\nvoid testTwoSum() {\n  assertArrayEquals(new int[]{0, 1}, twoSum(new int[]{2, 7, 11, 15}, 9));\n}",
    extension: "java",
  },
  go: {
    prompt:
      "Write a Go function twoSum(nums []int, target int) []int that returns the indices of the two numbers that add up to target.",
    testLabel: "Test code (go test)",
    testCode:
      'func TestTwoSum(t *testing.T) {\n  got := twoSum([]int{2, 7, 11, 15}, 9)\n  if got[0] != 0 || got[1] != 1 {\n    t.Errorf("expected [0 1], got %v", got)\n  }\n}',
    extension: "go",
  },
};

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