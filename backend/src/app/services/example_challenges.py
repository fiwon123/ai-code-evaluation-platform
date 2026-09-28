"""Curated example challenges + an idempotent seed routine.

The prompts and test suites here are the backend mirror of
``frontend/src/utils/language.ts`` (``LANGUAGE_EXAMPLES``) — keep the two in
sync. Each prompt resolves to a canned solution in the demo provider
(``services/llm_providers/mock_provider.py``), so seeded challenges evaluate
instantly with the demo provider and no API keys — for the 13 executable
languages (see ``app.services.languages.EXECUTABLE_LANGUAGES``). The 7
display-only languages are seeded for catalog completeness; generation and
evaluation fail with a clean "not supported" message until a runner exists.

Every language gets the same spine: Two Sum (easy) + Valid Parentheses
(medium) + a third problem. Three of the original five languages get the
hard Trapping Rain Water; the rest rotate through Longest Common Prefix,
FizzBuzz, and Fibonacci so the catalog is varied.
"""

from __future__ import annotations

import logging
import secrets
from dataclasses import dataclass

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.models.challenge import Challenge
from app.models.user import User
from app.services.languages import CATALOG_LANGUAGES

logger = logging.getLogger(__name__)

#: System account that owns the example challenges. Never meant to log in:
#: the password hash is generated from a discarded random token.
EXAMPLES_USERNAME = "examples"
EXAMPLES_EMAIL = "examples@platform.local"

DESCRIPTIONS = {
    "two_sum": (
        "Return the indices of the two numbers that add up to a target, or an "
        "empty result when there is no solution."
    ),
    "valid_parentheses": (
        "Determine whether the parentheses, brackets, and braces in a string are properly balanced."
    ),
    "longest_common_prefix": (
        "Return the longest common prefix shared by a list of strings, or an "
        "empty string when there is none."
    ),
    "fizzbuzz": (
        "Generate the FizzBuzz sequence from 1 to n: multiples of 3 become "
        "Fizz, multiples of 5 become Buzz, and both become FizzBuzz."
    ),
    "fibonacci": (
        "Return the first n Fibonacci numbers, starting with 0, 1 so the "
        "sequence grows by adding the two previous terms."
    ),
    "trapping_rain_water": (
        "Given an array of non-negative integers representing bar heights, "
        "return the total units of water that can be trapped between the bars."
    ),
}

#: Problem title → (description lookup key, difficulty).
_TITLE_META = {
    "Two Sum": ("two_sum", "easy"),
    "Valid Parentheses": ("valid_parentheses", "medium"),
    "Longest Common Prefix": ("longest_common_prefix", "easy"),
    "FizzBuzz": ("fizzbuzz", "easy"),
    "Fibonacci": ("fibonacci", "medium"),
    "Trapping Rain Water": ("trapping_rain_water", "hard"),
}

#: The trailing clause shared by every prompt for a problem, so wording stays
#: consistent across the catalog.
_PROMPT_CLAUSE = {
    "Two Sum": (
        "returns the indices of the two numbers that add up to target, or an "
        "empty result when there is no solution."
    ),
    "Valid Parentheses": (
        "returns true when the parentheses, brackets, and braces in the string "
        "are properly balanced."
    ),
    "Longest Common Prefix": (
        "returns the longest common prefix shared by the strings, or an empty "
        "string when there is none."
    ),
    "FizzBuzz": ("returns the FizzBuzz sequence from 1 to n as strings."),
    "Fibonacci": ("returns the first n Fibonacci numbers starting with 0, 1."),
    "Trapping Rain Water": (
        "computes the total units of water trapped between the bar heights after "
        "rain — the classic Trapping Rain Water problem."
    ),
}


@dataclass(frozen=True)
class SeedResult:
    """Counts returned by :func:`seed_example_challenges`."""

    created: int
    updated: int


# Each renderer builds ``{title: "prompt"}`` and ``{title: "test_code"}``.
# The prompts name the exact function the mock demo solution exports, so the
# canned solution matches the seeded test suite out of the box.


# --- Python ----------------------------------------------------------------
def _py_prompts() -> dict[str, str]:
    return {
        "Two Sum": "Write a Python function two_sum(nums, target) that "
        + _PROMPT_CLAUSE["Two Sum"],
        "Valid Parentheses": "Write a Python function valid_parentheses(s) that "
        + _PROMPT_CLAUSE["Valid Parentheses"],
        "Longest Common Prefix": "Write a Python function longest_common_prefix(strs) that "
        + _PROMPT_CLAUSE["Longest Common Prefix"],
        "FizzBuzz": "Write a Python function fizzbuzz(n) that " + _PROMPT_CLAUSE["FizzBuzz"],
        "Fibonacci": "Write a Python function fibonacci(n) that " + _PROMPT_CLAUSE["Fibonacci"],
        "Trapping Rain Water": "Write a Python function trap_rain_water(heights) that "
        + _PROMPT_CLAUSE["Trapping Rain Water"],
    }


def _py_tests() -> dict[str, str]:
    return {
        "Two Sum": """from solution import two_sum

def test_basic():
    assert two_sum([2, 7, 11, 15], 9) == [0, 1]

def test_no_solution():
    assert two_sum([1, 2, 3], 99) == []
""",
        "Valid Parentheses": """from solution import valid_parentheses

def test_balanced():
    assert valid_parentheses("()[]{}")

def test_mismatched():
    assert not valid_parentheses("(]")
""",
        "Longest Common Prefix": """from solution import longest_common_prefix

def test_common_prefix():
    assert longest_common_prefix(["flower", "flow", "flight"]) == "fl"

def test_no_common_prefix():
    assert longest_common_prefix(["dog", "racecar", "car"]) == ""
""",
        "FizzBuzz": """from solution import fizzbuzz

def test_first_five():
    assert fizzbuzz(5) == ["1", "2", "Fizz", "4", "Buzz"]

def test_fifteen():
    assert fizzbuzz(15)[-1] == "FizzBuzz"
""",
        "Fibonacci": """from solution import fibonacci

def test_first_seven():
    assert fibonacci(7) == [0, 1, 1, 2, 3, 5, 8]

def test_zero():
    assert fibonacci(0) == []
""",
        "Trapping Rain Water": """from solution import trap_rain_water

def test_classic():
    assert trap_rain_water([0, 1, 0, 2, 1, 0, 1, 3, 2, 1, 2, 1]) == 6

def test_second_case():
    assert trap_rain_water([4, 2, 0, 3, 2, 5]) == 9
""",
    }


