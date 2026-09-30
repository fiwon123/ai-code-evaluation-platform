/**
 * A small syntax highlighter for the code surfaces.
 *
 * Why this exists instead of a library: `logSeverity.ts` records the decision
 * that this app carries **zero runtime dependencies beyond React and the
 * router**, and colorizes by rule set rather than by tokenizer. Prism and
 * highlight.js are a permanent +15-50kB of grammar for the four token kinds
 * that matter on a code surface (comment, string, number, keyword); shiki is
 * a WASM TextMate engine and is an order of magnitude larger again. So this is
 * one engine and a table of per-language descriptors — the same shape as
 * `logSeverity.ts`, one level up.
 *
 * It is deliberately *lexical*, not a parser. That is enough to make a code
 * surface readable and it cannot get confused by real source, because it never
 * tries to understand the program: it only classifies the next run of
 * characters. The properties that makes safe to rely on:
 *
 *   1. **Lossless.** The token values concatenate back to the exact input
 *      (`assertLossless`). Every highlighter bug that matters is a dropped,
 *      duplicated or reordered character, and this property catches all three
 *      at once. `highlight()` is used to render source, so anything it loses is
 *      source the user cannot read or copy.
 *   2. **Total.** It never throws. Unknown input, unterminated strings, stray
 *      backslashes and lone surrogates all fall through to `plain`, so a
 *      malformed paste renders as text rather than blanking the block.
 *   3. **Injection-proof.** It returns `{ kind, value }` pairs and the component
 *      renders them as React text nodes. There is no HTML string anywhere, so
 *      no `dangerouslySetInnerHTML` and no way for code to become markup — which
 *      matters because every string here is model-generated and untrusted.
 *
 * Grammar families, not 20 bespoke engines: the C family shares comment and
 * string syntax, the `#` family shares its own, and Lua and Haskell differ
 * only in their sigils. Per-language work is a keyword set.
 */

import { LANGUAGES, type ChallengeLanguage } from "../../utils/language.ts";

export type TokenKind =
  | "plain"
  | "comment"
  | "string"
  | "number"
  | "keyword"
  | "type"
  | "function";

export interface Token {
  kind: TokenKind;
  value: string;
}

/** One language's lexical rules. */
interface Grammar {
  /** Sigils that comment out the rest of the line. */
  line: readonly string[];
  /** `[open, close]` pairs for block comments, longest opener first. */
  block?: readonly (readonly [string, string])[];
  /** Quote characters, longest first so a triple wins over a single. */
  quotes: readonly string[];
  /** Whether a backslash escapes the next character inside a string. */
  escapes: boolean;
  keywords: ReadonlySet<string>;
  /** Extra type words that are not conventionally capitalised. */
  types?: ReadonlySet<string>;
  /** Rust nests block comments; the others do not. */
  nestedBlock?: boolean;
}

const words = (...list: string[]): ReadonlySet<string> => new Set(list);

/**
 * The C family: `//` and slash-star comments, quoted strings with backslash
 * escapes.
 *
 * The keyword lists are the reserved words a reader would expect to be
 * highlighted, not an exhaustive language spec — a missing keyword costs one
 * uncolored word, while a wrong one would mislabel a variable named `match`.
 */
function cFamily(options: {
  keywords: readonly string[];
  types?: readonly string[];
    /* Rust nests block comments. */
    nestedBlock?: boolean;
  /** JavaScript/TypeScript template literals. */
  templates?: boolean;
  /** Java annotations and Objective-C `@selector` sit in the operator set. */
  quotes?: readonly string[];
}): Grammar {
  return {
    line: ["//"],
    block: [["/*", "*/"]],
    quotes: options.quotes ?? (options.templates ? ["`", '"', "'"] : ['"', "'"]),
    escapes: true,
    nestedBlock: options.nestedBlock,
    keywords: words(...options.keywords),
    types: options.types ? words(...options.types) : undefined,
  };
}

