import { describe, expect, it } from "vitest";
import {
  DISPLAY_ONLY_LANGUAGES,
  EXECUTABLE_LANGUAGES,
  LANGUAGES,
  LANGUAGE_EXAMPLES,
  LANGUAGE_RUNNERS,
  evaluationEstimate,
  examplesForLanguage,
  languageGuide,
  languageLabel,
  languageMeta,
  runnerForLanguage,
} from "./language.ts";

describe("language catalog", () => {
  it("covers 20 catalog languages in a stable order", () => {
    expect(LANGUAGES).toEqual([
      "python", "javascript", "typescript", "java", "go",
      "c", "cpp", "rust", "php", "ruby", "perl", "kotlin", "lua",
      "csharp", "swift", "dart", "scala", "r", "haskell", "objective-c",
    ]);
  });

  it("splits 13 executable from 7 display-only languages", () => {
    expect(EXECUTABLE_LANGUAGES).toHaveLength(13);
    expect(DISPLAY_ONLY_LANGUAGES).toHaveLength(7);
    const union = new Set([...EXECUTABLE_LANGUAGES, ...DISPLAY_ONLY_LANGUAGES]);
    expect(union.size).toBe(20);
  });

  it("uses display names for awkward language keys", () => {
    expect(languageLabel("cpp")).toBe("C++");
    expect(languageLabel("csharp")).toBe("C#");
    expect(languageLabel("objective-c")).toBe("Objective-C");
    expect(languageLabel("python")).toBe("Python");
    expect(languageLabel("php")).toBe("PHP");
  });

  it("falls back to a derived label for unknown languages", () => {
    expect(languageLabel("cobol")).toBe("Cobol");
    expect(languageLabel(null)).toBe("Unknown");
  });

  it("keeps a symbol and color for every catalog language", () => {
    for (const lang of LANGUAGES) {
      const meta = languageMeta(lang);
      expect(meta.symbol.length).toBeGreaterThan(0);
      expect(meta.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});

describe("examplesForLanguage", () => {
  it("returns exactly 3 curated examples per catalog language", () => {
    for (const lang of LANGUAGES) {
      expect(examplesForLanguage(lang)).toHaveLength(3);
    }
  });

  it("covers the shared spine plus a varied third problem", () => {
    const THIRDS = [
      "longest common prefix",
      "fizzbuzz",
      "fibonacci",
      "trapping rain water",
    ];
    for (const lang of LANGUAGES) {
      const titles = examplesForLanguage(lang).map((e) => e.title.toLowerCase());
      expect(titles[0]).toContain("two sum");
      expect(titles[1]).toContain("valid parentheses");
      expect(THIRDS.some((third) => titles[2].includes(third))).toBe(true);
    }
  });

  it("every example ships both a prompt and a test suite", () => {
    for (const lang of LANGUAGES) {
      for (const example of examplesForLanguage(lang)) {
        expect(example.prompt.length).toBeGreaterThan(0);
        expect(example.testCode.length).toBeGreaterThan(0);
      }
    }
  });

  it("returns an empty list for unknown languages", () => {
    expect(examplesForLanguage("cobol")).toEqual([]);
  });

  it("keeps every executable language's example prompt playable", () => {
    for (const lang of EXECUTABLE_LANGUAGES) {
      const example = LANGUAGE_EXAMPLES[lang as keyof typeof LANGUAGE_EXAMPLES][0];
      expect(example.prompt.length).toBeGreaterThan(20);
    }
  });
});

describe("languageGuide", () => {
  it("derives the guide from the language's first example", () => {
    const guide = languageGuide("python");
    expect(guide.prompt).toBe(LANGUAGE_EXAMPLES.python[0].prompt);
    expect(guide.testCode).toBe(LANGUAGE_EXAMPLES.python[0].testCode);
    expect(guide.extension).toBe("py");
  });

  it("keeps the Go example aligned with the exported demo solution", () => {
    const guide = languageGuide("go");
    expect(guide.prompt).toContain("TwoSum");
    expect(guide.testCode).toContain("func TestTwoSum");
  });

  it("knows the extension for every catalog language", () => {
    const extensions = [
      "py", "js", "ts", "java", "go",
      "c", "cpp", "rs", "php", "rb", "pl", "kt", "lua",
      "cs", "swift", "dart", "scala", "r", "hs", "m",
    ];
    LANGUAGES.forEach((lang, index) => {
      expect(languageGuide(lang).extension).toBe(extensions[index]);
    });
  });

  it("falls back for unknown languages", () => {
    const guide = languageGuide("cobol");
    expect(guide.prompt).toContain("two_sum");
    expect(guide.extension).toBe("txt");
  });
});

describe("LANGUAGE_RUNNERS", () => {
  it("covers exactly the 13 executable languages", () => {
    expect(Object.keys(LANGUAGE_RUNNERS).sort()).toEqual(
      [...EXECUTABLE_LANGUAGES].sort(),
    );
  });

  it("mirrors the sandbox filenames per language", () => {
    expect(runnerForLanguage("c")?.solutionFilename).toBe("solution.c");
    expect(runnerForLanguage("cpp")?.testFilename).toBe("test_solution.cpp");
    expect(runnerForLanguage("rust")?.runner).toBe("rustc --test");
    expect(runnerForLanguage("kotlin")?.solutionFilename).toBe("solution.kt");
    expect(runnerForLanguage("lua")?.testFilename).toBe("test_solution.lua");
  });

  it("returns null for display-only and unknown languages", () => {
    for (const lang of DISPLAY_ONLY_LANGUAGES) {
      expect(runnerForLanguage(lang)).toBeNull();
    }
    expect(runnerForLanguage("cobol")).toBeNull();
    expect(runnerForLanguage(null)).toBeNull();
  });
});

describe("evaluationEstimate", () => {
  it("gives the short estimate for quick-to-run languages", () => {
    for (const lang of ["python", "javascript", "typescript", "php", "ruby", "perl", "lua"]) {
      expect(evaluationEstimate(lang)).toBe("about 10–30 seconds");
    }
  });

  it("warns about compilation for compiled languages", () => {
    for (const lang of ["java", "go", "c", "cpp", "rust", "kotlin"]) {
      expect(evaluationEstimate(lang)).toContain("up to ~2 minutes");
    }
  });

  it("falls back for unknown or missing language", () => {
    expect(evaluationEstimate("cobol")).toBe("under a minute");
    expect(evaluationEstimate(null)).toBe("under a minute");
  });
});

/**
 * Issue #203 introduced `--color-on-solid` (dark ink, for the dark theme's
 * bright brand surfaces) alongside `--color-on-accent` (white). The language
 * badge deliberately stays on `--color-on-accent`: its background is a
 * per-language colour that is dark in BOTH themes, so white is correct there and
 * dark ink would drop it to ~3.9:1. This pins that pairing down, because the
 * temptation to "fix contrast" by flipping the global token would break every
 * badge at once.
 */
describe("language badge contrast", () => {
  const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const luminance = ([r, g, b]: number[]) =>
    [r, g, b]
      .map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      })
      .reduce((acc, channel, i) => acc + channel * [0.2126, 0.7152, 0.0722][i]!, 0);
  const contrast = (a: number[], b: number[]) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  it("keeps a white label readable on every language colour", () => {
    const white = channels("#ffffff");
    for (const language of LANGUAGES) {
      const { color, label } = languageMeta(language);
      const ratio = contrast(white, channels(color));
      expect(
        ratio,
        `${label} badge (${color}) is ${ratio.toFixed(2)}:1 with a white label and needs 4.5:1`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