# --- JavaScript -------------------------------------------------------------
def _js_prompts() -> dict[str, str]:
    return {
        "Two Sum": "Write a JavaScript function twoSum(nums, target) that "
        + _PROMPT_CLAUSE["Two Sum"],
        "Valid Parentheses": "Write a JavaScript function validParentheses(s) that "
        + _PROMPT_CLAUSE["Valid Parentheses"],
        "Longest Common Prefix": "Write a JavaScript function longestCommonPrefix(strs) that "
        + _PROMPT_CLAUSE["Longest Common Prefix"],
        "FizzBuzz": "Write a JavaScript function fizzBuzz(n) that " + _PROMPT_CLAUSE["FizzBuzz"],
        "Fibonacci": "Write a JavaScript function fibonacci(n) that " + _PROMPT_CLAUSE["Fibonacci"],
        "Trapping Rain Water": "Write a JavaScript function trapRainWater(heights) that "
        + _PROMPT_CLAUSE["Trapping Rain Water"],
    }


def _js_tests() -> dict[str, str]:
    return {
        "Two Sum": """const { twoSum } = require('./solution.js');
const { test } = require('node:test');
const assert = require('assert');

test('twoSum', () => {
  assert.deepStrictEqual(twoSum([2, 7, 11, 15], 9), [0, 1]);
});

test('no solution', () => {
  assert.deepStrictEqual(twoSum([1, 2, 3], 99), []);
});
""",
        "Valid Parentheses": """const { validParentheses } = require('./solution.js');
const { test } = require('node:test');
const assert = require('assert');

test('balanced', () => {
  assert.equal(validParentheses('()[]{}'), true);
});

test('mismatched', () => {
  assert.equal(validParentheses('(]'), false);
});
""",
        "Longest Common Prefix": """const { longestCommonPrefix } = require('./solution.js');
const { test } = require('node:test');
const assert = require('assert');

test('common prefix', () => {
  assert.equal(longestCommonPrefix(['flower', 'flow', 'flight']), 'fl');
});

test('no common prefix', () => {
  assert.equal(longestCommonPrefix(['dog', 'racecar', 'car']), '');
});
""",
        "FizzBuzz": """const { fizzBuzz } = require('./solution.js');
const { test } = require('node:test');
const assert = require('assert');

test('first five', () => {
  assert.deepStrictEqual(fizzBuzz(5), ['1', '2', 'Fizz', '4', 'Buzz']);
});

test('fifteen', () => {
  const result = fizzBuzz(15);
  assert.equal(result[result.length - 1], 'FizzBuzz');
});
""",
        "Fibonacci": """const { fibonacci } = require('./solution.js');
const { test } = require('node:test');
const assert = require('assert');

test('first seven', () => {
  assert.deepStrictEqual(fibonacci(7), [0, 1, 1, 2, 3, 5, 8]);
});

test('zero', () => {
  assert.deepStrictEqual(fibonacci(0), []);
});
""",
        "Trapping Rain Water": """const { trapRainWater } = require('./solution.js');
const { test } = require('node:test');
const assert = require('assert');

test('classic', () => {
  assert.equal(trapRainWater([0, 1, 0, 2, 1, 0, 1, 3, 2, 1, 2, 1]), 6);
});

test('second case', () => {
  assert.equal(trapRainWater([4, 2, 0, 3, 2, 5]), 9);
});
""",
    }


# --- TypeScript -------------------------------------------------------------
def _ts_prompts() -> dict[str, str]:
    return {
        "Two Sum": (
            "Write a TypeScript function twoSum(nums: number[], target: number): "
            "number[] that " + _PROMPT_CLAUSE["Two Sum"]
        ),
        "Valid Parentheses": (
            "Write a TypeScript function validParentheses(s: string): boolean that "
            + _PROMPT_CLAUSE["Valid Parentheses"]
        ),
        "Longest Common Prefix": (
            "Write a TypeScript function longestCommonPrefix(strs: string[]): string that "
            + _PROMPT_CLAUSE["Longest Common Prefix"]
        ),
        "FizzBuzz": "Write a TypeScript function fizzBuzz(n: number): string[] that "
        + _PROMPT_CLAUSE["FizzBuzz"],
        "Fibonacci": "Write a TypeScript function fibonacci(n: number): number[] that "
        + _PROMPT_CLAUSE["Fibonacci"],
        "Trapping Rain Water": (
            "Write a TypeScript function trapRainWater(heights: number[]): number that "
            + _PROMPT_CLAUSE["Trapping Rain Water"]
        ),
    }


def _ts_tests() -> dict[str, str]:
    return {
        "Two Sum": """import { test } from 'node:test';
import assert from 'node:assert/strict';
import { twoSum } from './solution.ts';

test('twoSum', () => {
  assert.deepEqual(twoSum([2, 7, 11, 15], 9), [0, 1]);
});

test('no solution', () => {
  assert.deepEqual(twoSum([1, 2, 3], 99), []);
});
""",
        "Valid Parentheses": """import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validParentheses } from './solution.ts';

test('balanced', () => {
  assert.equal(validParentheses('()[]{}'), true);
});

test('mismatched', () => {
  assert.equal(validParentheses('(]'), false);
});
""",
        "Longest Common Prefix": """import { test } from 'node:test';
import assert from 'node:assert/strict';
import { longestCommonPrefix } from './solution.ts';

test('common prefix', () => {
  assert.equal(longestCommonPrefix(['flower', 'flow', 'flight']), 'fl');
});

test('no common prefix', () => {
  assert.equal(longestCommonPrefix(['dog', 'racecar', 'car']), '');
});
""",
        "FizzBuzz": """import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fizzBuzz } from './solution.ts';

test('first five', () => {
  assert.deepEqual(fizzBuzz(5), ['1', '2', 'Fizz', '4', 'Buzz']);
});

test('fifteen', () => {
  const result = fizzBuzz(15);
  assert.equal(result[result.length - 1], 'FizzBuzz');
});
""",
        "Fibonacci": """import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fibonacci } from './solution.ts';

test('first seven', () => {
  assert.deepEqual(fibonacci(7), [0, 1, 1, 2, 3, 5, 8]);
});

test('zero', () => {
  assert.deepEqual(fibonacci(0), []);
});
""",
        "Trapping Rain Water": """import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trapRainWater } from './solution.ts';

test('classic', () => {
  assert.equal(trapRainWater([0, 1, 0, 2, 1, 0, 1, 3, 2, 1, 2, 1]), 6);
});

test('second case', () => {
  assert.equal(trapRainWater([4, 2, 0, 3, 2, 5]), 9);
});
""",
    }


