import { describe, expect, it } from "vitest";
import { LANGUAGES } from "../../utils/language.ts";
import {
  HIGHLIGHT_KINDS,
  highlight,
  isHighlightable,
  type Token,
  type TokenKind,
} from "./highlight";

/** Reassemble a token stream; must equal the input byte for byte. */
function reassemble(tokens: Token[]): string {
  return tokens.map((token) => token.value).join("");
}

/** Token kinds present in a stream, excluding `plain`. */
function kinds(tokens: Token[] | null): TokenKind[] {
  return [...new Set((tokens ?? []).map((t) => t.kind).filter((k) => k !== "plain"))];
}

/** The first token of a given kind, for asserting on what was classified. */
function firstOf(tokens: Token[] | null, kind: TokenKind): string | undefined {
  return tokens?.find((t) => t.kind === kind)?.value;
}

describe("isHighlightable", () => {
  it("accepts every language in the catalog", () => {
    // The issue asks for the whole catalog, so a language added to
    // utils/language.ts must be highlightable without a second edit here.
    for (const language of LANGUAGES) {
      expect(isHighlightable(language), `${language} should highlight`).toBe(true);
    }
  });

  it("leaves prose and unknown values alone", () => {
    // "text" is how both the prompt (ChallengeDetail, Demo) renders. Coloring
    // English prose would paint the first word of every sentence as a keyword.
    expect(isHighlightable("text")).toBe(false);
    expect(isHighlightable("")).toBe(false);
    expect(isHighlightable(undefined)).toBe(false);
    expect(isHighlightable(null)).toBe(false);
    // A wrong guess is worse than no color.
    expect(isHighlightable("brainfuck")).toBe(false);
  });
});

describe("highlight returns no tokens for non-code", () => {
  it.each(["text", "", "not-a-language", "Text"])("passes %j through untouched", (language) => {
    // null means "render as a single text node" — which is what keeps prompts
    // byte-for-byte what they were before highlighting existed.
    expect(highlight("Some prompt text.", language)).toBeNull();
  });
});

describe("highlight is lossless", () => {
  const SAMPLES: [string, string][] = [
    ["python", 'def solve(nums):\n    """Docstring with "quotes" inside."""\n    return sum(nums)  # trailing\n'],
    ["javascript", "const f = (x) => `tpl ${x}`; // comment\n/* block\n   comment */\n"],
    ["typescript", "interface A<T> { readonly x: number }\nexport const y = x as unknown as T;\n"],
    ["java", "public class Solution {\n    @Override\n    public int f() { return 0x1F; }\n}\n"],
    ["go", "package main\n\nfunc Solve(i int) (int, error) {\n\treturn i, nil\n}\n"],
    ["rust", "fn main() { /* nested /* inner */ still */ let x = 1u8; }\n"],
    ["c", "#include <stdio.h>\nint main(void) { printf(\"hi\\n\"); return 0; }\n"],
    ["cpp", "template <typename T>\nclass A : public B { public: T f() { return {}; } };\n"],
    ["csharp", "public class A { public async Task<int> F() => await G(); }\n"],
    ["ruby", "def f(x)\n  x.times { |i| puts \"#{i}\" } # loop\nend\n"],
    ["perl", "my $x = 1; if ($x) { print \"hi\\n\"; } # done\n"],
    ["lua", "local function f()\n  return 1 -- note\nend\n"],
    ["haskell", "module M where\nf :: Int -> Int\nf x = x + 1 -- inc\n"],
    ["r", "f <- function(x) {\n  x + 1  # inc\n}\n"],
    ["kotlin", "fun f(x: Int): Int { return x as Int }\n"],
    ["swift", "func f(_ x: Int) -> Int { return x + 1 }\n"],
    ["dart", "int f(int x) async => x + 1;\n"],
    ["scala", "case class A(x: Int) extends B { def f: Int = x }\n"],
    ["php", "<?php\nfunction f($x) { return $x + 1; } // inc\n"],
    ["objective-c", "@implementation A\n- (void)f:(int)x { NSLog(@\"%d\", x); } @end\n"],
  ];

  it.each(SAMPLES)("%s: every character survives tokenization", (language, code) => {
    const tokens = highlight(code, language);
    expect(tokens).not.toBeNull();
    expect(reassemble(tokens!)).toBe(code);
  });

  it("survives a trailing backslash inside an unterminated string", () => {
    // The escape-skip advances by two; at end of input that overshoots, and a
    // naive slice would silently drop the backslash.
    const code = 'x = "abc\\';
    expect(reassemble(highlight(code, "python")!)).toBe(code);
  });

  it("survives a lone surrogate and a null byte", () => {
    for (const code of ["x = '\ud800'", "x = 1\u0000// c"]) {
      expect(reassemble(highlight(code, "python")!)).toBe(code);
    }
  });

  it("keeps an unterminated block comment from swallowing past the text", () => {
    const code = "a\n/* never closed";
    const tokens = highlight(code, "c")!;
    expect(reassemble(tokens)).toBe(code);
    // The comment runs to the end of input, but the code above it kept its own
    // token rather than the whole file collapsing into one comment.
    expect(firstOf(tokens, "comment")).toBe("/* never closed");
    // "a" and its trailing newline merge into one plain run, but the newline
    // still terminates the comment rather than being absorbed by it.
    expect(tokens.map((t) => t.value)).toEqual(["a\n", "/* never closed"]);
  });
});

