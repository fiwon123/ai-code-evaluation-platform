import { describe, expect, it } from "vitest";
import {
  LANGUAGES,
  LANGUAGE_EXAMPLES,
  examplesForLanguage,
  languageGuide,
} from "./language.ts";

describe("examplesForLanguage", () => {
  it("returns 2-3 curated examples per supported language", () => {
    for (const lang of LANGUAGES) {
      const examples = examplesForLanguage(lang);
      expect(examples.length).toBeGreaterThanOrEqual(2);
      expect(examples.length).toBeLessThanOrEqual(3);
    }
  });

  it("covers the same three example problems in every language", () => {
    const problems = ["two sum", "valid parentheses", "longest common prefix"];
    for (const lang of LANGUAGES) {
      const titles = examplesForLanguage(lang).map((e) => e.title.toLowerCase());
      for (const problem of problems) {
        expect(
          titles.some((title) => title.includes(problem)),
        ).toBe(true);
      }
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
    expect(examplesForLanguage("ruby")).toEqual([]);
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

  it("falls back for unknown languages", () => {
    const guide = languageGuide("ruby");
    expect(guide.prompt).toContain("two_sum");
    expect(guide.extension).toBe("txt");
  });
});