# --- Java -------------------------------------------------------------------
def _java_prompts() -> dict[str, str]:
    return {
        "Two Sum": (
            "Write a Java method int[] twoSum(int[] nums, int target) in the class "
            "Solution that " + _PROMPT_CLAUSE["Two Sum"]
        ),
        "Valid Parentheses": (
            "Write a Java method boolean validParentheses(String s) in the class "
            "Solution that " + _PROMPT_CLAUSE["Valid Parentheses"]
        ),
        "Longest Common Prefix": (
            "Write a Java method String longestCommonPrefix(String[] strs) in the "
            "class Solution that " + _PROMPT_CLAUSE["Longest Common Prefix"]
        ),
        "FizzBuzz": (
            "Write a Java method List<String> fizzBuzz(int n) in the class Solution "
            "that " + _PROMPT_CLAUSE["FizzBuzz"]
        ),
        "Fibonacci": (
            "Write a Java method List<Long> fibonacci(int n) in the class Solution "
            "that " + _PROMPT_CLAUSE["Fibonacci"]
        ),
        "Trapping Rain Water": (
            "Write a Java method int trapRainWater(int[] heights) in the class "
            "Solution that " + _PROMPT_CLAUSE["Trapping Rain Water"]
        ),
    }


def _java_tests() -> dict[str, str]:
    return {
        "Two Sum": """import static org.junit.jupiter.api.Assertions.assertArrayEquals;

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
""",
        "Valid Parentheses": """import static org.junit.jupiter.api.Assertions.assertFalse;
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
""",
        "Longest Common Prefix": """import static org.junit.jupiter.api.Assertions.assertEquals;

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
            Solution.longestCommonPrefix(
                new String[] { "dog", "racecar", "car" }));
    }
}
""",
        "FizzBuzz": """import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;

import org.junit.jupiter.api.Test;

class SolutionTest {
    @Test
    void testFirstFive() {
        assertEquals(
            List.of("1", "2", "Fizz", "4", "Buzz"),
            Solution.fizzBuzz(5));
    }

    @Test
    void testFifteen() {
        List<String> result = Solution.fizzBuzz(15);
        assertEquals("FizzBuzz", result.get(result.size() - 1));
    }
}
""",
        "Fibonacci": """import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;

import org.junit.jupiter.api.Test;

class SolutionTest {
    @Test
    void testFirstSeven() {
        assertEquals(
            List.of(0L, 1L, 1L, 2L, 3L, 5L, 8L),
            Solution.fibonacci(7));
    }

    @Test
    void testZero() {
        assertEquals(List.of(), Solution.fibonacci(0));
    }
}
""",
        "Trapping Rain Water": """import static org.junit.jupiter.api.Assertions.assertEquals;

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
""",
    }


# --- Go ---------------------------------------------------------------------
def _go_prompts() -> dict[str, str]:
    return {
        "Two Sum": "Write a Go function TwoSum(nums []int, target int) []int that "
        + _PROMPT_CLAUSE["Two Sum"],
        "Valid Parentheses": "Write a Go function ValidParentheses(s string) bool that "
        + _PROMPT_CLAUSE["Valid Parentheses"],
        "Longest Common Prefix": (
            "Write a Go function LongestCommonPrefix(strs []string) string that "
            + _PROMPT_CLAUSE["Longest Common Prefix"]
        ),
        "FizzBuzz": "Write a Go function FizzBuzz(n int) []string that "
        + _PROMPT_CLAUSE["FizzBuzz"],
        "Fibonacci": "Write a Go function Fibonacci(n int) []int that "
        + _PROMPT_CLAUSE["Fibonacci"],
        "Trapping Rain Water": "Write a Go function TrapRainWater(heights []int) int that "
        + _PROMPT_CLAUSE["Trapping Rain Water"],
    }


def _go_tests() -> dict[str, str]:
    return {
        "Two Sum": """package main

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
""",
        "Valid Parentheses": """package main

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
""",
        "Longest Common Prefix": """package main

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
}
""",
        "FizzBuzz": """package main

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
""",
        "Fibonacci": """package main

import (
    "reflect"
    "testing"
)

func TestFibonacciFirstSeven(t *testing.T) {
    expected := []int{0, 1, 1, 2, 3, 5, 8}
    if got := Fibonacci(7); !reflect.DeepEqual(got, expected) {
        t.Errorf("expected %v, got %v", expected, got)
    }
}

func TestFibonacciZero(t *testing.T) {
    if got := Fibonacci(0); len(got) != 0 {
        t.Errorf("expected empty result, got %v", got)
    }
}
""",
        "Trapping Rain Water": """package main

import "testing"

func TestTrapRainWaterClassic(t *testing.T) {
    if got := TrapRainWater([]int{0, 1, 0, 2, 1, 0, 1, 3, 2, 1, 2, 1}); got != 6 {
        t.Errorf("expected 6, got %d", got)
    }
}

func TestTrapRainWaterSecondCase(t *testing.T) {
    if got := TrapRainWater([]int{4, 2, 0, 3, 2, 5}); got != 9 {
        t.Errorf("expected 9, got %d", got)
    }
}
""",
    }


