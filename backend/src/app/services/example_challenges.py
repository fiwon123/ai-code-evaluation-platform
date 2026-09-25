"""Curated example challenges + an idempotent seed routine.

The prompts and test suites here are the backend mirror of
``frontend/src/utils/language.ts`` (``LANGUAGE_EXAMPLES``) — keep the two in
sync. Each prompt resolves to a canned solution in the demo provider
(``services/llm_providers/mock_provider.py``), so seeded challenges evaluate
instantly with the demo provider and no API keys.
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
}


@dataclass(frozen=True)
class SeedResult:
    """Counts returned by :func:`seed_example_challenges`."""

    created: int
    updated: int


# 3 example problems × 5 supported languages = 15 challenges.
# Difficulty is derived from the problem kind; the server_default ("medium")
# covers any future catalog entry without an explicit classification.
_DIFFICULTY_BY_TITLE = {
    "Two Sum": "easy",
    "Longest Common Prefix": "easy",
    "Valid Parentheses": "medium",
}

EXAMPLE_CHALLENGES: list[dict[str, str]] = [
    # --- Python ------------------------------------------------------------
    {
        "title": "Two Sum",
        "description": DESCRIPTIONS["two_sum"],
        "language": "python",
        "prompt": (
            "Write a Python function two_sum(nums, target) that returns the "
            "indices of the two numbers that add up to target, or [] when "
            "there is no solution."
        ),
        "test_code": """from solution import two_sum

def test_basic():
    assert two_sum([2, 7, 11, 15], 9) == [0, 1]

def test_no_solution():
    assert two_sum([1, 2, 3], 99) == []
""",
    },
    {
        "title": "Valid Parentheses",
        "description": DESCRIPTIONS["valid_parentheses"],
        "language": "python",
        "prompt": (
            "Write a Python function valid_parentheses(s) that returns True "
            "when the parentheses, brackets, and braces in s are properly "
            "balanced."
        ),
        "test_code": """from solution import valid_parentheses

def test_balanced():
    assert valid_parentheses("()[]{}")

def test_mismatched():
    assert not valid_parentheses("(]")

def test_unclosed():
    assert not valid_parentheses("([)")
""",
    },
    {
        "title": "Longest Common Prefix",
        "description": DESCRIPTIONS["longest_common_prefix"],
        "language": "python",
        "prompt": (
            "Write a Python function longest_common_prefix(strs) that returns "
            "the longest common prefix shared by a list of strings, or an "
            "empty string when there is none."
        ),
        "test_code": """from solution import longest_common_prefix

def test_common_prefix():
    assert longest_common_prefix(["flower", "flow", "flight"]) == "fl"

def test_no_common_prefix():
    assert longest_common_prefix(["dog", "racecar", "car"]) == ""
""",
    },
    # --- JavaScript ---------------------------------------------------------
    {
        "title": "Two Sum",
        "description": DESCRIPTIONS["two_sum"],
        "language": "javascript",
        "prompt": (
            "Write a JavaScript function twoSum(nums, target) that returns "
            "the indices of the two numbers that add up to target, or [] when "
            "there is no solution."
        ),
        "test_code": """const { twoSum } = require('./solution.js');
const { test } = require('node:test');
const assert = require('assert');

test('twoSum', () => {
  assert.deepStrictEqual(twoSum([2, 7, 11, 15], 9), [0, 1]);
});

test('no solution', () => {
  assert.deepStrictEqual(twoSum([1, 2, 3], 99), []);
});
""",
    },
    {
        "title": "Valid Parentheses",
        "description": DESCRIPTIONS["valid_parentheses"],
        "language": "javascript",
        "prompt": (
            "Write a JavaScript function validParentheses(s) that returns "
            "true when the parentheses, brackets, and braces in s are "
            "properly balanced."
        ),
        "test_code": """const { validParentheses } = require('./solution.js');
const { test } = require('node:test');
const assert = require('assert');

test('balanced', () => {
  assert.equal(validParentheses('()[]{}'), true);
});

test('mismatched', () => {
  assert.equal(validParentheses('(]'), false);
});
""",
    },
    {
        "title": "Longest Common Prefix",
        "description": DESCRIPTIONS["longest_common_prefix"],
        "language": "javascript",
        "prompt": (
            "Write a JavaScript function longestCommonPrefix(strs) that "
            "returns the longest common prefix shared by a list of strings, "
            "or an empty string when there is none."
        ),
        "test_code": """const { longestCommonPrefix } = require('./solution.js');
const { test } = require('node:test');
const assert = require('assert');

test('common prefix', () => {
  assert.equal(longestCommonPrefix(['flower', 'flow', 'flight']), 'fl');
});

test('no common prefix', () => {
  assert.equal(longestCommonPrefix(['dog', 'racecar', 'car']), '');
});
""",
    },
    # --- TypeScript ---------------------------------------------------------
    {
        "title": "Two Sum",
        "description": DESCRIPTIONS["two_sum"],
        "language": "typescript",
        "prompt": (
            "Write a TypeScript function twoSum(nums: number[], target: "
            "number): number[] that returns the indices of the two numbers "
            "that add up to target, or [] when there is no solution."
        ),
        "test_code": """import { test } from 'node:test';
