import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CodeBlock, { DEFAULT_LINE_LIMIT, splitLogLines } from "./CodeBlock";
import styles from "./CodeBlock.module.css";
import { classifyLogLine } from "./logSeverity";

/** A representative pytest run: a passing test, a failing one, a traceback. */
const PYTEST_LOG = [
  "============================= test session starts ==============================",
  "collected 3 items",
  "",
  "tests/test_math.py::test_add PASSED                               [ 33%]",
  "tests/test_math.py::test_subtract FAILED                           [ 66%]",
  "tests/test_math.py::test_mul PASSED                               [100%]",
  "",
  "=================================== FAILURES ===================================",
  "_________________________________ test_subtract __________________________________",
  "",
  "    def test_subtract():",
  ">       assert subtract(3, 5) == -2",
  "E       assert -1 == -2",
  "E       +  where -1 = subtract(3, 5)",
  "",
  '  File "/app/tests/test_math.py", line 8, in test_subtract',
  "    subtract(3, 5)",
  "ZeroDivisionError: division by zero",
  "=========================== short test summary info ============================",
  "FAILED tests/test_math.py::test_subtract - assert -1 == -2",
  "========================= 1 failed, 2 passed in 0.42s ========================",
].join("\n");

function mockClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  return writeText;
}

describe("classifyLogLine", () => {
  it.each([
    ["tests/test_math.py::test_sub FAILED", "error"],
    ["=================================== FAILURES ===================================", "error"],
    ["FAILED tests/test_math.py::test_sub - assert -1 == -2", "error"],
    ["not ok 3 - should subtract", "error"],
    ["ZeroDivisionError: division by zero", "error"],
    [">       assert subtract(3, 5) == -2", "error"],
    ["WARNING: retries exhausted", "warning"],
    ["W  deprecation: use of imp", "warning"],
    ["tests/test_math.py::test_add PASSED", "success"],
    ["========================= 1 passed in 0.01s =========================", "success"],
    ["ok 4 - adds numbers", "success"],
    ['  File "/app/tests/test_math.py", line 8, in test_subtract', "trace"],
    ["    at Object.<anonymous> (/app/test.js:5:9)", "trace"],
    ["    main_test.go:12: want 3 got 4", "trace"],
    ["12:04:31 booting worker", "info"],
    ["collected 3 items", "info"],
    ["", "info"],
  ])("classifies %j as %s", (line, expected) => {
    expect(classifyLogLine(line)).toBe(expected);
  });

  it("reads the pytest summary as a failure, not as its passes", () => {
    // "1 failed, 2 passed" contains both tokens; error must win or the one
    // line a user scans for is the line that goes quiet.
    expect(classifyLogLine("1 failed, 2 passed in 0.42s")).toBe("error");
  });
});

describe("splitLogLines", () => {
  it("keeps interior blank lines but drops the trailing newline artifact", () => {
    expect(splitLogLines("a\n\nb\n")).toEqual(["a", "", "b"]);
  });

  it("returns nothing for empty output", () => {
    expect(splitLogLines("")).toEqual([]);
  });

  it("keeps a single meaningful blank line when the whole output is blank", () => {
    expect(splitLogLines("   ")).toEqual(["   "]);
  });
});

