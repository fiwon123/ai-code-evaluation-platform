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