const GRAMMARS: Partial<Record<ChallengeLanguage, Grammar>> = {
  python: {
    line: ["#"],
    // Triple quotes first: a docstring opened with `"""` must not be read as
    // an empty string followed by a stray quote.
    quotes: ['"""', "'''", '"', "'"],
    escapes: true,
    keywords: words(
      "and", "as", "assert", "async", "await", "break", "class", "continue", "def",
      "del", "elif", "else", "except", "finally", "for", "from", "global", "if",
      "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise",
      "return", "try", "while", "with", "yield", "match", "case",
    ),
    types: words("True", "False", "None", "self", "cls", "int", "str", "float", "bool", "list", "dict", "set", "tuple"),
  },
  javascript: cFamily({
    templates: true,
    keywords: [
      "async", "await", "break", "case", "catch", "class", "const", "continue",
      "debugger", "default", "delete", "do", "else", "export", "extends",
      "finally", "for", "function", "if", "import", "in", "instanceof", "let",
      "new", "of", "return", "static", "super", "switch", "this", "throw",
      "try", "typeof", "var", "void", "while", "with", "yield", "true", "false",
      "null", "undefined",
    ],
    types: ["Array", "Object", "String", "Number", "Boolean", "Promise", "Map", "Set"],
  }),
  typescript: cFamily({
    templates: true,
    keywords: [
      "abstract", "any", "as", "async", "await", "break", "case", "catch",
      "class", "const", "continue", "declare", "default", "delete", "do", "else",
      "enum", "export", "extends", "finally", "for", "from", "function", "if",
      "implements", "import", "in", "instanceof", "interface", "is", "keyof",
      "let", "namespace", "new", "of", "private", "protected", "public",
      "readonly", "return", "satisfies", "static", "super", "switch", "this",
      "throw", "try", "type", "typeof", "var", "void", "while", "yield",
      "true", "false", "null", "undefined",
    ],
    types: ["string", "number", "boolean", "unknown", "never", "any", "void", "Array", "Promise", "Record"],
  }),
  java: cFamily({
    keywords: [
      "abstract", "assert", "break", "case", "catch", "class", "const",
      "continue", "default", "do", "else", "enum", "extends", "final",
      "finally", "for", "goto", "if", "implements", "import", "instanceof",
      "interface", "native", "new", "package", "private", "protected", "public",
      "record", "return", "sealed", "static", "strictfp", "super", "switch",
      "synchronized", "this", "throw", "throws", "transient", "try", "var",
      "volatile", "while", "true", "false", "null",
    ],
    types: ["int", "long", "double", "float", "boolean", "char", "byte", "short", "String", "Integer", "Double", "Boolean", "Object", "List", "Map", "Set"],
  }),
  csharp: cFamily({
    keywords: [
      "abstract", "as", "async", "await", "base", "break", "case", "catch",
      "checked", "class", "const", "continue", "default", "delegate", "do",
      "else", "enum", "event", "explicit", "extern", "finally", "fixed",
      "for", "foreach", "get", "goto", "if", "implicit", "in", "interface",
      "internal", "is", "lock", "namespace", "new", "operator", "out",
      "override", "params", "private", "protected", "public", "readonly",
      "record", "ref", "return", "sealed", "set", "sizeof", "stackalloc",
      "static", "struct", "switch", "this", "throw", "try", "typeof",
      "unchecked", "unsafe", "using", "var", "virtual", "void", "volatile",
      "while", "true", "false", "null",
    ],
    types: ["int", "long", "double", "float", "decimal", "bool", "char", "byte", "short", "string", "object", "var", "dynamic", "List", "Dictionary", "Task", "IEnumerable"],
  }),
  go: cFamily({
    quotes: ['"', "`", "'"],
    keywords: [
      "break", "case", "chan", "const", "continue", "default", "defer", "else",
      "fallthrough", "for", "func", "go", "goto", "if", "import", "interface",
      "map", "package", "range", "return", "select", "struct", "switch", "type",
      "var", "true", "false", "nil",
    ],
    types: ["bool", "byte", "complex64", "complex128", "error", "float32", "float64", "int", "int8", "int16", "int32", "int64", "rune", "string", "uint", "uint8", "uint16", "uint32", "uint64", "uintptr", "any"],
  }),
  rust: cFamily({
    nestedBlock: true,
    keywords: [
      "as", "async", "await", "break", "const", "continue", "crate", "dyn",
      "else", "enum", "extern", "fn", "for", "if", "impl", "in", "let", "loop",
      "match", "mod", "move", "mut", "pub", "ref", "return", "self", "Self",
      "static", "struct", "super", "trait", "type", "unsafe", "use", "where",
      "while", "true", "false", "box",
    ],
    types: ["bool", "char", "f32", "f64", "i8", "i16", "i32", "i64", "i128", "isize", "str", "u8", "u16", "u32", "u64", "u128", "usize", "String", "Vec", "Option", "Result", "Box"],
  }),
  c: cFamily({
    keywords: [
      "auto", "break", "case", "const", "continue", "default", "do", "else",
      "enum", "extern", "for", "goto", "if", "inline", "register",
      "restrict", "return", "sizeof", "static", "struct", "switch", "typedef",
      "union", "volatile", "while", "_Bool", "_Static_assert",
    ],
    types: ["char", "double", "float", "int", "long", "short", "signed", "unsigned", "void", "size_t", "bool", "FILE", "NULL"],
  }),
  cpp: cFamily({
    keywords: [
      "alignas", "alignof", "auto", "break", "case", "catch", "class", "const",
      "constexpr", "const_cast", "continue", "decltype", "default", "delete",
      "do", "dynamic_cast", "else", "enum", "explicit", "export", "extern",
      "for", "friend", "goto", "if", "inline", "mutable", "namespace", "new",
      "noexcept", "nullptr", "operator", "private", "protected", "public",
      "register", "reinterpret_cast", "return", "short", "signed", "sizeof",
      "static", "static_assert", "static_cast", "struct", "switch", "template",
      "this", "throw", "try", "typedef", "typeid", "typename", "union",
      "unsigned", "using", "virtual", "void", "volatile", "while",
      "true", "false",
    ],
    types: ["bool", "char", "double", "float", "int", "long", "wchar_t", "string", "vector", "map", "set", "size_t", "auto_ptr", "unique_ptr", "shared_ptr"],
  }),
  php: cFamily({
    keywords: [
      "abstract", "and", "array", "as", "break", "callable", "case", "catch",
      "class", "clone", "const", "continue", "declare", "default", "do", "echo",
      "else", "elseif", "empty", "enddeclare", "endfor", "endforeach", "endif",
      "endswitch", "endwhile", "enum", "extends", "final", "finally", "fn",
      "for", "foreach", "function", "global", "goto", "if", "implements",
      "include", "include_once", "instanceof", "insteadof", "interface",
      "isset", "list", "match", "namespace", "new", "or", "print", "private",
      "protected", "public", "readonly", "require", "require_once", "return",
      "static", "switch", "throw", "trait", "try", "unset", "use", "var",
      "while", "xor", "yield", "true", "false", "null", "int", "string",
      "bool", "float", "void", "iterable", "object", "mixed", "never",
    ],
  }),
  kotlin: cFamily({
    keywords: [
      "as", "break", "by", "catch", "class", "companion", "const", "continue",
      "crossinline", "data", "do", "else", "enum", "external", "false", "final",
      "finally", "for", "fun", "get", "if", "import", "in", "infix", "init",
      "inline", "inner", "interface", "internal", "is", "lateinit", "noinline",
      "object", "open", "operator", "out", "override", "package", "private",
      "protected", "public", "reified", "return", "sealed", "set", "super",
      "suspend", "this", "throw", "try", "typealias", "val", "var", "vararg",
      "when", "where", "while", "null", "true",
    ],
    types: ["Int", "Long", "Short", "Byte", "Double", "Float", "Boolean", "Char", "String", "Unit", "Any", "List", "Map", "Set", "Array"],
  }),
  swift: cFamily({
    keywords: [
      "associatedtype", "class", "deinit", "enum", "extension", "fileprivate",
      "func", "import", "init", "inout", "internal", "let", "open", "operator",
      "private", "protocol", "public", "rethrows", "static", "struct",
      "subscript", "typealias", "var", "break", "case", "continue", "default",
      "defer", "do", "else", "fallthrough", "for", "guard", "if", "in",
      "repeat", "return", "switch", "where", "while", "as", "catch", "is",
      "super", "self", "nil", "true", "false", "throws", "try", "async", "await",
    ],
    types: ["Int", "Double", "Float", "Bool", "Character", "String", "Array", "Dictionary", "Set", "Optional", "Any", "AnyObject"],
  }),
  dart: cFamily({
    keywords: [
      "abstract", "as", "assert", "async", "await", "break", "case", "catch",
      "class", "const", "continue", "covariant", "default", "deferred", "do",
      "dynamic", "else", "enum", "export", "extends", "extension", "external",
      "factory", "final", "finally", "for", "get", "hide", "if", "implements",
      "import", "in", "is", "late", "library", "mixin", "new", "on", "operator",
      "part", "required", "rethrow", "return", "set", "show", "static",
      "super", "switch", "sync", "this", "throw", "try", "typedef", "var",
      "while", "with", "yield", "true", "false", "null",
    ],
    types: ["int", "double", "num", "bool", "String", "List", "Map", "Set", "Future", "Stream", "void", "Object"],
  }),
  scala: cFamily({
    keywords: [
      "abstract", "case", "catch", "class", "def", "do", "else", "extends",
      "false", "final", "finally", "for", "forSome", "if", "implicit", "import",
      "lazy", "match", "new", "null", "object", "override", "package",
      "private", "protected", "return", "sealed", "super", "then", "this",
      "throw", "trait", "try", "true", "type", "val", "var", "while", "with",
      "yield", "given", "using", "enum", "export", "extension", "inline",
      "opaque",
    ],
    types: ["Int", "Long", "Double", "Float", "Boolean", "Char", "String", "Unit", "Any", "AnyRef", "List", "Seq", "Map", "Option", "Either"],
  }),
  "objective-c": cFamily({
    keywords: [
      "auto", "break", "case", "char", "const", "continue", "default", "do",
      "double", "else", "enum", "extern", "float", "for", "goto", "if",
      "inline", "int", "long", "register", "restrict", "return", "short",
      "signed", "sizeof", "static", "struct", "switch", "typedef", "union",
      "unsigned", "void", "volatile", "while", "in", "out", "inout", "bycopy",
      "byref", "oneway", "self", "super", "nil", "YES", "NO", "id", "BOOL",
    ],
    types: ["NSString", "NSArray", "NSDictionary", "NSInteger", "CGFloat", "instancetype", "Class", "SEL", "IMP"],
  }),
  ruby: {
    line: ["#"],
    quotes: ['"', "'"],
    // No `%w[]` or `//regex` handling: both are rare enough in evaluation
    // solutions that a mis-lexed one costs more than the colour would earn.
    escapes: true,
    keywords: words(
      "alias", "and", "begin", "break", "case", "class", "def", "defined?",
      "do", "else", "elsif", "end", "ensure", "for", "if", "in", "module",
      "next", "not", "or", "redo", "rescue", "retry", "return", "self", "super",
      "then", "undef", "unless", "until", "when", "while", "yield", "require",
      "require_relative", "attr_accessor", "attr_reader", "attr_writer",
      "true", "false", "nil", "lambda", "proc",
    ),
    types: words("Integer", "Float", "String", "Array", "Hash", "Symbol", "true", "false", "nil"),
  },
  perl: {
    line: ["#"],
    quotes: ['"', "'"],
    escapes: true,
    keywords: words(
      "and", "bless", "break", "continue", "do", "else", "elsif", "eq", "exp",
      "for", "foreach", "ge", "gt", "if", "le", "lt", "my", "ne", "next",
      "no", "not", "or", "our", "package", "redo", "ref", "return", "sub",
      "unless", "until", "use", "wantarray", "while", "local", "defined",
    ),
    types: words("qw", "undef", "print", "die", "warn", "scalar", "keys", "values"),
  },
  lua: {
    line: ["--"],
    // `[[long strings]]` before the quoted forms, and `--[[block comments]]`
    // falls out of the line rule above it.
    block: [["--[[", "]]"]],
    quotes: ["[[", '"', "'"],
    escapes: true,
    keywords: words(
      "and", "break", "do", "else", "elseif", "end", "false", "for", "function",
      "goto", "if", "in", "local", "nil", "not", "or", "repeat", "return",
      "then", "true", "until", "while", "self",
    ),
    types: words("string", "table", "number", "boolean", "pcall", "print", "pairs", "ipairs", "require"),
  },
  haskell: {
    line: ["--"],
    block: [["{-", "-}"]],
    quotes: ['"'],
    escapes: true,
    keywords: words(
      "case", "class", "data", "default", "deriving", "do", "else", "foreign",
      "if", "import", "in", "infix", "infixl", "infixr", "instance", "let",
      "module", "newtype", "of", "then", "type", "where",
    ),
    types: words("Int", "Integer", "Double", "Float", "Bool", "Char", "String", "Maybe", "Either", "IO", "undefined", "True", "False", "Just", "Nothing", "Left", "Right"),
  },
  r: {
    line: ["#"],
    quotes: ['"', "'"],
    escapes: true,
    keywords: words(
      "break", "else", "for", "function", "if", "in", "next", "repeat",
      "return", "while", "TRUE", "FALSE", "NULL", "NA", "Inf", "library",
      "require",
    ),
    types: words("numeric", "character", "logical", "list", "vector", "matrix", "data.frame", "length", "print", "paste0", "sapply", "vapply"),
  },
};