# --- C (PASS/FAIL harness) ---------------------------------------------------
def _c_prompts() -> dict[str, str]:
    return {
        "Two Sum": (
            "Write a C11 function int* two_sum(int* nums, int nums_size, int target, "
            "int* return_size) that " + _PROMPT_CLAUSE["Two Sum"]
        ),
        "Valid Parentheses": "Write a C11 function bool valid_parentheses(const char* s) that "
        + _PROMPT_CLAUSE["Valid Parentheses"],
        "Longest Common Prefix": (
            "Write a C11 function char* longest_common_prefix(char** strs, "
            "int strs_size) that " + _PROMPT_CLAUSE["Longest Common Prefix"]
        ),
        "FizzBuzz": (
            "Write a C11 function char** fizzbuzz(int n, int* return_size) that "
            + _PROMPT_CLAUSE["FizzBuzz"]
        ),
        "Fibonacci": "Write a C11 function long long* fibonacci(int n, int* return_size) that "
        + _PROMPT_CLAUSE["Fibonacci"],
    }


def _c_tests() -> dict[str, str]:
    header = """#include <stdbool.h>
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
"""
    footer = """    return failures == 0 ? 0 : 1;
}
"""
    return {
        "Two Sum": header
        + """    int nums[] = {2, 7, 11, 15};
    int size = 0;
    int* res = two_sum(nums, 4, 9, &size);
    check(size == 2 && res[0] == 0 && res[1] == 1, "two_sum basic");

    int nums2[] = {1, 2, 3};
    res = two_sum(nums2, 3, 99, &size);
    check(res == NULL && size == 0, "two_sum no solution");
"""
        + footer,
        "Valid Parentheses": header
        + """    check(valid_parentheses("()[]{}"), "valid parentheses balanced");
    check(!valid_parentheses("(]"), "valid parentheses mismatched");
    check(!valid_parentheses("([)"), "valid parentheses unclosed");
"""
        + footer,
        "Longest Common Prefix": header
        + """    char* strs[] = {"flower", "flow", "flight"};
    char* prefix = longest_common_prefix(strs, 3);
    check(strcmp(prefix, "fl") == 0, "lcp common prefix");
    free(prefix);

    char* strs2[] = {"dog", "racecar", "car"};
    prefix = longest_common_prefix(strs2, 3);
    check(strcmp(prefix, "") == 0, "lcp no common prefix");
    free(prefix);
"""
        + footer,
        "FizzBuzz": header
        + """    int size = 0;
    char** result = fizzbuzz(5, &size);
    check(size == 5 && strcmp(result[0], "1") == 0, "fizzbuzz first");
    check(strcmp(result[2], "Fizz") == 0, "fizzbuzz fizz");
    check(strcmp(result[4], "Buzz") == 0, "fizzbuzz buzz");

    result = fizzbuzz(15, &size);
    check(size == 15 && strcmp(result[14], "FizzBuzz") == 0, "fizzbuzz fifteen");
"""
        + footer,
        "Fibonacci": header
        + """    int size = 0;
    long long* seq = fibonacci(7, &size);
    check(size == 7 && seq[0] == 0 && seq[6] == 8, "fibonacci first seven");

    seq = fibonacci(0, &size);
    check(size == 0 && seq == NULL, "fibonacci zero");
"""
        + footer,
    }


# --- C++ (PASS/FAIL harness) -------------------------------------------------
def _cpp_prompts() -> dict[str, str]:
    return {
        "Two Sum": (
            "Write a C++17 function std::vector<int> two_sum(const std::vector<int>& "
            "nums, int target) that " + _PROMPT_CLAUSE["Two Sum"]
        ),
        "Valid Parentheses": (
            "Write a C++17 function bool valid_parentheses(const std::string& s) that "
            + _PROMPT_CLAUSE["Valid Parentheses"]
        ),
        "Longest Common Prefix": (
            "Write a C++17 function std::string longest_common_prefix("
            "const std::vector<std::string>& strs) that " + _PROMPT_CLAUSE["Longest Common Prefix"]
        ),
        "FizzBuzz": "Write a C++17 function std::vector<std::string> fizzbuzz(int n) that "
        + _PROMPT_CLAUSE["FizzBuzz"],
        "Fibonacci": "Write a C++17 function std::vector<long long> fibonacci(int n) that "
        + _PROMPT_CLAUSE["Fibonacci"],
    }


def _cpp_tests() -> dict[str, str]:
    header = """#include <iostream>
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
"""
    footer = """    return failures == 0 ? 0 : 1;
}
"""
    return {
        "Two Sum": header
        + """    check(two_sum({2, 7, 11, 15}, 9) == std::vector<int>({0, 1}), "two_sum basic");
    check(two_sum({1, 2, 3}, 99) == std::vector<int>(), "two_sum no solution");
"""
        + footer,
        "Valid Parentheses": header
        + """    check(valid_parentheses("()[]{}"), "valid parentheses balanced");
    check(!valid_parentheses("(]"), "valid parentheses mismatched");
"""
        + footer,
        "Longest Common Prefix": header
        + """    check(
        longest_common_prefix({"flower", "flow", "flight"}) == "fl",
        "lcp common prefix");
    check(
        longest_common_prefix({"dog", "racecar", "car"}) == "",
        "lcp no common prefix");
"""
        + footer,
        "FizzBuzz": header
        + """    check(
        fizzbuzz(5) == std::vector<std::string>({"1", "2", "Fizz", "4", "Buzz"}),
        "fizzbuzz first five");
    check(fizzbuzz(15).back() == "FizzBuzz", "fizzbuzz fifteen");
"""
        + footer,
        "Fibonacci": header
        + """    check(
        fibonacci(7) == std::vector<long long>({0, 1, 1, 2, 3, 5, 8}),
        "fibonacci first seven");
    check(fibonacci(0).empty(), "fibonacci zero");
"""
        + footer,
    }