describe("CodeBlock (code mode)", () => {
  it("renders code with no gutter", () => {
    const { container } = render(<CodeBlock code="x = 1" filename="solution.py" />);
    expect(screen.getByText("x = 1")).toBeInTheDocument();
    expect(container.querySelectorAll(`.${styles.lineNumber}`)).toHaveLength(0);
  });

  it("names the language once, via the badge, using its display name", () => {
    // "language: python" read as machine output and the reader wanted a display
    // name; `languageMeta` owns the naming (issue #356). The plain-text label
    // stays "code" so the name is not printed twice.
    const { container } = render(<CodeBlock code="x = 1" language="python" />);
    const badge = container.querySelector('[title="Python · pytest"]');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain("Py");
    expect(screen.getByText("code")).toBeInTheDocument();
    expect(screen.queryByText(/language:/)).not.toBeInTheDocument();
  });

  it("pairs a filename with the language badge", () => {
    // ResultReport passes both. "solution.py · Py" is a useful pairing, because a
    // generated file's extension and the language it was actually evaluated as
    // can disagree, and the badge is the one that is authoritative.
    const { container } = render(
      <CodeBlock code="x = 1" language="python" filename="solution.py" />,
    );
    expect(screen.getByText("solution.py")).toBeInTheDocument();
    expect(container.querySelector('[title="Python · pytest"]')).not.toBeNull();
  });

  it("does not badge a prompt", () => {
    // ChallengeDetail renders the prompt through CodeBlock as language="text".
    // A language pill on English prose is a lie about what the surface is.
    const { container } = render(<CodeBlock code="Write two_sum." language="text" />);
    expect(container.querySelector('[class*="badge"]')).toBeNull();
  });

  it("does not badge an unknown language", () => {
    // An unrecognized value is catalog data that has drifted, not a language to
    // assert in the chrome.
    const { container } = render(<CodeBlock code="x = 1" language="brainfuck" />);
    expect(container.querySelector('[class*="badge"]')).toBeNull();
  });
});

describe("CodeBlock (syntax highlighting)", () => {
  it("colorizes keywords, strings, numbers and calls for real code", () => {
    const { container } = render(
      <CodeBlock code={'def solve(x):\n    return int(x) + 1  # go'} language="python" />,
    );
    const kinds = [...container.querySelectorAll("[data-token]")].map(
      (el) => el.getAttribute("data-token"),
    );
    expect(kinds).toContain("keyword");
    expect(kinds).toContain("comment");
    expect(container.querySelector('[data-token="keyword"]')?.textContent).toBe("def");
    expect(container.querySelector('[data-token="comment"]')?.textContent).toBe("# go");
  });

  it("renders code that the reader can copy verbatim", () => {
    // The spans are the whole point, so the invariant worth locking is that they
    // do not alter the text. If a token were dropped or reordered here, the user
    // would copy broken source out of an evaluation report.
    const code = 'def f():\n    """Doc."""\n    return 1  # ok\n';
    const { container } = render(<CodeBlock code={code} language="python" />);
    const pre = container.querySelector("pre")!;
    expect(pre.textContent).toBe(code);
  });

  it("renders an unknown language as plain text rather than guessing", () => {
    const { container } = render(<CodeBlock code="x = 1" language="brainfuck" />);
    expect(container.querySelectorAll("[data-token]")).toHaveLength(0);
    expect(container.querySelector("pre")?.textContent).toBe("x = 1");
  });

  it("renders a prompt as a single text node, not as tokens", () => {
    // "text" is prose. Tokenizing it would paint the first word of every
    // sentence as a keyword.
    const { container } = render(
      <CodeBlock code="Write a function two_sum(nums, target)." language="text" />,
    );
    expect(container.querySelectorAll("[data-token]")).toHaveLength(0);
    expect(screen.getByText("Write a function two_sum(nums, target).")).toBeInTheDocument();
  });

  it("does not syntax-color a log", () => {
    // Log lines are already classified by severity; a red FAILED line must not
    // also be tokenized, and traceback frames would color differently from the
    // prose around them.
    const { container } = render(<CodeBlock code={PYTEST_LOG} language="python" log />);
    expect(container.querySelectorAll("[data-token]")).toHaveLength(0);
  });

  it("keeps model-generated markup inert", () => {
    // Generated code is untrusted input. There is no HTML string anywhere in
    // the pipeline, so a paste of HTML has nothing to inject through.
    const { container } = render(
      <CodeBlock
        code={'<img src=x onerror="alert(1)">\n<script>alert(2)</script>'}
        language="html"
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("pre")?.textContent).toContain("<script>alert(2)</script>");
  });
});

