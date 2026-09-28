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
        "    if n <= 0:\n"
        "        return []\n"
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
    "valid_parentheses": (
        "def valid_parentheses(s):\n"
        "    pairs = {')': '(', ']': '[', '}': '{'}\n"
        "    stack = []\n"
        "    for ch in s:\n"
        "        if ch in pairs:\n"
        "            if not stack or stack.pop() != pairs[ch]:\n"
        "                return False\n"
        "        elif ch in '([{':\n"
        "            stack.append(ch)\n"
        "    return not stack\n"
    ),
    "longest_common_prefix": (
        "def longest_common_prefix(strs):\n"
        "    if not strs:\n"
        "        return ''\n"
        "    prefix = strs[0]\n"
        "    for s in strs[1:]:\n"
        "        while not s.startswith(prefix):\n"
        "            prefix = prefix[:-1]\n"
        "            if not prefix:\n"
        "                return ''\n"
        "    return prefix\n"
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
    "trapping_rain_water": (
        "def trap_rain_water(heights):\n"
        "    left, right = 0, len(heights) - 1\n"
        "    left_max = right_max = 0\n"
        "    total = 0\n"
        "    while left < right:\n"
        "        if heights[left] < heights[right]:\n"
        "            left_max = max(left_max, heights[left])\n"
        "            total += left_max - heights[left]\n"
        "            left += 1\n"
        "        else:\n"
        "            right_max = max(right_max, heights[right])\n"
        "            total += right_max - heights[right]\n"
        "            right -= 1\n"
        "    return total\n"
    ),
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
        "  if (n <= 0) return [];\n"
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
    "valid_parentheses": (
        "function validParentheses(s) {\n"
        "  const pairs = { ')': '(', ']': '[', '}': '{' };\n"
        "  const stack = [];\n"
        "  for (const ch of s) {\n"
        "    if (pairs[ch]) {\n"
        "      if (stack.pop() !== pairs[ch]) return false;\n"
        "    } else if (ch === '(' || ch === '[' || ch === '{') {\n"
        "      stack.push(ch);\n"
        "    }\n"
        "  }\n"
        "  return stack.length === 0;\n"
        "}\n"
        "module.exports = { validParentheses };\n"
    ),
    "longest_common_prefix": (
        "function longestCommonPrefix(strs) {\n"
        "  if (strs.length === 0) return '';\n"
        "  let prefix = strs[0];\n"
        "  for (let i = 1; i < strs.length; i++) {\n"
        "    while (!strs[i].startsWith(prefix)) {\n"
        "      prefix = prefix.slice(0, -1);\n"
        "      if (prefix === '') return '';\n"
        "    }\n"
        "  }\n"
        "  return prefix;\n"
        "}\n"
        "module.exports = { longestCommonPrefix };\n"
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
    "trapping_rain_water": (
        "function trapRainWater(heights) {\n"
        "  let left = 0, right = heights.length - 1;\n"
        "  let leftMax = 0, rightMax = 0, total = 0;\n"
        "  while (left < right) {\n"
        "    if (heights[left] < heights[right]) {\n"
        "      leftMax = Math.max(leftMax, heights[left]);\n"
        "      total += leftMax - heights[left];\n"
        "      left++;\n"
        "    } else {\n"
        "      rightMax = Math.max(rightMax, heights[right]);\n"
        "      total += rightMax - heights[right];\n"
        "      right--;\n"
        "    }\n"
        "  }\n"
        "  return total;\n"
        "}\n"
        "module.exports = { trapRainWater };\n"
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
        "  if (n <= 0) return [];\n"
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
    "valid_parentheses": (
        "export function validParentheses(s: string): boolean {\n"
        "  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };\n"
        "  const stack: string[] = [];\n"
        "  for (const ch of s) {\n"
        "    if (pairs[ch]) {\n"
        "      if (stack.pop() !== pairs[ch]) return false;\n"
        "    } else if (ch === '(' || ch === '[' || ch === '{') {\n"
        "      stack.push(ch);\n"
        "    }\n"
        "  }\n"
        "  return stack.length === 0;\n"
        "}\n"
    ),
    "longest_common_prefix": (
        "export function longestCommonPrefix(strs: string[]): string {\n"
        "  if (strs.length === 0) return '';\n"
        "  let prefix = strs[0];\n"
        "  for (let i = 1; i < strs.length; i++) {\n"
        "    while (!strs[i].startsWith(prefix)) {\n"
        "      prefix = prefix.slice(0, -1);\n"
        "      if (prefix === '') return '';\n"
        "    }\n"
        "  }\n"
        "  return prefix;\n"
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
    "trapping_rain_water": (
        "export function trapRainWater(heights: number[]): number {\n"
        "  let left = 0;\n"
        "  let right = heights.length - 1;\n"
        "  let leftMax = 0;\n"
        "  let rightMax = 0;\n"
        "  let total = 0;\n"
        "  while (left < right) {\n"
        "    if (heights[left] < heights[right]) {\n"
        "      leftMax = Math.max(leftMax, heights[left]);\n"
        "      total += leftMax - heights[left];\n"
        "      left++;\n"
        "    } else {\n"
        "      rightMax = Math.max(rightMax, heights[right]);\n"
        "      total += rightMax - heights[right];\n"
        "      right--;\n"
        "    }\n"
        "  }\n"
        "  return total;\n"
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
        "        if (n <= 0) return result;\n"
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
    "valid_parentheses": (
        "import java.util.ArrayDeque;\n"
        "import java.util.Deque;\n"
        "\n"
        "public class Solution {\n"
        "    public static boolean validParentheses(String s) {\n"
        "        Deque<Character> stack = new ArrayDeque<>();\n"
        "        for (char ch : s.toCharArray()) {\n"
        "            switch (ch) {\n"
        "                case '(':\n"
        "                case '[':\n"
        "                case '{':\n"
        "                    stack.push(ch);\n"
        "                    break;\n"
        "                case ')':\n"
        "                    if (stack.isEmpty() || stack.pop() != '(') return false;\n"
        "                    break;\n"
        "                case ']':\n"
        "                    if (stack.isEmpty() || stack.pop() != '[') return false;\n"
        "                    break;\n"
        "                case '}':\n"
        "                    if (stack.isEmpty() || stack.pop() != '{') return false;\n"
        "                    break;\n"
        "                default:\n"
        "                    break;\n"
        "            }\n"
        "        }\n"
        "        return stack.isEmpty();\n"
        "    }\n"
        "}\n"
    ),
    "longest_common_prefix": (
        "public class Solution {\n"
        "    public static String longestCommonPrefix(String[] strs) {\n"
        '        if (strs.length == 0) return "";\n'
        "        String prefix = strs[0];\n"
        "        for (int i = 1; i < strs.length; i++) {\n"
        "            while (!strs[i].startsWith(prefix)) {\n"
        "                prefix = prefix.substring(0, prefix.length() - 1);\n"
        '                if (prefix.isEmpty()) return "";\n'
        "            }\n"
        "        }\n"
        "        return prefix;\n"
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
    "trapping_rain_water": (
        "public class Solution {\n"
        "    public static int trapRainWater(int[] heights) {\n"
        "        int left = 0, right = heights.length - 1;\n"
        "        int leftMax = 0, rightMax = 0, total = 0;\n"
        "        while (left < right) {\n"
        "            if (heights[left] < heights[right]) {\n"
        "                leftMax = Math.max(leftMax, heights[left]);\n"
        "                total += leftMax - heights[left];\n"
        "                left++;\n"
        "            } else {\n"
        "                rightMax = Math.max(rightMax, heights[right]);\n"
        "                total += rightMax - heights[right];\n"
        "                right--;\n"
        "            }\n"
        "        }\n"
        "        return total;\n"
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
        "    if n <= 0 {\n"
        "        return result\n"
        "    }\n"
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
    "valid_parentheses": (
        "package main\n"
        "\n"
        "func ValidParentheses(s string) bool {\n"
        "    stack := make([]byte, 0, len(s))\n"
        "    for i := 0; i < len(s); i++ {\n"
        "        switch s[i] {\n"
        "        case '(', '[', '{':\n"
        "            stack = append(stack, s[i])\n"
        "        case ')':\n"
        "            if len(stack) == 0 || stack[len(stack)-1] != '(' {\n"
        "                return false\n"
        "            }\n"
        "            stack = stack[:len(stack)-1]\n"
        "        case ']':\n"
        "            if len(stack) == 0 || stack[len(stack)-1] != '[' {\n"
        "                return false\n"
        "            }\n"
        "            stack = stack[:len(stack)-1]\n"
        "        case '}':\n"
        "            if len(stack) == 0 || stack[len(stack)-1] != '{' {\n"
        "                return false\n"
        "            }\n"
        "            stack = stack[:len(stack)-1]\n"
        "        }\n"
        "    }\n"
        "    return len(stack) == 0\n"
        "}\n"
    ),
    "longest_common_prefix": (
        "package main\n"
        "\n"
        'import "strings"\n'
        "\n"
        "func LongestCommonPrefix(strs []string) string {\n"
        "    if len(strs) == 0 {\n"
        '        return ""\n'
        "    }\n"
        "    prefix := strs[0]\n"
        "    for _, s := range strs[1:] {\n"
        "        for !strings.HasPrefix(s, prefix) {\n"
        "            prefix = prefix[:len(prefix)-1]\n"
        '            if prefix == "" {\n'
        '                return ""\n'
        "            }\n"
        "        }\n"
        "    }\n"
        "    return prefix\n"
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
    "trapping_rain_water": (
        "package main\n"
        "\n"
        "func TrapRainWater(heights []int) int {\n"
        "    left, right := 0, len(heights)-1\n"
        "    leftMax, rightMax, total := 0, 0, 0\n"
        "    for left < right {\n"
        "        if heights[left] < heights[right] {\n"
        "            if heights[left] > leftMax {\n"
        "                leftMax = heights[left]\n"
        "            }\n"
        "            total += leftMax - heights[left]\n"
        "            left++\n"
        "        } else {\n"
        "            if heights[right] > rightMax {\n"
        "                rightMax = heights[right]\n"
        "            }\n"
        "            total += rightMax - heights[right]\n"
        "            right--\n"
        "        }\n"
        "    }\n"
        "    return total\n"
        "}\n"
    ),
}

# --- C -----------------------------------------------------------------------
_C_SOLUTIONS: dict[str, str] = {
    "two_sum": (
        "#include <stdlib.h>\n"
        "\n"
        "int* two_sum(int* nums, int nums_size, int target, int* return_size) {\n"
        "    for (int i = 0; i < nums_size; i++) {\n"
        "        for (int j = i + 1; j < nums_size; j++) {\n"
        "            if (nums[i] + nums[j] == target) {\n"
        "                int* result = malloc(2 * sizeof(int));\n"
        "                result[0] = i;\n"
        "                result[1] = j;\n"
        "                *return_size = 2;\n"
        "                return result;\n"
        "            }\n"
        "        }\n"
        "    }\n"
        "    *return_size = 0;\n"
        "    return NULL;\n"
        "}\n"
    ),
    "fizzbuzz": (
        "#include <stdio.h>\n"
        "#include <stdlib.h>\n"
        "#include <string.h>\n"
        "\n"
        "char** fizzbuzz(int n, int* return_size) {\n"
        "    if (n <= 0) {\n"
        "        *return_size = 0;\n"
        "        return NULL;\n"
        "    }\n"
        "    char** result = malloc((size_t)n * sizeof(char*));\n"
        "    for (int i = 1; i <= n; i++) {\n"
        "        const char* value;\n"
        "        char number[32];\n"
        "        if (i % 15 == 0) {\n"
        '            value = "FizzBuzz";\n'
        "        } else if (i % 3 == 0) {\n"
        '            value = "Fizz";\n'
        "        } else if (i % 5 == 0) {\n"
        '            value = "Buzz";\n'
        "        } else {\n"
        '            snprintf(number, sizeof(number), "%d", i);\n'
        "            value = number;\n"
        "        }\n"
        "        size_t len = strlen(value) + 1;\n"
        "        result[i - 1] = malloc(len);\n"
        "        memcpy(result[i - 1], value, len);\n"
        "    }\n"
        "    *return_size = n;\n"
        "    return result;\n"
        "}\n"
    ),
    "valid_parentheses": (
        "#include <stdbool.h>\n"
        "\n"
        "bool valid_parentheses(const char* s) {\n"
        "    char stack[512];\n"
        "    int top = 0;\n"
        "    for (const char* p = s; *p; p++) {\n"
        "        if (*p == '(' || *p == '[' || *p == '{') {\n"
        "            if (top >= 512) return false;\n"
        "            stack[top++] = *p;\n"
        "        } else if (*p == ')' || *p == ']' || *p == '}') {\n"
        "            if (top == 0) return false;\n"
        "            char open = stack[--top];\n"
        "            if ((*p == ')' && open != '(') ||\n"
        "                (*p == ']' && open != '[') ||\n"
        "                (*p == '}' && open != '{')) {\n"
        "                return false;\n"
        "            }\n"
        "        }\n"
        "    }\n"
        "    return top == 0;\n"
        "}\n"
    ),
    "longest_common_prefix": (
        "#include <stdlib.h>\n"
        "#include <string.h>\n"
        "\n"
        "char* longest_common_prefix(char** strs, int strs_size) {\n"
        "    if (strs_size == 0) {\n"
        "        char* empty = malloc(1);\n"
        "        empty[0] = '\\0';\n"
        "        return empty;\n"
        "    }\n"
        "    size_t prefix_len = strlen(strs[0]);\n"
        "    for (int i = 1; i < strs_size; i++) {\n"
        "        size_t other_len = strlen(strs[i]);\n"
        "        size_t limit = prefix_len < other_len ? prefix_len : other_len;\n"
        "        size_t match = 0;\n"
        "        while (match < limit && strs[i][match] == strs[0][match]) {\n"
        "            match++;\n"
        "        }\n"
        "        prefix_len = match;\n"
        "        if (prefix_len == 0) break;\n"
        "    }\n"
        "    char* result = malloc(prefix_len + 1);\n"
        "    memcpy(result, strs[0], prefix_len);\n"
        "    result[prefix_len] = '\\0';\n"
        "    return result;\n"
        "}\n"
    ),
    "fibonacci": (
        "#include <stdlib.h>\n"
        "\n"
        "long long* fibonacci(int n, int* return_size) {\n"
        "    if (n <= 0) {\n"
        "        *return_size = 0;\n"
        "        return NULL;\n"
        "    }\n"
        "    long long* seq = malloc((size_t)n * sizeof(long long));\n"
        "    if (n >= 1) seq[0] = 0;\n"
        "    if (n >= 2) seq[1] = 1;\n"
        "    for (int i = 2; i < n; i++) {\n"
        "        seq[i] = seq[i - 1] + seq[i - 2];\n"
        "    }\n"
        "    *return_size = n;\n"
        "    return seq;\n"
        "}\n"
    ),
}

# --- C++ ---------------------------------------------------------------------
_CPP_SOLUTIONS: dict[str, str] = {
    "two_sum": (
        "#include <unordered_map>\n"
        "#include <vector>\n"
        "\n"
        "std::vector<int> two_sum(const std::vector<int>& nums, int target) {\n"
        "    std::unordered_map<int, int> seen;\n"
        "    for (int i = 0; i < static_cast<int>(nums.size()); i++) {\n"
        "        int complement = target - nums[i];\n"
        "        auto it = seen.find(complement);\n"
        "        if (it != seen.end()) return {it->second, i};\n"
        "        seen[nums[i]] = i;\n"
        "    }\n"
        "    return {};\n"
        "}\n"
    ),
    "fizzbuzz": (
        "#include <string>\n"
        "#include <vector>\n"
        "\n"
        "std::vector<std::string> fizzbuzz(int n) {\n"
        "    std::vector<std::string> result;\n"
        "    if (n <= 0) return result;\n"
        "    result.reserve(static_cast<size_t>(n));\n"
        "    for (int i = 1; i <= n; i++) {\n"
        '        if (i % 15 == 0) result.emplace_back("FizzBuzz");\n'
        '        else if (i % 3 == 0) result.emplace_back("Fizz");\n'
        '        else if (i % 5 == 0) result.emplace_back("Buzz");\n'
        "        else result.push_back(std::to_string(i));\n"
        "    }\n"
        "    return result;\n"
        "}\n"
    ),
    "valid_parentheses": (
        "#include <string>\n"
        "#include <unordered_map>\n"
        "#include <vector>\n"
        "\n"
        "bool valid_parentheses(const std::string& s) {\n"
        "    std::unordered_map<char, char> pairs = {{')', '('}, {']', '['}, {'}', '{'}};\n"
        "    std::vector<char> stack;\n"
        "    for (char ch : s) {\n"
        "        auto it = pairs.find(ch);\n"
        "        if (it != pairs.end()) {\n"
        "            if (stack.empty() || stack.back() != it->second) return false;\n"
        "            stack.pop_back();\n"
        "        } else if (ch == '(' || ch == '[' || ch == '{') {\n"
        "            stack.push_back(ch);\n"
        "        }\n"
        "    }\n"
        "    return stack.empty();\n"
        "}\n"
    ),
    "longest_common_prefix": (
        "#include <string>\n"
        "#include <vector>\n"
        "\n"
        "std::string longest_common_prefix(const std::vector<std::string>& strs) {\n"
        '    if (strs.empty()) return "";\n'
        "    std::string prefix = strs[0];\n"
        "    for (size_t i = 1; i < strs.size(); i++) {\n"
        "        while (strs[i].rfind(prefix, 0) != 0) {\n"
        "            prefix.pop_back();\n"
        '            if (prefix.empty()) return "";\n'
        "        }\n"
        "    }\n"
        "    return prefix;\n"
        "}\n"
    ),
    "fibonacci": (
        "#include <vector>\n"
        "\n"
        "std::vector<long long> fibonacci(int n) {\n"
        "    std::vector<long long> seq;\n"
        "    if (n <= 0) return seq;\n"
        "    seq.reserve(static_cast<size_t>(n));\n"
        "    seq.push_back(0);\n"
        "    if (n >= 2) {\n"
        "        seq.push_back(1);\n"
        "        for (int i = 2; i < n; i++) seq.push_back(seq[i - 1] + seq[i - 2]);\n"
        "    }\n"
        "    return seq;\n"
        "}\n"
    ),
}

# --- Rust --------------------------------------------------------------------
_RUST_SOLUTIONS: dict[str, str] = {
    "two_sum": (
        "use std::collections::HashMap;\n"
        "\n"
        "pub fn two_sum(nums: &[i32], target: i32) -> Vec<i32> {\n"
        "    let mut seen: HashMap<i32, usize> = HashMap::new();\n"
        "    for (i, &num) in nums.iter().enumerate() {\n"
        "        let complement = target - num;\n"
        "        if let Some(&j) = seen.get(&complement) {\n"
        "            return vec![j as i32, i as i32];\n"
        "        }\n"
        "        seen.insert(num, i);\n"
        "    }\n"
        "    vec![]\n"
        "}\n"
    ),
    "fizzbuzz": (
        "pub fn fizzbuzz(n: i32) -> Vec<String> {\n"
        "    if n <= 0 { return Vec::new(); }\n"
        "    (1..=n)\n"
        "        .map(|i| {\n"
        '            if i % 15 == 0 { "FizzBuzz".to_string() }\n'
        '            else if i % 3 == 0 { "Fizz".to_string() }\n'
        '            else if i % 5 == 0 { "Buzz".to_string() }\n'
        "            else { i.to_string() }\n"
        "        })\n"
        "        .collect()\n"
        "}\n"
    ),
    "valid_parentheses": (
        "pub fn valid_parentheses(s: &str) -> bool {\n"
        "    let mut stack: Vec<char> = Vec::new();\n"
        "    for ch in s.chars() {\n"
        "        match ch {\n"
        "            '(' | '[' | '{' => stack.push(ch),\n"
        "            ')' => {\n"
        "                if stack.pop() != Some('(') { return false; }\n"
        "            }\n"
        "            ']' => {\n"
        "                if stack.pop() != Some('[') { return false; }\n"
        "            }\n"
        "            '}' => {\n"
        "                if stack.pop() != Some('{') { return false; }\n"
        "            }\n"
        "            _ => {}\n"
        "        }\n"
        "    }\n"
        "    stack.is_empty()\n"
        "}\n"
    ),
    "longest_common_prefix": (
        "pub fn longest_common_prefix(strs: &[&str]) -> String {\n"
        "    if strs.is_empty() { return String::new(); }\n"
        "    let mut prefix = strs[0].to_string();\n"
        "    for s in strs.iter().skip(1) {\n"
        "        while !s.starts_with(&prefix) {\n"
        "            prefix.pop();\n"
        "            if prefix.is_empty() { return String::new(); }\n"
        "        }\n"
        "    }\n"
        "    prefix\n"
        "}\n"
    ),
    "fibonacci": (
        "pub fn fibonacci(n: i32) -> Vec<i64> {\n"
        "    if n <= 0 { return Vec::new(); }\n"
        "    let mut seq: Vec<i64> = Vec::with_capacity(n as usize);\n"
        "    if n >= 1 { seq.push(0); }\n"
        "    if n >= 2 { seq.push(1); }\n"
        "    while (seq.len() as i32) < n {\n"
        "        let next = seq[seq.len() - 1] + seq[seq.len() - 2];\n"
        "        seq.push(next);\n"
        "    }\n"
        "    seq\n"
        "}\n"
    ),
}

# --- PHP ---------------------------------------------------------------------
_PHP_SOLUTIONS: dict[str, str] = {
    "two_sum": (
        "<?php\n"
        "\n"
        "function two_sum(array $nums, int $target): array {\n"
        "    $seen = [];\n"
        "    foreach ($nums as $i => $num) {\n"
        "        $complement = $target - $num;\n"
        "        if (array_key_exists($complement, $seen)) {\n"
        "            return [$seen[$complement], $i];\n"
        "        }\n"
        "        $seen[$num] = $i;\n"
        "    }\n"
        "    return [];\n"
        "}\n"
    ),
    "fizzbuzz": (
        "<?php\n"
        "\n"
        "function fizzbuzz(int $n): array {\n"
        "    if ($n <= 0) return [];\n"
        "    $result = [];\n"
        "    for ($i = 1; $i <= $n; $i++) {\n"
        "        if ($i % 15 === 0) { $result[] = 'FizzBuzz'; }\n"
        "        elseif ($i % 3 === 0) { $result[] = 'Fizz'; }\n"
        "        elseif ($i % 5 === 0) { $result[] = 'Buzz'; }\n"
        "        else { $result[] = (string) $i; }\n"
        "    }\n"
        "    return $result;\n"
        "}\n"
    ),
    "valid_parentheses": (
        "<?php\n"
        "\n"
        "function valid_parentheses(string $s): bool {\n"
        "    $pairs = [')' => '(', ']' => '[', '}' => '{'];\n"
        "    $stack = [];\n"
        "    for ($i = 0; $i < strlen($s); $i++) {\n"
        "        $ch = $s[$i];\n"
        "        if (isset($pairs[$ch])) {\n"
        "            if (array_pop($stack) !== $pairs[$ch]) return false;\n"
        "        } elseif ($ch === '(' || $ch === '[' || $ch === '{') {\n"
        "            $stack[] = $ch;\n"
        "        }\n"
        "    }\n"
        "    return empty($stack);\n"
        "}\n"
    ),
    "longest_common_prefix": (
        "<?php\n"
        "\n"
        "function longest_common_prefix(array $strs): string {\n"
        "    if (count($strs) === 0) return '';\n"
        "    $prefix = $strs[0];\n"
        "    for ($i = 1; $i < count($strs); $i++) {\n"
        "        while (strpos($strs[$i], $prefix) !== 0) {\n"
        "            $prefix = substr($prefix, 0, -1);\n"
        "            if ($prefix === '') return '';\n"
        "        }\n"
        "    }\n"
        "    return $prefix;\n"
        "}\n"
    ),
    "fibonacci": (
        "<?php\n"
        "\n"
        "function fibonacci(int $n): array {\n"
        "    if ($n <= 0) return [];\n"
        "    $seq = [0];\n"
        "    if ($n === 1) return $seq;\n"
        "    $seq[] = 1;\n"
        "    for ($i = 2; $i < $n; $i++) {\n"
        "        $seq[] = $seq[$i - 1] + $seq[$i - 2];\n"
        "    }\n"
        "    return $seq;\n"
        "}\n"
    ),
}

# --- Ruby --------------------------------------------------------------------
_RUBY_SOLUTIONS: dict[str, str] = {
    "two_sum": (
        "def two_sum(nums, target)\n"
        "  seen = {}\n"
        "  nums.each_with_index do |num, i|\n"
        "    complement = target - num\n"
        "    return [seen[complement], i] if seen.key?(complement)\n"
        "    seen[num] = i\n"
        "  end\n"
        "  []\n"
        "end\n"
    ),
    "fizzbuzz": (
        "def fizzbuzz(n)\n"
        "  return [] if n <= 0\n"
        "  (1..n).map do |i|\n"
        "    if i % 15 == 0\n"
        "      'FizzBuzz'\n"
        "    elsif i % 3 == 0\n"
        "      'Fizz'\n"
        "    elsif i % 5 == 0\n"
        "      'Buzz'\n"
        "    else\n"
        "      i.to_s\n"
        "    end\n"
        "  end\n"
        "end\n"
    ),
    "valid_parentheses": (
        "def valid_parentheses(s)\n"
        "  pairs = { ')' => '(', ']' => '[', '}' => '{' }\n"
        "  stack = []\n"
        "  s.each_char do |ch|\n"
        "    if pairs.key?(ch)\n"
        "      return false unless stack.pop == pairs[ch]\n"
        "    elsif '([{'.include?(ch)\n"
        "      stack.push(ch)\n"
        "    end\n"
        "  end\n"
        "  stack.empty?\n"
        "end\n"
    ),
    "longest_common_prefix": (
        "def longest_common_prefix(strs)\n"
        "  return '' if strs.empty?\n"
        "  prefix = strs[0]\n"
        "  strs[1..].each do |s|\n"
        "    while !s.start_with?(prefix)\n"
        "      prefix = prefix[0...-1]\n"
        "      return '' if prefix.empty?\n"
        "    end\n"
        "  end\n"
        "  prefix\n"
        "end\n"
    ),
    "fibonacci": (
        "def fibonacci(n)\n"
        "  return [] if n <= 0\n"
        "  seq = [0]\n"
        "  return seq if n == 1\n"
        "  seq << 1\n"
        "  seq << seq[-1] + seq[-2] while seq.length < n\n"
        "  seq\n"
        "end\n"
    ),
}

# --- Perl --------------------------------------------------------------------
_PERL_SOLUTIONS: dict[str, str] = {
    "two_sum": (
        "use strict;\n"
        "use warnings;\n"
        "\n"
        "sub two_sum {\n"
        "    my ($nums, $target) = @_;\n"
        "    my %seen;\n"
        "    for my $i (0 .. $#$nums) {\n"
        "        my $complement = $target - $nums->[$i];\n"
        "        if (exists $seen{$complement}) {\n"
        "            return [$seen{$complement}, $i];\n"
        "        }\n"
        "        $seen{ $nums->[$i] } = $i;\n"
        "    }\n"
        "    return [];\n"
        "}\n"
    ),
    "fizzbuzz": (
        "use strict;\n"
        "use warnings;\n"
        "\n"
        "sub fizzbuzz {\n"
        "    my ($n) = @_;\n"
        "    my @result;\n"
        "    return \\@result if $n <= 0;\n"
        "    for my $i (1 .. $n) {\n"
        "        if ($i % 15 == 0) { push @result, 'FizzBuzz'; }\n"
        "        elsif ($i % 3 == 0) { push @result, 'Fizz'; }\n"
        "        elsif ($i % 5 == 0) { push @result, 'Buzz'; }\n"
        '        else { push @result, "$i"; }\n'
        "    }\n"
        "    return \\@result;\n"
        "}\n"
    ),
    "valid_parentheses": (
        "use strict;\n"
        "use warnings;\n"
        "\n"
        "sub valid_parentheses {\n"
        "    my ($s) = @_;\n"
        "    my %pairs = (')' => '(', ']' => '[', '}' => '{');\n"
        "    my @stack;\n"
        "    for my $ch (split //, $s) {\n"
        "        if (exists $pairs{$ch}) {\n"
        "            return 0 unless @stack && pop(@stack) eq $pairs{$ch};\n"
        "        }\n"
        "        elsif ($ch eq '(' || $ch eq '[' || $ch eq '{') {\n"
        "            push @stack, $ch;\n"
        "        }\n"
        "    }\n"
        "    return @stack ? 0 : 1;\n"
        "}\n"
    ),
    "longest_common_prefix": (
        "use strict;\n"
        "use warnings;\n"
        "\n"
        "sub longest_common_prefix {\n"
        "    my ($strs) = @_;\n"
        "    return '' unless @$strs;\n"
        "    my $prefix = $strs->[0];\n"
        "    for my $i (1 .. $#$strs) {\n"
        "        while (index($strs->[$i], $prefix) != 0) {\n"
        "            $prefix = substr($prefix, 0, -1);\n"
        "            return '' if $prefix eq '';\n"
        "        }\n"
        "    }\n"
        "    return $prefix;\n"
        "}\n"
    ),
    "fibonacci": (
        "use strict;\n"
        "use warnings;\n"
        "\n"
        "sub fibonacci {\n"
        "    my ($n) = @_;\n"
        "    return [] if $n <= 0;\n"
        "    my @seq = (0);\n"
        "    return \\@seq if $n == 1;\n"
        "    push @seq, 1;\n"
        "    push @seq, $seq[-1] + $seq[-2] while @seq < $n;\n"
        "    return \\@seq;\n"
        "}\n"
    ),
}

# --- Lua ---------------------------------------------------------------------
_LUA_SOLUTIONS: dict[str, str] = {
    "two_sum": (
        "function two_sum(nums, target)\n"
        "    local seen = {}\n"
        "    for i, num in ipairs(nums) do\n"
        "        local complement = target - num\n"
        "        if seen[complement] ~= nil then\n"
        "            return { seen[complement], i - 1 }\n"
        "        end\n"
        "        seen[num] = i - 1\n"
        "    end\n"
        "    return {}\n"
        "end\n"
    ),
    "fizzbuzz": (
        "function fizzbuzz(n)\n"
        "    local result = {}\n"
        "    if n <= 0 then return result end\n"
        "    for i = 1, n do\n"
        "        if i % 15 == 0 then result[#result + 1] = 'FizzBuzz'\n"
        "        elseif i % 3 == 0 then result[#result + 1] = 'Fizz'\n"
        "        elseif i % 5 == 0 then result[#result + 1] = 'Buzz'\n"
        "        else result[#result + 1] = tostring(i) end\n"
        "    end\n"
        "    return result\n"
        "end\n"
    ),
    "valid_parentheses": (
        "function valid_parentheses(s)\n"
        "    local pairs = { [')'] = '(', [']'] = '[', ['}'] = '{' }\n"
        "    local stack = {}\n"
        "    for i = 1, #s do\n"
        "        local ch = s:sub(i, i)\n"
        "        if pairs[ch] then\n"
        "            if #stack == 0 or table.remove(stack) ~= pairs[ch] then\n"
        "                return false\n"
        "            end\n"
        "        elseif ch == '(' or ch == '[' or ch == '{' then\n"
        "            stack[#stack + 1] = ch\n"
        "        end\n"
        "    end\n"
        "    return #stack == 0\n"
        "end\n"
    ),
    "longest_common_prefix": (
        "function longest_common_prefix(strs)\n"
        "    if #strs == 0 then return '' end\n"
        "    local prefix = strs[1]\n"
        "    for i = 2, #strs do\n"
        "        while strs[i]:sub(1, #prefix) ~= prefix do\n"
        "            prefix = prefix:sub(1, -2)\n"
        "            if prefix == '' then return '' end\n"
        "        end\n"
        "    end\n"
        "    return prefix\n"
        "end\n"
    ),
    "fibonacci": (
        "function fibonacci(n)\n"
        "    local seq = {}\n"
        "    if n <= 0 then return seq end\n"
        "    seq[1] = 0\n"
        "    if n == 1 then return seq end\n"
        "    seq[2] = 1\n"
        "    while #seq < n do\n"
        "        seq[#seq + 1] = seq[#seq - 1] + seq[#seq]\n"
        "    end\n"
        "    return seq\n"
        "end\n"
    ),
}

# --- Kotlin ------------------------------------------------------------------
_KOTLIN_SOLUTIONS: dict[str, str] = {
    "two_sum": (
        "fun twoSum(nums: IntArray, target: Int): IntArray {\n"
        "    val seen = mutableMapOf<Int, Int>()\n"
        "    for (i in nums.indices) {\n"
        "        val complement = target - nums[i]\n"
        "        val j = seen[complement]\n"
        "        if (j != null) return intArrayOf(j, i)\n"
        "        seen[nums[i]] = i\n"
        "    }\n"
        "    return intArrayOf()\n"
        "}\n"
    ),
    "fizzbuzz": (
        "fun fizzbuzz(n: Int): List<String> {\n"
        "    if (n <= 0) return emptyList()\n"
        "    val result = mutableListOf<String>()\n"
        "    for (i in 1..n) {\n"
        '        if (i % 15 == 0) result.add("FizzBuzz")\n'
        '        else if (i % 3 == 0) result.add("Fizz")\n'
        '        else if (i % 5 == 0) result.add("Buzz")\n'
        "        else result.add(i.toString())\n"
        "    }\n"
        "    return result\n"
        "}\n"
    ),
    "valid_parentheses": (
        "fun validParentheses(s: String): Boolean {\n"
        "    val pairs = mapOf(')' to '(', ']' to '[', '}' to '{')\n"
        "    val stack = mutableListOf<Char>()\n"
        "    for (ch in s) {\n"
        "        val open = pairs[ch]\n"
        "        if (open != null) {\n"
        "            if (stack.isEmpty() || stack.removeAt(stack.lastIndex) != open) return false\n"
        "        } else if (ch == '(' || ch == '[' || ch == '{') {\n"
        "            stack.add(ch)\n"
        "        }\n"
        "    }\n"
        "    return stack.isEmpty()\n"
        "}\n"
    ),
    "longest_common_prefix": (
        "fun longestCommonPrefix(strs: Array<String>): String {\n"
        '    if (strs.isEmpty()) return ""\n'
        "    var prefix = strs[0]\n"
        "    for (i in 1 until strs.size) {\n"
        "        while (!strs[i].startsWith(prefix)) {\n"
        "            prefix = prefix.dropLast(1)\n"
        '            if (prefix.isEmpty()) return ""\n'
        "        }\n"
        "    }\n"
        "    return prefix\n"
        "}\n"
    ),
    "fibonacci": (
        "fun fibonacci(n: Int): List<Long> {\n"
        "    if (n <= 0) return emptyList()\n"
        "    val seq = mutableListOf(0L)\n"
        "    if (n == 1) return seq\n"
        "    seq.add(1L)\n"
        "    while (seq.size < n) seq.add(seq[seq.lastIndex] + seq[seq.lastIndex - 1])\n"
        "    return seq\n"
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
    "c": _C_SOLUTIONS,
    "cpp": _CPP_SOLUTIONS,
    "rust": _RUST_SOLUTIONS,
    "php": _PHP_SOLUTIONS,
    "ruby": _RUBY_SOLUTIONS,
    "perl": _PERL_SOLUTIONS,
    "lua": _LUA_SOLUTIONS,
    "kotlin": _KOTLIN_SOLUTIONS,
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
    "c": (
        "#include <stdlib.h>\n"
        "\n"
        "// Default fallback for unrecognized prompts.\n"
        "int* solution(int* nums, int nums_size, int* return_size) {\n"
        "    *return_size = 0;\n"
        "    return NULL;\n"
        "}\n"
    ),
    "cpp": (
        "#include <vector>\n"
        "\n"
        "// Default fallback for unrecognized prompts.\n"
        "std::vector<int> solution() {\n"
        "    return {};\n"
        "}\n"
    ),
    "rust": (
        "pub fn solution() -> i32 {\n    // Default fallback for unrecognized prompts.\n    0\n}\n"
    ),
    "php": (
        "<?php\n"
        "\n"
        "// Default fallback for unrecognized prompts.\n"
        "function solution(): int {\n"
        "    return 0;\n"
        "}\n"
    ),
    "ruby": ("# Default fallback for unrecognized prompts.\ndef solution\n  nil\nend\n"),
    "perl": (
        "use strict;\n"
        "use warnings;\n"
        "\n"
        "# Default fallback for unrecognized prompts.\n"
        "sub solution {\n"
        "    return undef;\n"
        "}\n"
    ),
    "lua": (
        "-- Default fallback for unrecognized prompts.\nfunction solution()\n    return nil\nend\n"
    ),
    "kotlin": ("// Default fallback for unrecognized prompts.\nfun solution(): Int = 0\n"),
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
    "validparentheses": "valid_parentheses",
    "longestcommonprefix": "longest_common_prefix",
    "fibonacci": "fibonacci",
    "palindrome": "palindrome",
    "trappingrainwater": "trapping_rain_water",
}


def normalize_prompt(prompt: str) -> str:
    """Lowercase prompt with all non-alphanumeric characters removed."""
    return re.sub(r"[^a-z0-9]", "", prompt.lower())


class MockProvider(LLMProvider):
    """Deterministic demo provider — no API key or network required."""

    name = "demo"

    def generate_code(
        self, prompt: str, language: str = "python", feedback: str | None = None
    ) -> str:
        self.validate_language(language)
        # `feedback` is accepted for interface parity and intentionally not
        # consulted: this provider is a deterministic keyword lookup, so a
        # repair attempt returns the same canned solution as attempt 1. That is
        # the honest demo behaviour — a repair loop against it exhausts its
        # budget and records each identical attempt, rather than pretending to
        # fix code. Matching also stays on the original prompt, which never
        # contains the appended failure output.
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