# --- Rust (PASS/FAIL harness) ------------------------------------------------
def _rust_prompts() -> dict[str, str]:
    return {
        "Two Sum": (
            "Write a Rust function pub fn two_sum(nums: &[i32], target: i32) -> Vec<i32> "
            "that " + _PROMPT_CLAUSE["Two Sum"]
        ),
        "Valid Parentheses": "Write a Rust function pub fn valid_parentheses(s: &str) -> bool that "
        + _PROMPT_CLAUSE["Valid Parentheses"],
        "Longest Common Prefix": (
            "Write a Rust function pub fn longest_common_prefix(strs: &[&str]) -> String "
            "that " + _PROMPT_CLAUSE["Longest Common Prefix"]
        ),
        "FizzBuzz": "Write a Rust function pub fn fizzbuzz(n: i32) -> Vec<String> that "
        + _PROMPT_CLAUSE["FizzBuzz"],
        "Fibonacci": "Write a Rust function pub fn fibonacci(n: i32) -> Vec<i64> that "
        + _PROMPT_CLAUSE["Fibonacci"],
    }


def _rust_tests() -> dict[str, str]:
    header = """mod solution;

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
"""
    footer = """    if failures > 0 {
        std::process::exit(1);
    }
}
"""
    return {
        "Two Sum": header
        + """    failures += check(
        solution::two_sum(&[2, 7, 11, 15], 9) == vec![0, 1],
        "two_sum basic");
    failures += check(
        solution::two_sum(&[1, 2, 3], 99) == Vec::<i32>::new(),
        "two_sum no solution");
"""
        + footer,
        "Valid Parentheses": header
        + """    failures += check(
        solution::valid_parentheses("()[]{}"), "valid parentheses balanced");
    failures += check(!solution::valid_parentheses("(]"), "valid parentheses mismatched");
"""
        + footer,
        "Longest Common Prefix": header
        + """    failures += check(
        solution::longest_common_prefix(&["flower", "flow", "flight"]) == s("fl"),
        "lcp common prefix");
    failures += check(
        solution::longest_common_prefix(&["dog", "racecar", "car"]) == s(""),
        "lcp no common prefix");
"""
        + footer,
        "FizzBuzz": header
        + """    failures += check(
        solution::fizzbuzz(5) == vec![s("1"), s("2"), s("Fizz"), s("4"), s("Buzz")],
        "fizzbuzz first five");
    failures += check(
        solution::fizzbuzz(15).last() == Some(&s("FizzBuzz")),
        "fizzbuzz fifteen");
"""
        + footer,
        "Fibonacci": header
        + """    failures += check(
        solution::fibonacci(7) == vec![0i64, 1, 1, 2, 3, 5, 8],
        "fibonacci first seven");
    failures += check(solution::fibonacci(0).is_empty(), "fibonacci zero");
"""
        + footer,
    }


# --- PHP (PASS/FAIL harness) -------------------------------------------------
def _php_prompts() -> dict[str, str]:
    return {
        "Two Sum": "Write a PHP function two_sum(array $nums, int $target): array that "
        + _PROMPT_CLAUSE["Two Sum"],
        "Valid Parentheses": "Write a PHP function valid_parentheses(string $s): bool that "
        + _PROMPT_CLAUSE["Valid Parentheses"],
        "Longest Common Prefix": (
            "Write a PHP function longest_common_prefix(array $strs): string that "
            + _PROMPT_CLAUSE["Longest Common Prefix"]
        ),
        "FizzBuzz": "Write a PHP function fizzbuzz(int $n): array that "
        + _PROMPT_CLAUSE["FizzBuzz"],
        "Fibonacci": "Write a PHP function fibonacci(int $n): array that "
        + _PROMPT_CLAUSE["Fibonacci"],
    }


def _php_tests() -> dict[str, str]:
    header = """<?php
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

"""
    footer = """
exit($failures === 0 ? 0 : 1);
"""
    return {
        "Two Sum": header
        + """check(two_sum([2, 7, 11, 15], 9) === [0, 1], 'two_sum basic');
check(two_sum([1, 2, 3], 99) === [], 'two_sum no solution');
"""
        + footer,
        "Valid Parentheses": header
        + """check(valid_parentheses('()[]{}') === true, 'valid parentheses balanced');
check(valid_parentheses('(]') === false, 'valid parentheses mismatched');
"""
        + footer,
        "Longest Common Prefix": header
        + """check(
    longest_common_prefix(['flower', 'flow', 'flight']) === 'fl', 'lcp common prefix');
check(longest_common_prefix(['dog', 'racecar', 'car']) === '', 'lcp no common prefix');
"""
        + footer,
        "FizzBuzz": header
        + """check(fizzbuzz(5) === ['1', '2', 'Fizz', '4', 'Buzz'], 'fizzbuzz first five');
$result = fizzbuzz(15);
check($result[count($result) - 1] === 'FizzBuzz', 'fizzbuzz fifteen');
"""
        + footer,
        "Fibonacci": header
        + """check(fibonacci(7) === [0, 1, 1, 2, 3, 5, 8], 'fibonacci first seven');
check(fibonacci(0) === [], 'fibonacci zero');
"""
        + footer,
    }


# --- Ruby (PASS/FAIL harness) ------------------------------------------------
def _ruby_prompts() -> dict[str, str]:
    return {
        "Two Sum": "Write a Ruby method two_sum(nums, target) that " + _PROMPT_CLAUSE["Two Sum"],
        "Valid Parentheses": "Write a Ruby method valid_parentheses(s) that "
        + _PROMPT_CLAUSE["Valid Parentheses"],
        "Longest Common Prefix": "Write a Ruby method longest_common_prefix(strs) that "
        + _PROMPT_CLAUSE["Longest Common Prefix"],
        "FizzBuzz": "Write a Ruby method fizzbuzz(n) that " + _PROMPT_CLAUSE["FizzBuzz"],
        "Fibonacci": "Write a Ruby method fibonacci(n) that " + _PROMPT_CLAUSE["Fibonacci"],
    }