describe("CodeBlock (log mode)", () => {
  it("numbers every line from 1, gutter excluded from the accessible tree", () => {
    const { container } = render(<CodeBlock code={"one\ntwo\nthree"} log />);
    const numbers = [...container.querySelectorAll(`.${styles.lineNumber}`)].map(
      (el) => el.textContent,
    );
    expect(numbers).toEqual(["1", "2", "3"]);
    for (const el of container.querySelectorAll(`.${styles.lineNumber}`)) {
      expect(el).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("tints failures red and passes green", () => {
    const { container } = render(<CodeBlock code={PYTEST_LOG} log />);
    const severityOf = (text: string) =>
      [...container.querySelectorAll(`.${styles.line}`)].find(
        (row) => row.querySelector(`.${styles.lineText}`)?.textContent === text,
      );

    const failed = severityOf("tests/test_math.py::test_subtract FAILED                           [ 66%]");
    expect(failed?.className).toContain(styles.lineError);
    expect(failed).toHaveAttribute("data-severity", "error");

    const passed = severityOf("tests/test_math.py::test_add PASSED                               [ 33%]");
    expect(passed?.className).toContain(styles.lineSuccess);

    // The traceback frame is context, not a new finding.
    const frame = severityOf('  File "/app/tests/test_math.py", line 8, in test_subtract');
    expect(frame?.className).toContain(styles.lineTrace);

    const neutral = severityOf("collected 3 items");
    expect(neutral?.className).not.toContain(styles.lineError);
    expect(neutral).toHaveAttribute("data-severity", "info");
  });

  it("does not number a log as a code surface without the log flag", () => {
    // Guards the regression the flag exists to prevent: severity tints leaking
    // onto prompts and generated source.
    const { container } = render(<CodeBlock code="FAILED tests/test_math.py" language="text" />);
    expect(container.querySelectorAll(`.${styles.lineError}`)).toHaveLength(0);
  });

  it("labels the header 'logs' when no filename is given", () => {
    render(<CodeBlock code="PASSED" log />);
    expect(screen.getByText("logs")).toBeInTheDocument();
  });

  it("copies the full output, not the capped view", async () => {
    const writeText = mockClipboard();
    const long = Array.from({ length: DEFAULT_LINE_LIMIT + 50 }, (_, i) => `line ${i + 1}`).join(
      "\n",
    );
    render(<CodeBlock code={long} log />);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(long);
    expect(await screen.findByText("Copied!")).toBeInTheDocument();
  });
});

describe("CodeBlock size cap", () => {
  function longLog(extra = 10) {
    return Array.from({ length: DEFAULT_LINE_LIMIT + extra }, (_, i) => `line ${i + 1}`).join("\n");
  }

  it("shows the first N lines and says how much is hidden", () => {
    const { container } = render(<CodeBlock code={longLog()} log />);
    expect(container.querySelectorAll(`.${styles.line}`)).toHaveLength(DEFAULT_LINE_LIMIT);
    expect(
      screen.getByText(`Showing ${DEFAULT_LINE_LIMIT} of ${DEFAULT_LINE_LIMIT + 10} lines`),
    ).toBeInTheDocument();
  });

  it("reveals the rest on request and can collapse again", () => {
    const total = DEFAULT_LINE_LIMIT + 10;
    const { container } = render(<CodeBlock code={longLog()} log />);

    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(container.querySelectorAll(`.${styles.line}`)).toHaveLength(total);
    expect(screen.getByText(`Showing ${total} of ${total} lines`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show less" }));
    expect(container.querySelectorAll(`.${styles.line}`)).toHaveLength(DEFAULT_LINE_LIMIT);
  });

  it("keeps the last line reachable after expanding", () => {
    const total = DEFAULT_LINE_LIMIT + 10;
    const { container } = render(<CodeBlock code={longLog()} log />);
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    const texts = [...container.querySelectorAll(`.${styles.lineText}`)];
    expect(texts[texts.length - 1]?.textContent).toBe(`line ${total}`);
  });

  it("adds no footer when the output already fits", () => {
    render(<CodeBlock code="PASSED\nFAILED" log />);
    expect(screen.queryByRole("button", { name: "Show all" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
  });

  it("does not hide a single line at the limit boundary", () => {
    const exact = Array.from({ length: DEFAULT_LINE_LIMIT }, (_, i) => `line ${i + 1}`).join("\n");
    const { container } = render(<CodeBlock code={exact} log />);
    expect(container.querySelectorAll(`.${styles.line}`)).toHaveLength(DEFAULT_LINE_LIMIT);
    expect(screen.queryByRole("button", { name: "Show all" })).not.toBeInTheDocument();
  });
});
