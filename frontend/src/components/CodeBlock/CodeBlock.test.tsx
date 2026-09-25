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

describe("CodeBlock (code mode, unchanged)", () => {
  it("renders code with no gutter", () => {
    const { container } = render(<CodeBlock code="x = 1" filename="solution.py" />);
    expect(screen.getByText("x = 1")).toBeInTheDocument();
    expect(container.querySelectorAll(`.${styles.lineNumber}`)).toHaveLength(0);
  });

  it("labels the header with the language", () => {
    render(<CodeBlock code="x = 1" language="python" />);
    expect(screen.getByText("language: python")).toBeInTheDocument();
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
