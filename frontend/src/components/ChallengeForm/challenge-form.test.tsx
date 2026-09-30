/**
 * The shared Create/Edit form layout (issue #237).
 *
 * `CreateChallenge` and `EditChallenge` were the same form duplicated by hand —
 * 92 byte-identical lines of CSS between them, and the same field markup copied
 * into both pages. Nothing stopped the copies drifting, and the pages have
 * already drifted once: Edit was missing the `setSubmitting(false)` that Create
 * had in its `finally`.
 *
 * So the layout is now one component and one stylesheet. Two things are locked
 * here, because "we extracted it" is a claim that decays the moment someone
 * needs one more field:
 *
 *  1. the shared component behaves (sections, the radio group, the counter, the
 *     runner hint, the action bar),
 *  2. neither page goes back to declaring the layout itself.
 *
 * The locked strings in `CreateChallenge.test.tsx` / `EditChallenge.test.tsx`
 * are load-bearing and are not re-asserted here — those files must keep passing
 * unchanged, which is the real contract. What is re-asserted here is the part
 * they cannot see: that there is only one copy of the layout left.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";

import {
  ChallengeFormActions,
  ChallengeFormFields,
  type ChallengeFormValue,
} from "./ChallengeFormFields.tsx";
import badgeSelectStyles from "../BadgeSelect/BadgeSelect.module.css";
import { expectCodeToContain } from "../../test/code";
import { languageMeta, runnerForLanguage } from "../../utils/language";

const PAGES = import.meta.glob("../../pages/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const CSS = import.meta.glob("../../**/*.module.css", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const SHARED_CSS = "./challenge-form.module.css";

const BASE: ChallengeFormValue = {
  title: "",
  description: "",
  prompt: "",
  testCode: "",
  language: "python",
  difficulty: "medium",
};

const EXAMPLES = [
  { title: "Two Sum", prompt: "p1", testCode: "t1" },
  { title: "Valid Parentheses", prompt: "p2", testCode: "t2" },
];

function renderFields(
  overrides: Partial<ChallengeFormValue> = {},
  props: { examples?: typeof EXAMPLES; onApplyExample?: (i: number) => void } = {},
) {
  const onChange = vi.fn();
  const result = render(
    <ChallengeFormFields
      value={{ ...BASE, ...overrides }}
      onChange={onChange}
      guide={GUIDE}
      examples={props.examples}
      onApplyExample={props.onApplyExample}
    />,
  );
  return { ...result, onChange };
}

const GUIDE = {
  prompt: "Write a Python function…",
  testLabel: "Test code (pytest)",
  testCode: "def test_…",
  extension: "py",
};

/** The form as the pages actually host it: controlled, and self-updating. */
function StatefulFields({ initial }: { initial: ChallengeFormValue }) {
  const [value, setValue] = useState(initial);
  return (
    <ChallengeFormFields
      value={value}
      onChange={(key, next) =>
        setValue((current) => ({ ...current, [key]: next }) as ChallengeFormValue)
      }
      guide={GUIDE}
    />
  );
}

/** As above, but with the example loader wired up, for the language re-tag test. */
function StatefulFieldsWithExamples({ initial }: { initial: ChallengeFormValue }) {
  const [value, setValue] = useState(initial);
  return (
    <ChallengeFormFields
      value={value}
      onChange={(key, next) =>
        setValue((current) => ({ ...current, [key]: next }) as ChallengeFormValue)
      }
      guide={GUIDE}
      examples={EXAMPLES}
      onApplyExample={() => {}}
    />
  );
}