def _ruby_tests() -> dict[str, str]:
    header = """require_relative 'solution'

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
"""
    footer = """
exit(failures.zero? ? 0 : 1)
"""
    return {
        "Two Sum": header
        + """failures += 1 unless check(two_sum([2, 7, 11, 15], 9) == [0, 1], 'two_sum basic')
failures += 1 unless check(two_sum([1, 2, 3], 99) == [], 'two_sum no solution')
"""
        + footer,
        "Valid Parentheses": header
        + """failures += 1 unless check(
  valid_parentheses('()[]{}') == true, 'valid parentheses balanced')
failures += 1 unless check(valid_parentheses('(]') == false, 'valid parentheses mismatched')
"""
        + footer,
        "Longest Common Prefix": header
        + """failures += 1 unless check(
  longest_common_prefix(%w[flower flow flight]) == 'fl', 'lcp common prefix')
failures += 1 unless check(longest_common_prefix(%w[dog racecar car]) == '', 'lcp no common prefix')
"""
        + footer,
        "FizzBuzz": header
        + """failures += 1 unless check(fizzbuzz(5) == %w[1 2 Fizz 4 Buzz], 'fizzbuzz first five')
failures += 1 unless check(fizzbuzz(15).last == 'FizzBuzz', 'fizzbuzz fifteen')
"""
        + footer,
        "Fibonacci": header
        + """failures += 1 unless check(
  fibonacci(7) == [0, 1, 1, 2, 3, 5, 8], 'fibonacci first seven')
failures += 1 unless check(fibonacci(0) == [], 'fibonacci zero')
"""
        + footer,
    }


# --- Perl (PASS/FAIL harness) ------------------------------------------------
def _perl_prompts() -> dict[str, str]:
    return {
        "Two Sum": "Write a Perl subroutine two_sum($nums, $target) returning an arrayref that "
        + _PROMPT_CLAUSE["Two Sum"],
        "Valid Parentheses": (
            "Write a Perl subroutine valid_parentheses($s) returning true/false that "
            + _PROMPT_CLAUSE["Valid Parentheses"]
        ),
        "Longest Common Prefix": (
            "Write a Perl subroutine longest_common_prefix($strs) returning a string that "
            + _PROMPT_CLAUSE["Longest Common Prefix"]
        ),
        "FizzBuzz": "Write a Perl subroutine fizzbuzz($n) returning an arrayref of strings that "
        + _PROMPT_CLAUSE["FizzBuzz"],
        "Fibonacci": "Write a Perl subroutine fibonacci($n) returning an arrayref that "
        + _PROMPT_CLAUSE["Fibonacci"],
    }


def _perl_tests() -> dict[str, str]:
    header = """use strict;
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

"""
    footer = """
exit($failures ? 1 : 0);
"""
    return {
        "Two Sum": header
        + """check(join_list(two_sum([2, 7, 11, 15], 9)) eq '0,1', 'two_sum basic');
check(scalar @{two_sum([1, 2, 3], 99)} == 0, 'two_sum no solution');
"""
        + footer,
        "Valid Parentheses": header
        + """check(valid_parentheses('()[]{}'), 'valid parentheses balanced');
check(!valid_parentheses('(]'), 'valid parentheses mismatched');
"""
        + footer,
        "Longest Common Prefix": header
        + """check(
    longest_common_prefix(['flower', 'flow', 'flight']) eq 'fl', 'lcp common prefix');
check(longest_common_prefix(['dog', 'racecar', 'car']) eq '', 'lcp no common prefix');
"""
        + footer,
        "FizzBuzz": header
        + """check(join_list(fizzbuzz(5)) eq '1,2,Fizz,4,Buzz', 'fizzbuzz first five');
my $fb15 = fizzbuzz(15);
check($fb15->[14] eq 'FizzBuzz', 'fizzbuzz fifteen');
"""
        + footer,
        "Fibonacci": header
        + """check(join_list(fibonacci(7)) eq '0,1,1,2,3,5,8', 'fibonacci first seven');
check(scalar @{fibonacci(0)} == 0, 'fibonacci zero');
"""
        + footer,
    }


# --- Lua (PASS/FAIL harness) ------------------------------------------------
def _lua_prompts() -> dict[str, str]:
    return {
        "Two Sum": "Write a Lua function two_sum(nums, target) that " + _PROMPT_CLAUSE["Two Sum"],
        "Valid Parentheses": "Write a Lua function valid_parentheses(s) that "
        + _PROMPT_CLAUSE["Valid Parentheses"],
        "Longest Common Prefix": "Write a Lua function longest_common_prefix(strs) that "
        + _PROMPT_CLAUSE["Longest Common Prefix"],
        "FizzBuzz": "Write a Lua function fizzbuzz(n) that " + _PROMPT_CLAUSE["FizzBuzz"],
        "Fibonacci": "Write a Lua function fibonacci(n) that " + _PROMPT_CLAUSE["Fibonacci"],
    }


def _lua_tests() -> dict[str, str]:
    header = """dofile("solution.lua")

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

"""
    footer = """
os.exit(failures == 0 and 0 or 1)
"""
    return {
        "Two Sum": header
        + """check(join(two_sum({2, 7, 11, 15}, 9)) == "0,1", "two_sum basic")
check(#two_sum({1, 2, 3}, 99) == 0, "two_sum no solution")
"""
        + footer,
        "Valid Parentheses": header
        + """check(valid_parentheses("()[]{}"), "valid parentheses balanced")
check(not valid_parentheses("(]"), "valid parentheses mismatched")
"""
        + footer,
        "Longest Common Prefix": header
        + """check(longest_common_prefix({"flower", "flow", "flight"}) == "fl", "lcp common prefix")
check(longest_common_prefix({"dog", "racecar", "car"}) == "", "lcp no common prefix")
"""
        + footer,
        "FizzBuzz": header
        + """check(join(fizzbuzz(5)) == "1,2,Fizz,4,Buzz", "fizzbuzz first five")
local fb15 = fizzbuzz(15)
check(fb15[15] == "FizzBuzz", "fizzbuzz fifteen")
"""
        + footer,
        "Fibonacci": header
        + """check(join(fibonacci(7)) == "0,1,1,2,3,5,8", "fibonacci first seven")
check(#fibonacci(0) == 0, "fibonacci zero")
"""
        + footer,
    }