import assert from 'node:assert/strict';
import { twoSum } from './solution.ts';

test('twoSum', () => {
  assert.deepEqual(twoSum([2, 7, 11, 15], 9), [0, 1]);
});

test('no solution', () => {
  assert.deepEqual(twoSum([1, 2, 3], 99), []);
});
""",
    },
    {
        "title": "Valid Parentheses",
        "description": DESCRIPTIONS["valid_parentheses"],
        "language": "typescript",
        "prompt": (
            "Write a TypeScript function validParentheses(s: string): "
            "boolean that returns true when the parentheses, brackets, and "
            "braces in s are properly balanced."
        ),
        "test_code": """import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validParentheses } from './solution.ts';

test('balanced', () => {
  assert.equal(validParentheses('()[]{}'), true);
});

test('mismatched', () => {
  assert.equal(validParentheses('(]'), false);
});
""",
    },
    {
        "title": "Longest Common Prefix",
        "description": DESCRIPTIONS["longest_common_prefix"],
        "language": "typescript",
        "prompt": (
            "Write a TypeScript function longestCommonPrefix(strs: string[]): "
            "string that returns the longest common prefix shared by a list "
            "of strings, or an empty string when there is none."
        ),
        "test_code": """import { test } from 'node:test';
import assert from 'node:assert/strict';
import { longestCommonPrefix } from './solution.ts';

test('common prefix', () => {
  assert.equal(longestCommonPrefix(['flower', 'flow', 'flight']), 'fl');
});

test('no common prefix', () => {
  assert.equal(longestCommonPrefix(['dog', 'racecar', 'car']), '');
});
""",
    },
    # --- Java ---------------------------------------------------------------
    {
        "title": "Two Sum",
        "description": DESCRIPTIONS["two_sum"],
        "language": "java",
        "prompt": (
            "Write a Java method int[] twoSum(int[] nums, int target) in the "
            "class Solution that returns the indices of the two numbers that "
            "add up to target, or an empty array when there is no solution."
        ),
        "test_code": """import static org.junit.jupiter.api.Assertions.assertArrayEquals;

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
    },
    {
        "title": "Valid Parentheses",
        "description": DESCRIPTIONS["valid_parentheses"],
        "language": "java",
        "prompt": (
            "Write a Java method boolean validParentheses(String s) in the "
            "class Solution that returns true when the parentheses, brackets, "
            "and braces in s are properly balanced."
        ),
        "test_code": """import static org.junit.jupiter.api.Assertions.assertFalse;
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
    },
    {
        "title": "Longest Common Prefix",
        "description": DESCRIPTIONS["longest_common_prefix"],
        "language": "java",
        "prompt": (
            "Write a Java method String longestCommonPrefix(String[] strs) in "
            "the class Solution that returns the longest common prefix shared "
            "by the strings, or an empty string when there is none."
        ),
        "test_code": """import static org.junit.jupiter.api.Assertions.assertEquals;

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
    },
    # --- Go -----------------------------------------------------------------
    {
        "title": "Two Sum",
        "description": DESCRIPTIONS["two_sum"],
        "language": "go",
        "prompt": (
            "Write a Go function TwoSum(nums []int, target int) []int that "
            "returns the indices of the two numbers that add up to target, or "
            "an empty slice when there is no solution."
        ),
        "test_code": """package main

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
    },
    {
        "title": "Valid Parentheses",
        "description": DESCRIPTIONS["valid_parentheses"],
        "language": "go",
        "prompt": (
            "Write a Go function ValidParentheses(s string) bool that returns "
            "true when the parentheses, brackets, and braces in s are "
            "properly balanced."
        ),
        "test_code": """package main

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
    },
    {
        "title": "Longest Common Prefix",
        "description": DESCRIPTIONS["longest_common_prefix"],
        "language": "go",
        "prompt": (
            "Write a Go function LongestCommonPrefix(strs []string) string "
            "that returns the longest common prefix shared by the strings, or "
            "an empty string when there is none."
        ),
        "test_code": """package main

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
    },
]


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
                    difficulty=_DIFFICULTY_BY_TITLE.get(example["title"], "medium"),
                )
            )
            created += 1
            continue
        if (
            challenge.prompt != example["prompt"]
            or challenge.test_code != example["test_code"]
            or challenge.description != example["description"]
            or challenge.difficulty != _DIFFICULTY_BY_TITLE.get(example["title"], "medium")
        ):
            challenge.prompt = example["prompt"]
            challenge.test_code = example["test_code"]
            challenge.description = example["description"]
            challenge.difficulty = _DIFFICULTY_BY_TITLE.get(example["title"], "medium")
            updated += 1

    await session.commit()
    if created or updated:
        logger.info("Example challenges seeded: %d created, %d updated", created, updated)
    else:
        logger.debug("Example challenges already up to date")
    return SeedResult(created=created, updated=updated)