describe("per-language tokenization", () => {
  it("reads Python triple-quoted docstrings as one string, not two empty ones", () => {
    const tokens = highlight('x = """a docstring"""', "python")!;
    expect(firstOf(tokens, "string")).toBe('"""a docstring"""');
  });

  it("does not treat a # inside a string as a comment", () => {
    const tokens = highlight('url = "https://x/y#frag"  # real comment', "python")!;
    const comments = tokens.filter((t) => t.kind === "comment");
    expect(comments).toHaveLength(1);
    expect(comments[0]!.value.trim()).toBe("# real comment");
    expect(reassemble(tokens)).toBe('url = "https://x/y#frag"  # real comment');
  });

  it("does not treat a // inside a string as a comment", () => {
    const tokens = highlight('const u = "https://x"; // note', "javascript")!;
    expect(tokens.filter((t) => t.kind === "comment")).toHaveLength(1);
    expect(firstOf(tokens, "string")).toBe('"https://x"');
  });

  it("pairs nested Rust block comments", () => {
    const code = "/* a /* b */ c */ x";
    const tokens = highlight(code, "rust")!;
    expect(tokens.filter((t) => t.kind === "comment")).toHaveLength(1);
    expect(firstOf(tokens, "comment")).toBe("/* a /* b */ c */");
  });

  it("pairs C block comments without nesting", () => {
    const tokens = highlight("/* one */ /* two */", "c")!;
    expect(tokens.filter((t) => t.kind === "comment")).toHaveLength(2);
  });

  it("handles the -- comment sigil in both Lua and Haskell", () => {
    for (const language of ["lua", "haskell"]) {
      const tokens = highlight("x -- note", language)!;
      expect(firstOf(tokens, "comment"), language).toBe("-- note");
    }
  });

  it("handles Lua --[[ block comments ]] ahead of its line rule", () => {
    const tokens = highlight("x = 1 --[[ note ]] y = 2", "lua")!;
    expect(firstOf(tokens, "comment")).toBe("--[[ note ]]");
  });

  it("does not read a Haskell operator as a comment", () => {
    // `-->` is not `--`; a `startsWith` check without care would eat it.
    const code = "f x = x --> 1";
    expect(reassemble(highlight(code, "haskell")!)).toBe(code);
  });

  it("reads Go rune literals and backtick strings", () => {
    const tokens = highlight("c := 'x'\ns := `raw`\n", "go")!;
    expect(tokens.filter((t) => t.kind === "string").map((t) => t.value)).toEqual(["'x'", "`raw`"]);
  });

  it("reads hex, exponent and separator numbers", () => {
    for (const [language, value] of [
      ["c", "0x1F"],
      ["python", "0b1010"],
      ["rust", "1_000_000"],
      ["javascript", "1e-9"],
    ] as const) {
      expect(firstOf(highlight(`x = ${value};`, language), "number"), language).toBe(value);
    }
  });

  it("does not read the digits inside an identifier as a number", () => {
    const tokens = highlight("utf8Encode = 1", "javascript")!;
    expect(tokens[0]!.kind).toBe("plain");
    expect(firstOf(tokens, "number")).toBe("1");
  });

  it("colours a call but not a bare reference", () => {
    const tokens = highlight("a = f\nb = f(1)", "python")!;
    // Exactly one call, so the reference on the previous line stayed plain.
    expect(tokens.filter((t) => t.kind === "function").map((t) => t.value)).toEqual(["f"]);
  });

  it("does not treat a newlined-open paren as a call", () => {
    // `bar` followed by `(` on the next line is a tuple, not an invocation.
    const tokens = highlight("foo = bar\n(x)\n", "python")!;
    expect(tokens.filter((t) => t.kind === "function")).toHaveLength(0);
  });

  it("colours conventional type names and known type keywords", () => {
    const tokens = highlight("class Solution { int x; }", "java")!;
    expect(tokens.filter((t) => t.kind === "type").map((t) => t.value)).toEqual([
      "Solution",
      "int",
    ]);
  });

  it("colours a lowercase builtin type in Python", () => {
    const tokens = highlight("x: list = []", "python")!;
    expect(firstOf(tokens, "type")).toBe("list");
  });

  it("respects case: Go's true is a keyword, C's TRUE is not", () => {
    expect(kinds(highlight("true", "go"))).toContain("keyword");
    expect(kinds(highlight("TRUE", "c"))).not.toContain("keyword");
  });

  it("keeps an escaped quote inside a string", () => {
    const tokens = highlight('s = "a\\"b" ; x = 1', "python")!;
    expect(firstOf(tokens, "string")).toBe('"a\\"b"');
    // The `; x = 1` after the closing quote is still code, not string.
    expect(tokens.some((t) => t.kind === "number" && t.value === "1")).toBe(true);
  });

  it("merges adjacent tokens of the same kind", () => {
    // 12 characters in, but the plain run collapses to a single token instead of
    // becoming one span per character. The DOM has to stay proportional to the
    // number of *runs*, or a 300-line block costs thousands of nodes.
    const tokens = highlight("x    =    1", "python")!;
    expect(tokens).toEqual([
      { kind: "plain", value: "x    =    " },
      { kind: "number", value: "1" },
    ]);
    // No two adjacent tokens share a kind — merging is doing its job.
    for (let i = 1; i < tokens.length; i += 1) {
      expect(tokens[i]!.kind).not.toBe(tokens[i - 1]!.kind);
    }
  });

  it("keeps a long whitespace run to one token", () => {
    const tokens = highlight("a\n\n    b", "python")!;
    expect(tokens.filter((t) => /\s/.test(t.value))).toHaveLength(1);
  });
});

describe("HIGHLIGHT_KINDS", () => {
  it("matches the kinds the CSS actually styles", () => {
    // If someone adds a token kind to the highlighter but not the stylesheet,
    // the token renders in the default code colour and the feature looks half
    // done. This is the cheapest place to notice.
    expect([...HIGHLIGHT_KINDS].sort()).toEqual(
      ["comment", "function", "keyword", "number", "string", "type"].sort(),
    );
  });

  it("excludes plain, which is styled by inheritance", () => {
    expect(HIGHLIGHT_KINDS).not.toContain("plain");
  });
});