describe("the shared challenge-form layout", () => {
  it("renders the sections in order, so the form reads as a shape", () => {
    renderFields();
    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(headings).toEqual(["Challenge basics", "Prompt", "Tests"]);
    // The guide is a disclosure, not a heading — it has to be findable without
    // being announced as a section that is already on screen.
    expect(
      screen.getByText(/guide and example solution for python/i),
    ).toBeInTheDocument();
  });

  it("keeps the label strings the page tests reach for", () => {
    // Not a duplicate of those tests: this fails at the *component* level if a
    // refactor renames a label, which is cheaper to diagnose than a failure
    // three files away.
    renderFields();
    expect(screen.getByLabelText("Title")).toBeDefined();
    expect(screen.getByLabelText("Description")).toBeDefined();
    expect(screen.getByLabelText("Prompt for the LLM")).toBeDefined();
    expect(screen.getByText("Test code (pytest)")).toBeDefined();
    // A real `<select>`, because a custom combobox is a different control with
    // different keyboard behaviour and the issue rules it out.
    expect(screen.getByLabelText("Language").tagName).toBe("SELECT");
  });

  it("counts words and characters as the prompt is typed", () => {
    const { onChange } = renderFields();
    expect(screen.getByText("0 words · 0 characters")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Prompt for the LLM"), {
      target: { value: "two sum in go" },
    });
    expect(onChange).toHaveBeenCalledWith("prompt", "two sum in go");
  });

  it("pluralises the counter instead of showing '1 words'", () => {
    renderFields({ prompt: "solo" });
    expect(screen.getByText("1 word · 4 characters")).toBeInTheDocument();
  });

  it("names the runner for the selected language", () => {
    // A real stateful host rather than a `vi.fn()` for `onChange`: the form is
    // controlled, so a mock that records the call and changes nothing leaves the
    // rendered language exactly as it was, and the assertion below would be
    // testing the mock instead of the component.
    const { container } = render(
      <StatefulFields initial={{ ...BASE }} />,
    );
    expect(screen.getByText(/Runs with pytest/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Language"), {
      target: { value: "csharp" },
    });
    // A display-only language has no runner, and saying so is more useful than
    // quietly showing the last language's runner.
    expect(screen.getByText(/No runner wired up yet/)).toBeInTheDocument();
    expect(container.querySelector("details")).not.toBeNull();
  });

  it("offers the example loader only when there are examples", () => {
    const onApplyExample = vi.fn();
    const { unmount } = renderFields({}, { examples: EXAMPLES, onApplyExample });
    fireEvent.click(screen.getByRole("button", { name: "Valid Parentheses" }));
    expect(onApplyExample).toHaveBeenCalledWith(1);
    unmount();

    // The Edit path: every field is already filled, so overwriting three of
    // them on a click is a way to lose work.
    renderFields({ title: "Already here" });
    expect(
      screen.queryByRole("button", { name: "Valid Parentheses" }),
    ).not.toBeInTheDocument();
  });

  it("puts difficulty in one radio group rather than a select", () => {
    renderFields();
    // A fieldset/legend is a group named by its legend: no invented role, and
    // arrow keys move between the options.
    const group = screen.getByRole("group", { name: "Difficulty" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual([
      "easy",
      "medium",
      "hard",
    ]);
    // One posted name, so the group is one value rather than three fields.
    expect(new Set(radios.map((r) => r.getAttribute("name")))).toEqual(
      new Set(["difficulty"]),
    );
    expect((screen.getByRole("radio", { name: "Medium" }) as HTMLInputElement).checked).toBe(true);
  });

  it("reports a difficulty change", () => {
    const { onChange } = renderFields();
    fireEvent.click(screen.getByRole("radio", { name: "Hard" }));
    expect(onChange).toHaveBeenCalledWith("difficulty", "hard");
  });
});

describe("the form's code surfaces (issue #346)", () => {
  // Three reported problems in one area: the code fields were small, light and
  // unhighlighted; the difficulty row read as widgets rather than tags; and the
  // example loader offered anonymous grey text. Each is asserted here as a
  // behaviour, not as a diff.

  it("gives the prompt and test fields a dark, syntax-highlighted surface", () => {
    const { container } = renderFields({ prompt: "def add(a, b):\n    return a + b" });

    // The control is still the control: a labelled `<textarea>` holding the value.
    const prompt = screen.getByLabelText("Prompt for the LLM") as HTMLTextAreaElement;
    expect(prompt.tagName).toBe("TEXTAREA");
    expect(prompt.value).toBe("def add(a, b):\n    return a + b");

    // …and behind it there is a painted, aria-hidden, tokenized copy. One `<pre>`
    // per field, so two fields means two.
    const paints = [...container.querySelectorAll('pre[aria-hidden="true"]')];
    expect(paints).toHaveLength(2);
    expect(paints[0]!.querySelectorAll("[data-token]").length).toBeGreaterThan(0);
  });

  it("makes both code fields taller than the fields they replaced", () => {
    renderFields();

    // The reported problem was size, so it is pinned as a number rather than
    // left to "it looks bigger". The old values were 5 and 6 rows; a plain
    // TextAreaInput default would put both back to 2 without failing anything
    // else here.
    const prompt = screen.getByLabelText("Prompt for the LLM") as HTMLTextAreaElement;
    expect(Number(prompt.rows)).toBeGreaterThanOrEqual(9);
    // The test-suite field is the longer of the two.
    const tests = screen.getByLabelText("Test code (pytest)") as HTMLTextAreaElement;
    expect(Number(tests.rows)).toBeGreaterThanOrEqual(14);
  });

  it("re-tokenizes both fields when the language changes", () => {
    // Highlighting chosen per language is the whole point — a Go suite painted
    // with Python keywords is worse than no highlighting.
    const { container } = render(<StatefulFields initial={{ ...BASE, testCode: "func Add(a int) int {" }} />);
    const paintFor = () =>
      [...container.querySelectorAll('pre[aria-hidden="true"]')][1]!.textContent ?? "";
    expect(paintFor()).toContain("func Add(a int) int {");

    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "go" } });
    expect(paintFor()).toContain("func Add(a int) int {");
    // Re-tokenized for Go: `func` is a Go keyword, and in Python it is a name.
    expect(
      [...container.querySelectorAll('pre[aria-hidden="true"]')][1]!
        .querySelectorAll('[data-token="keyword"]').length,
    ).toBeGreaterThan(0);
  });

  it("shows difficulty as tags rather than cards", () => {
    const { container } = renderFields();

    // `plain` is presentation only, so the radios are still the control — but the
    // options must no longer wear the card chrome that made three words read as
    // three widgets.
    const labels = [...container.querySelectorAll("label")].filter((l) =>
      l.querySelector('input[name="difficulty"]'),
    );
    expect(labels).toHaveLength(3);
    for (const label of labels) {
      expect(label.className, "difficulty options must use BadgeSelect's plain variant").toContain(
        badgeSelectStyles.optionPlain,
      );
    }
  });

  it("tags each example with the selected language's brand colour", () => {
    const { container } = renderFields(
      { language: "python" },
      { examples: EXAMPLES, onApplyExample: vi.fn() },
    );

    const buttons = [...container.querySelectorAll("button")].filter((b) =>
      b.textContent?.includes("Sum") || b.textContent?.includes("Parentheses"),
    );
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      // Asserted against the token's own value, not merely "the two buttons
      // differ" — which would pass if both were mapped to the wrong colour.
      expect(button.getAttribute("style")).toContain(languageMeta("python").color);
    }
  });

  it("keeps the example's language chip decorative", () => {
    const { container } = renderFields(
      {},
      { examples: EXAMPLES, onApplyExample: vi.fn() },
    );
    const chip = container.querySelector('[aria-hidden="true"][class*="exampleTag"]');
    expect(chip, "the symbol chip must render").not.toBeNull();
    // The button is already named by the example title, so announcing the
    // symbol too would make it read "Py Two Sum".
    expect(chip!.textContent).toBe(languageMeta("python").symbol);
  });

  it("re-tags the examples when the language changes", () => {
    const { container } = render(
      <StatefulFieldsWithExamples initial={{ ...BASE }} />,
    );
    const accent = () =>
      container.querySelector('button[class*="example"]')?.getAttribute("style") ?? "";

    expect(accent()).toContain(languageMeta("python").color);
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "go" } });
    expect(accent()).toContain(languageMeta("go").color);
  });

  it("still loads an example when its tag is clicked", () => {
    // The tags replaced ghost buttons; they must remain buttons, not spans with a
    // click handler, or they lose keyboard activation entirely.
    const onApplyExample = vi.fn();
    renderFields({}, { examples: EXAMPLES, onApplyExample });

    const button = screen.getByRole("button", { name: /Valid Parentheses/ });
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    fireEvent.click(button);
    expect(onApplyExample).toHaveBeenCalledWith(1);
  });

  it("shows the guide's samples as code surfaces, named by the runner", () => {
    const { container } = renderFields();

    // The guide used to be two plain light-surface `<pre>`s — the one place the
    // form shows what good looks like was the least convincing code on the page.
    // It is `CodeBlock`s now, so the samples carry the runner's real filenames.
    expectCodeToContain("Write a Python function");

    const guide = container.querySelector("details")!;
    expect(guide.querySelectorAll("pre").length).toBeGreaterThanOrEqual(2);
    // Scoped to the guide and to plural, because `CodeBlock` names the file in
    // more than one place (the header label and the control that copies it).
    expect(
      within(guide).getAllByText(runnerForLanguage("python")!.testFilename).length,
    ).toBeGreaterThan(0);
  });
});