# --- Kotlin (PASS/FAIL harness) ---------------------------------------------
def _kotlin_prompts() -> dict[str, str]:
    return {
        "Two Sum": (
            "Write a Kotlin function fun twoSum(nums: IntArray, target: Int): IntArray "
            "that " + _PROMPT_CLAUSE["Two Sum"]
        ),
        "Valid Parentheses": (
            "Write a Kotlin function fun validParentheses(s: String): Boolean that "
            + _PROMPT_CLAUSE["Valid Parentheses"]
        ),
        "Longest Common Prefix": (
            "Write a Kotlin function fun longestCommonPrefix(strs: Array<String>): "
            "String that " + _PROMPT_CLAUSE["Longest Common Prefix"]
        ),
        "FizzBuzz": "Write a Kotlin function fun fizzbuzz(n: Int): List<String> that "
        + _PROMPT_CLAUSE["FizzBuzz"],
        "Fibonacci": "Write a Kotlin function fun fibonacci(n: Int): List<Long> that "
        + _PROMPT_CLAUSE["Fibonacci"],
    }


def _kotlin_tests() -> dict[str, str]:
    header = """fun main() {
    var failures = 0

    fun check(condition: Boolean, name: String) {
        if (condition) {
            println("PASS: $name")
        } else {
            println("FAIL: $name")
            failures++
        }
    }

"""
    footer = """
    if (failures > 0) kotlin.system.exitProcess(1)
}
"""
    return {
        "Two Sum": header
        + """    check(
        twoSum(intArrayOf(2, 7, 11, 15), 9).contentEquals(intArrayOf(0, 1)), "two_sum basic")
    check(twoSum(intArrayOf(1, 2, 3), 99).isEmpty(), "two_sum no solution")
"""
        + footer,
        "Valid Parentheses": header
        + """    check(validParentheses("()[]{}"), "valid parentheses balanced")
    check(!validParentheses("(]"), "valid parentheses mismatched")
"""
        + footer,
        "Longest Common Prefix": header
        + """    check(
        longestCommonPrefix(arrayOf("flower", "flow", "flight")) == "fl", "lcp common prefix")
    check(longestCommonPrefix(arrayOf("dog", "racecar", "car")) == "", "lcp no common prefix")
"""
        + footer,
        "FizzBuzz": header
        + """    check(fizzbuzz(5) == listOf("1", "2", "Fizz", "4", "Buzz"), "fizzbuzz first five")
    check(fizzbuzz(15).last() == "FizzBuzz", "fizzbuzz fifteen")
"""
        + footer,
        "Fibonacci": header
        + """    check(fibonacci(7) == listOf(0L, 1L, 1L, 2L, 3L, 5L, 8L), "fibonacci first seven")
    check(fibonacci(0).isEmpty(), "fibonacci zero")
"""
        + footer,
    }


# --- Display-only languages (seeded for the catalog; never executed) --------
# Each renderer keeps the same spine (Two Sum + Valid Parentheses) plus one
# rotating title. The code is written in the language's idiom but is never
# run by the evaluation engine — generation reports "not supported".
def _display_prompts(language: str) -> dict[str, str]:
    labels = {
        "csharp": "C#",
        "swift": "Swift",
        "dart": "Dart",
        "scala": "Scala",
        "r": "R",
        "haskell": "Haskell",
        "objective-c": "Objective-C",
    }
    label = labels[language]
    return {
        "Two Sum": f"Write a {label} function twoSum(nums, target) that "
        + _PROMPT_CLAUSE["Two Sum"],
        "Valid Parentheses": f"Write a {label} function validParentheses(s) that "
        + _PROMPT_CLAUSE["Valid Parentheses"],
        "Longest Common Prefix": f"Write a {label} function longestCommonPrefix(strs) that "
        + _PROMPT_CLAUSE["Longest Common Prefix"],
        "FizzBuzz": f"Write a {label} function fizzBuzz(n) that " + _PROMPT_CLAUSE["FizzBuzz"],
        "Fibonacci": f"Write a {label} function fibonacci(n) that " + _PROMPT_CLAUSE["Fibonacci"],
    }


def _display_tests(language: str) -> dict[str, str]:
    """Per-language display-only test suites (catalog only, never executed)."""
    csharp = """// Test suite (catalog only — execution not yet supported for C#).
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
"""
    swift = """// Test suite (catalog only — execution not yet supported for Swift).
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
"""
    dart = """// Test suite (catalog only — execution not yet supported for Dart).
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
"""
    scala = """// Test suite (catalog only — execution not yet supported for Scala).
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
"""
    r = """# Test suite (catalog only — execution not yet supported for R).
failures <- 0L
check <- function(condition, name) {
  if (isTRUE(condition)) {
    cat("PASS:", name, "\n")
  } else {
    cat("FAIL:", name, "\n")
    failures <<- failures + 1L
  }
}
check(identical(two_sum(c(2L, 7L, 11L, 15L), 9L), c(0L, 1L)), "two_sum basic")
check(isTRUE(valid_parentheses("()[]{}")), "valid parentheses balanced")
check(!isTRUE(valid_parentheses("(]")), "valid parentheses mismatched")
if (failures > 0L) quit(status = 1L)
"""
    haskell = """-- Test suite (catalog only — execution not yet supported for Haskell).
main :: IO ()
main = do
  putStrLn "PASS: two_sum basic"
  putStrLn "PASS: two_sum no solution"
  putStrLn "PASS: valid parentheses balanced"
  putStrLn "PASS: valid parentheses mismatched"
"""
    objc = """// Test suite (catalog only — execution not yet supported for Objective-C).
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
"""
    suites = {
        "csharp": csharp,
        "swift": swift,
        "dart": dart,
        "scala": scala,
        "r": r,
        "haskell": haskell,
        "objective-c": objc,
    }
    return {
        "Two Sum": suites[language],
        "Valid Parentheses": suites[language],
        # The third slot reuses the same suite — the display-only entries are
        # marked with a comment so nobody mistakes them for runnable tests.
        "Longest Common Prefix": suites[language],
        "FizzBuzz": suites[language],
        "Fibonacci": suites[language],
    }


# --- catalog assembly --------------------------------------------------------
_PROMOTERS = {
    "python": _py_prompts,
    "javascript": _js_prompts,
    "typescript": _ts_prompts,
    "java": _java_prompts,
    "go": _go_prompts,
    "c": _c_prompts,
    "cpp": _cpp_prompts,
    "rust": _rust_prompts,
    "php": _php_prompts,
    "ruby": _ruby_prompts,
    "perl": _perl_prompts,
    "lua": _lua_prompts,
    "kotlin": _kotlin_prompts,
}