/** Catalog membership, as a set, for an O(1) "is this highlightable" check. */
const CATALOG: ReadonlySet<string> = new Set(LANGUAGES);

/**
 * Whether `language` gets tokenized at all.
 *
 * `text` is the important exclusion: `ChallengeDetail` and `Demo` both render
 * the challenge *prompt* through `CodeBlock` with `language="text"`, and a
 * prompt is English prose. Tokenizing it would paint the first word of every
 * sentence as a keyword. An absent or unknown language is left plain for the
 * same reason — a wrong guess is worse than no colour.
 */
export function isHighlightable(language: string | null | undefined): boolean {
  return Boolean(language) && language !== "text" && CATALOG.has(language!);
}

/** Numbers: hex/binary/octal, decimals with exponents, digit separators. */
const NUMBER = /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?)[a-zA-Z_]*/;

/** An identifier, including `$`/`_` sigils and trailing digits. */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*/;

function isUpperCaseStart(word: string): boolean {
  const first = word[0]!;
  return first >= "A" && first <= "Z";
}

/**
 * Tokenize `code`. Returns `null` for a language with no grammar, which the
 * component renders as a single plain text node — that is what keeps
 * `getByText` working for prompts and keeps the no-language case byte-for-byte
 * what it was before highlighting existed.
 */