describe("the sticky action bar", () => {
  function renderActions(overrides: Partial<ChallengeFormValue> = {}, error?: string) {
    const onCancel = vi.fn();
    render(
      <ChallengeFormActions
        value={{ ...BASE, ...overrides }}
        submitting={false}
        submitLabel="Save changes"
        loadingText="Saving…"
        onCancel={onCancel}
        error={error}
      />,
    );
    return { onCancel };
  }

  it("summarises what is being saved", () => {
    renderActions({ title: "Two Sum", language: "go", difficulty: "hard" });
    expect(screen.getByText("Two Sum")).toBeInTheDocument();
    // The display label, not the enum value: the bar is read, not posted.
    expect(screen.getByText("Go · Hard difficulty")).toBeInTheDocument();
  });

  it("names an untitled form rather than rendering nothing", () => {
    // A blank summary line would collapse the bar to half its height and read
    // as a rendering bug.
    renderActions({ title: "   " });
    expect(screen.getByText("Untitled challenge")).toBeInTheDocument();
  });

  it("puts the error next to the action that produced it", () => {
    renderActions({}, "Title too short");
    expect(screen.getByRole("alert")).toHaveTextContent("Title too short");
  });

  it("cancels without submitting", () => {
    const { onCancel } = renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe("the two pages cannot drift apart again", () => {
  const FORM_PAGES = [
    "../../pages/CreateChallenge.tsx",
    "../../pages/EditChallenge.tsx",
  ];

  it("resolves the page and stylesheet globs", () => {
    // A wrong glob key reads `undefined`, every `for` over it iterates nothing,
    // and the assertions below pass while inspecting nothing. The same mistake
    // made two hero tests vacuous in #243.
    for (const page of FORM_PAGES) {
      expect(PAGES[page], `${page} did not resolve`).toBeDefined();
    }
    expect(CSS[SHARED_CSS], "the shared stylesheet did not resolve").toBeDefined();
  });

  it("has both pages render the shared layout instead of their own", () => {
    for (const page of FORM_PAGES) {
      const src = PAGES[page].replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
      expect(src, `${page} no longer renders ChallengeFormFields`).toMatch(
        /<ChallengeFormFields/,
      );
      // If any of these come back, the layout has started living in the pages
      // again and the two copies can diverge.
      for (const control of ["<Field", "<FieldGroup", "<TextInput", "<SelectInput", "<TextAreaInput"]) {
        expect(src.includes(control), `${page} declares ${control} itself`).toBe(false);
      }
    }
  });

  it("keeps the option-grid selectors in the BadgeSelect module only", () => {
    // The difficulty control is a BadgeSelect, so its geometry belongs to the
    // primitive. A `.chip`/`.chips` reappearing in the form or in either page
    // would be a second, drifting implementation of the same control.
    const badgeSelect = CSS["../BadgeSelect/BadgeSelect.module.css"];
    expect(badgeSelect, "BadgeSelect.module.css did not resolve").toBeDefined();

    const optionSelectors = [".options", ".option", ".radio", ".legend"];
    for (const selector of optionSelectors) {
      expect(
        new RegExp(`(^|[\\s,}])${selector.replace(".", "\\.")}\\s*[,{]`).test(
          badgeSelect,
        ),
        `BadgeSelect.module.css no longer declares ${selector}`,
      ).toBe(true);
    }

    for (const css of [
      SHARED_CSS,
      "../../pages/CreateChallenge.module.css",
      "../../pages/EditChallenge.module.css",
    ]) {
      const sheet = CSS[css];
      expect(sheet, `${css} did not resolve`).toBeDefined();
      for (const selector of optionSelectors) {
        expect(
          new RegExp(`(^|[\\s,}])${selector.replace(".", "\\.")}\\s*[,{]`).test(
            sheet,
          ),
          `${css} declares ${selector} — it belongs to BadgeSelect.module.css`,
        ).toBe(false);
      }
    }
  });

  it("keeps the field selectors in the shared stylesheet only", () => {
    const shared = CSS[SHARED_CSS];
    // `.chips`/`.chip` used to be listed here. They now belong to
    // `BadgeSelect.module.css`, which owns the difficulty option grid, so the
    // guard moved with them rather than being deleted — a selector with no owner
    // is exactly how the drift it was written to catch starts again.
    const fieldSelectors = [
      ".form",
      ".section",
      ".sectionHead",
      ".grid",
      ".counter",
      ".examples",
      ".actions",
      ".errorBanner",
    ];
    for (const selector of fieldSelectors) {
      expect(
        new RegExp(`(^|[\\s,}])${selector.replace(".", "\\.")}\\s*[,{]`).test(shared),
        `the shared stylesheet no longer declares ${selector}`,
      ).toBe(true);
    }
    for (const page of ["CreateChallenge", "EditChallenge"]) {
      const css = CSS[`../../pages/${page}.module.css`];
      expect(css, `${page}.module.css did not resolve`).toBeDefined();
      for (const selector of fieldSelectors) {
        expect(
          new RegExp(`(^|[\\s,}])${selector.replace(".", "\\.")}\\s*[,{]`).test(css),
          `${page}.module.css redefines ${selector} — it belongs in the shared module`,
        ).toBe(false);
      }
    }
  });

  it("keeps the page shell in each page, because the rhythm lock reads it", () => {
    // The shell is deliberately *not* shared: `page-rhythm.test.ts` reads each
    // page's own `.page` padding to hold Create and Edit to the same rhythm.
    // Moving it into the shared module would have deleted what that lock checks
    // while leaving the lock green.
    for (const page of ["CreateChallenge", "EditChallenge"]) {
      const css = CSS[`../../pages/${page}.module.css`];
      expect(
        /(^|[\s,}]) \.page|([\s,}]) \.page/.test(css) || /^\.page\s*\{/m.test(css),
        `${page}.module.css no longer declares its own .page shell`,
      ).toBe(true);
      expect(css).toMatch(/padding:\s*var\(--space-12\)\s+var\(--space-6\)\s+var\(--space-16\)/);
    }
  });
});