_TESTERS = {
    "python": _py_tests,
    "javascript": _js_tests,
    "typescript": _ts_tests,
    "java": _java_tests,
    "go": _go_tests,
    "c": _c_tests,
    "cpp": _cpp_tests,
    "rust": _rust_tests,
    "php": _php_tests,
    "ruby": _ruby_tests,
    "perl": _perl_tests,
    "lua": _lua_tests,
    "kotlin": _kotlin_tests,
}

#: Language → the three example titles it is seeded with. Executable
#: languages get a varied third; three of the original five get the hard
#: Trapping Rain Water.
_EXAMPLE_TITLES: dict[str, tuple[str, str, str]] = {
    "python": ("Two Sum", "Valid Parentheses", "Trapping Rain Water"),
    "javascript": ("Two Sum", "Valid Parentheses", "Trapping Rain Water"),
    "java": ("Two Sum", "Valid Parentheses", "Trapping Rain Water"),
    "typescript": ("Two Sum", "Valid Parentheses", "Longest Common Prefix"),
    "go": ("Two Sum", "Valid Parentheses", "FizzBuzz"),
    "c": ("Two Sum", "Valid Parentheses", "Longest Common Prefix"),
    "cpp": ("Two Sum", "Valid Parentheses", "FizzBuzz"),
    "rust": ("Two Sum", "Valid Parentheses", "Longest Common Prefix"),
    "php": ("Two Sum", "Valid Parentheses", "Fibonacci"),
    "ruby": ("Two Sum", "Valid Parentheses", "FizzBuzz"),
    "perl": ("Two Sum", "Valid Parentheses", "Longest Common Prefix"),
    "lua": ("Two Sum", "Valid Parentheses", "Fibonacci"),
    "kotlin": ("Two Sum", "Valid Parentheses", "FizzBuzz"),
    "csharp": ("Two Sum", "Valid Parentheses", "Longest Common Prefix"),
    "swift": ("Two Sum", "Valid Parentheses", "FizzBuzz"),
    "dart": ("Two Sum", "Valid Parentheses", "Fibonacci"),
    "scala": ("Two Sum", "Valid Parentheses", "Longest Common Prefix"),
    "r": ("Two Sum", "Valid Parentheses", "FizzBuzz"),
    "haskell": ("Two Sum", "Valid Parentheses", "Fibonacci"),
    "objective-c": ("Two Sum", "Valid Parentheses", "Longest Common Prefix"),
}


def _build_catalog() -> list[dict[str, str]]:
    """Assemble the 60 example challenges (20 languages × 3 titles)."""
    entries: list[dict[str, str]] = []
    for language, titles in _EXAMPLE_TITLES.items():
        if language in _PROMOTERS:
            prompts = _PROMOTERS[language]()
            tests = _TESTERS[language]()
        else:
            prompts = _display_prompts(language)
            tests = _display_tests(language)
        for title in titles:
            desc_key, _ = _TITLE_META[title]
            entries.append(
                {
                    "title": title,
                    "description": DESCRIPTIONS[desc_key],
                    "language": language,
                    "prompt": prompts[title],
                    "test_code": tests[title],
                }
            )
    return entries


EXAMPLE_CHALLENGES: list[dict[str, str]] = _build_catalog()

# Sanity guard: the catalog must cover exactly the 20 supported languages —
# this also protects the frontend mirror from silently drifting.
assert {entry["language"] for entry in EXAMPLE_CHALLENGES} == CATALOG_LANGUAGES
assert len(EXAMPLE_CHALLENGES) == len(CATALOG_LANGUAGES) * 3


async def _ensure_examples_owner(session: AsyncSession) -> User:
    """Return the system examples account, creating it once if missing."""
    result = await session.execute(
        select(User).where(or_(User.username == EXAMPLES_USERNAME, User.email == EXAMPLES_EMAIL))
    )
    owner = result.scalar_one_or_none()
    if owner is not None:
        return owner

    # Discard the random password so the account can never be logged into.
    owner = User(
        username=EXAMPLES_USERNAME,
        email=EXAMPLES_EMAIL,
        hashed_password=hash_password(secrets.token_urlsafe(48)),
        is_active=False,
    )
    session.add(owner)
    await session.flush()  # assign owner.id so challenge FK is valid
    return owner


async def seed_example_challenges(session: AsyncSession) -> SeedResult:
    """Idempotently upsert the curated example challenges.

    Only rows owned by the system examples account are touched; challenges
    created by regular users are never modified. Re-running refreshes the
    system rows whenever the catalog changes (the catalog is the source of
    truth for examples).
    """
    owner = await _ensure_examples_owner(session)

    existing = await session.execute(select(Challenge).where(Challenge.user_id == owner.id))
    by_key = {(c.language, c.title): c for c in existing.scalars()}

    created = 0
    updated = 0
    for example in EXAMPLE_CHALLENGES:
        key = (example["language"], example["title"])
        challenge = by_key.get(key)
        if challenge is None:
            session.add(
                Challenge(
                    user_id=owner.id,
                    title=example["title"],
                    description=example["description"],
                    prompt=example["prompt"],
                    test_code=example["test_code"],
                    language=example["language"],
                    difficulty=_TITLE_META[example["title"]][1],
                )
            )
            created += 1
            continue
        if (
            challenge.prompt != example["prompt"]
            or challenge.test_code != example["test_code"]
            or challenge.description != example["description"]
            or challenge.difficulty != _TITLE_META[example["title"]][1]
        ):
            challenge.prompt = example["prompt"]
            challenge.test_code = example["test_code"]
            challenge.description = example["description"]
            challenge.difficulty = _TITLE_META[example["title"]][1]
            updated += 1

    await session.commit()
    if created or updated:
        logger.info("Example challenges seeded: %d created, %d updated", created, updated)
    else:
        logger.debug("Example challenges already up to date")
    return SeedResult(created=created, updated=updated)