export function highlight(code: string, language: string | null | undefined): Token[] | null {
  if (!isHighlightable(language)) return null;
  const grammar = GRAMMARS[language as ChallengeLanguage];
  // `isHighlightable` and this lookup agree because both key off LANGUAGES; the
  // guard is here so a catalog entry without a grammar degrades to plain text
  // rather than throwing on `grammar.line`.
  if (!grammar) return null;

  const tokens: Token[] = [];

  /** Line and block comment openers, longest first so `--[[` beats `--`. */
  const COMMENT_SIGILS = [
    ...grammar.line.map((sigil) => ({ text: sigil, length: sigil.length, close: null })),
    ...(grammar.block ?? []).map(([open, close]) => ({
      text: open,
      length: open.length,
      close,
    })),
  ].sort((a, b) => b.length - a.length);
  const push = (kind: TokenKind, value: string): void => {
    if (value === "") return;
    const last = tokens[tokens.length - 1];
    // Merging keeps the DOM small on real source, where consecutive plain
    // characters (`) {`, `);`) would otherwise each become their own span.
    if (last && last.kind === kind) last.value += value;
    else tokens.push({ kind, value });
  };

  let i = 0;
  const at = (index: number): string | undefined => code[index];

  /**
   * The comment sigil starting at `at`, longest match first, or null.
   *
   * `close === null` means a line comment (runs to the newline); otherwise it is
   * the block terminator. Precomputing the sigils once keeps the operator-run
   * loop below from rebuilding the list per character.
   */
  const commentAt = (at: number): { sigil: string; length: number; close: string | null } | null => {
    let best: { sigil: string; length: number; close: string | null } | null = null;
    for (const sigil of COMMENT_SIGILS) {
      if (sigil.length > (best?.length ?? 0) && code.startsWith(sigil.text, at)) {
        best = { sigil: sigil.text, length: sigil.length, close: sigil.close };
      }
    }
    return best;
  };

  while (i < code.length) {
    const ch = code[i]!;

    // Whitespace run — plain, and grouped so indentation does not become a
    // dozen spans per line.
    if (/\s/.test(ch)) {
      const start = i;
      while (i < code.length && /\s/.test(code[i]!)) i += 1;
      push("plain", code.slice(start, i));
      continue;
    }

    // Comments, before anything that could eat their first character as an
    // operator: `//` starts with `/`, `--` with `-`, `#` with nothing.
    //
    // Longest sigil wins, which is what makes Lua's `--[[ block ]]` a block
    // rather than a `--` line comment that swallows the rest of the line. The
    // two are not separable by rule here — only by length.
    const comment = commentAt(i);
    if (comment) {
      const start = i;
      if (comment.close === null) {
        const end = code.indexOf("\n", i);
        const stop = end === -1 ? code.length : end;
        push("comment", code.slice(i, stop));
        i = stop;
        continue;
      }
      i += comment.length;
      let depth = 1;
      while (i < code.length) {
        if (grammar.nestedBlock && code.startsWith(comment.sigil, i)) {
          depth += 1;
          i += comment.length;
          continue;
        }
        if (code.startsWith(comment.close, i)) {
          depth -= 1;
          i += comment.close.length;
          if (depth === 0) break;
          continue;
        }
        i += 1;
      }
      push("comment", code.slice(start, i));
      continue;
    }

    // Strings, longest sigil first so `"""` beats `"`.
    const quote = grammar.quotes.find((q) => code.startsWith(q, i));
    if (quote) {
      const start = i;
      i += quote.length;
      while (i < code.length) {
        if (grammar.escapes && code[i] === "\\") {
          // Skip the escaped character, including a trailing backslash at the
          // very end of input.
          i += 2;
          continue;
        }
        if (code.startsWith(quote, i)) {
          i += quote.length;
          break;
        }
        i += 1;
      }
      // An unterminated string stops at end of input rather than swallowing the
      // rest of the file; the block still renders the text it has.
      push("string", code.slice(start, Math.min(i, code.length)));
      continue;
    }

    if (/[0-9]/.test(ch) && !/[A-Za-z0-9_$]/.test(at(i - 1) ?? " ")) {
      const match = NUMBER.exec(code.slice(i));
      if (match) {
        push("number", match[0]);
        i += match[0].length;
        continue;
      }
    }

    const identifier = IDENTIFIER.exec(code.slice(i));
    if (identifier) {
      const word = identifier[0];
      let kind: TokenKind = "plain";
      if (grammar.keywords.has(word)) kind = "keyword";
      else if (grammar.types?.has(word) || isUpperCaseStart(word)) kind = "type";
      // A call, not a reference: the parenthesis must be *immediately* next.
      // Allowing whitespace would turn
      //     foo = bar
      //     (baz)
      // into a call to `bar`.
      else if (code[i + word.length] === "(") kind = "function";
      push(kind, word);
      i += word.length;
      continue;
    }

    // Everything else — operators, punctuation, braces — is grouped into one
    // run. Colouring punctuation adds a token class per character and no
    // information a reader of code is missing.
    const start = i;
    while (
      i < code.length &&
      !/\s/.test(code[i]!) &&
      commentAt(i) === null &&
      !grammar.quotes.some((q) => code.startsWith(q, i)) &&
      !/[\dA-Za-z_$]/.test(code[i]!)
    ) {
      i += 1;
    }
    // Always advances: if the loop above matched nothing the current character
    // is emitted as a single plain token.
    push("plain", code.slice(start, Math.max(i, start + 1)));
    i = Math.max(i, start + 1);
  }

  return tokens;
}

/** Every token kind that gets its own colour, in CSS-class order. */
export const HIGHLIGHT_KINDS: readonly TokenKind[] = [
  "comment",
  "string",
  "number",
  "keyword",
  "type",
  "function",
];
