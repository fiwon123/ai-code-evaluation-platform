import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Badge from "../Badge/Badge.tsx";
import BadgeSelect from "./BadgeSelect.tsx";
import styles from "./BadgeSelect.module.css";

/**
 * The stylesheet as text, with comments removed.
 *
 * Read through Vite's `?raw` rather than `node:fs` — the app tsconfig has no node
 * types on purpose (see `theme-contrast.test.ts`). Comments are stripped because
 * the `:focus-within` rule is annotated with prose explaining *why* it avoids
 * `:has()`, and a matcher reading raw rule bodies would match that prose.
 */
const CSS = (await import("./BadgeSelect.module.css?raw")).default.replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

type Value = "easy" | "medium" | "hard";

const OPTIONS = [
  { value: "easy" as const, children: <Badge variant="success">Easy</Badge> },
  { value: "medium" as const, children: <Badge variant="warning">Medium</Badge> },
  { value: "hard" as const, children: <Badge variant="danger">Hard</Badge> },
];

function renderSelect(
  overrides: Partial<React.ComponentProps<typeof BadgeSelect<Value>>> = {},
) {
  const onChange = vi.fn();
  render(
    <BadgeSelect
      legend="Difficulty"
      name="difficulty"
      value="easy"
      options={OPTIONS}
      onChange={onChange}
      {...overrides}
    />,
  );
  return { onChange };
}

describe("BadgeSelect", () => {
  it("is a native radio group named by a real legend", () => {
    renderSelect();

    // The group is a fieldset with a legend, not a div with an invented role —
    // this is what lets a screen reader name the group and what keeps the
    // radios' form semantics intact.
    const group = screen.getByRole("group", { name: "Difficulty" });
    expect(group.tagName).toBe("FIELDSET");

    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios).toHaveLength(3);
    expect(radios.every((r) => r.type === "radio")).toBe(true);
    // A shared `name` is what makes them one group rather than three controls.
    expect(new Set(radios.map((r) => r.name)).size).toBe(1);
  });

  it("marks only the current value as checked", () => {
    renderSelect({ value: "medium" });
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios.map((r) => r.checked)).toEqual([false, true, false]);
  });

  it("reports the new value when an option is picked", () => {
    const { onChange } = renderSelect();
    // The accessible name is the badge's text ("Hard"); the *value* is the
    // lower-case key the form stores. They are deliberately different.
    fireEvent.click(screen.getByRole("radio", { name: "Hard" }));
    expect(onChange).toHaveBeenCalledWith("hard");
  });

  it("carries each option's accessible name from its rendered content", () => {
    renderSelect();
    // The name comes from the wrapping <label>, so whatever the option renders
    // must be readable text — the LanguageBadge case depends on this.
    expect(screen.getByRole("radio", { name: "Easy" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Medium" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Hard" })).toBeTruthy();
  });

  it("uses srLabel when the rendered body is not text", () => {
    renderSelect({
      options: [
        { value: "easy", children: <span aria-hidden="true">◆</span>, srLabel: "Python" },
      ],
    });
    // A symbol-only option would otherwise be announced as an unlabelled radio.
    expect(screen.getByRole("radio", { name: "Python" })).toBeTruthy();
  });

  it("keeps each option's tooltip", () => {
    renderSelect({
      options: [{ value: "easy", children: "Py", title: "Python · pytest" }],
    });
    expect(screen.getByTitle("Python · pytest")).toBeTruthy();
  });

  it("wires an error to the group, not to one option", () => {
    renderSelect({ error: "Pick a difficulty", errorId: "difficulty-error" });

    // The message describes the group as a whole, so it belongs on the
    // fieldset's aria-describedby — attaching it to a single radio would mean
    // the error is only announced for that one option.
    const group = screen.getByRole("group", { name: "Difficulty" });
    expect(group.getAttribute("aria-describedby")).toBe("difficulty-error");
    expect(screen.getByText("Pick a difficulty")).toBeTruthy();
  });

  it("leaves the group undescribed when there is no error", () => {
    renderSelect();
    const group = screen.getByRole("group", { name: "Difficulty" });
    expect(group.getAttribute("aria-describedby")).toBeNull();
  });

  it("keeps every option's own accent available to the page", () => {
    const { container } = render(
      <BadgeSelect
        legend="Language"
        name="language"
        value="python"
        options={[{ value: "python", children: "Python", accent: "#3776AB" }]}
        onChange={() => {}}
      />,
    );
    // The accent drives the selected ring, so a language badge keeps its brand
    // colour rather than every option looking identical.
    const label = container.querySelector("label")!;
    expect(label.getAttribute("style")).toContain("--option-accent");
  });
});

describe('BadgeSelect in "plain" appearance', () => {
  // Issue #346 asked for the difficulty row to be tags only. The reason this is a
  // mode rather than a second component is that hiding the radio would break the
  // control, not just its looks — see the `appearance` prop's own comment. These
  // tests hold both halves of that bargain: the chrome is gone, and the thing that
  // makes the row work is still there.
  function renderPlain(overrides: Partial<React.ComponentProps<typeof BadgeSelect<Value>>> = {}) {
    const onChange = vi.fn();
    const { container } = render(
      <BadgeSelect
        legend="Difficulty"
        name="difficulty"
        value="easy"
        options={OPTIONS}
        onChange={onChange}
        appearance="plain"
        {...overrides}
      />,
    );
    return { onChange, container };
  }

  it("still posts a name and value, so the form can read the choice back", () => {
    renderPlain();

    // This is the reason the radio is hidden rather than removed. Without a
    // `name`, `difficulty` would never be submitted and every challenge would
    // silently take the `"medium"` default — a correctness bug wearing a costume.
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios).toHaveLength(3);
    expect(new Set(radios.map((r) => r.name))).toEqual(new Set(["difficulty"]));
    expect(radios.map((r) => r.value)).toEqual(["easy", "medium", "hard"]);
    expect(radios.map((r) => r.checked)).toEqual([true, false, false]);
  });

  it("keeps the radios reachable, so a keyboard user can still pick a difficulty", () => {
    renderPlain();

    // A hidden radio that is also unfocusable would leave the row unusable
    // without a mouse — the tag would look selectable and be decoration.
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    for (const radio of radios) {
      expect(radio.disabled).toBe(false);
      // `appearance: none` removes the native glyph; it must not remove the
      // element or its tab stop.
      expect(radio.tabIndex).toBeGreaterThanOrEqual(0);
    }
    radios[2]!.focus();
    expect(document.activeElement).toBe(radios[2]);
  });

  it("still reports a change from a click on the tag", () => {
    const { onChange } = renderPlain();

    // The whole tag is the hit area: the hidden radio covers the label, so
    // clicking the word selects it.
    fireEvent.click(screen.getByRole("radio", { name: "Hard" }));
    expect(onChange).toHaveBeenCalledWith("hard");
  });

  it("drops the card chrome but leaves the selected state marked", () => {
    const { container } = renderPlain({ value: "medium" });

    const labels = [...container.querySelectorAll("label")];
    expect(labels).toHaveLength(3);

    for (const label of labels) {
      expect(label.className).toContain(styles.option);
      // The tag look, not the card look.
      expect(label.className).toContain(styles.optionPlain);
    }

    // Selection is still expressed — the selected option is the one carrying the
    // `optionSelected` class, so a page (or a test) can still tell them apart.
    const selected = labels.filter((l) => l.className.includes(styles.optionSelected));
    expect(selected).toHaveLength(1);
    expect(selected[0]!.textContent).toBe("Medium");
  });

  it("is the default-safe mode: `card` keeps its own chrome when appearance is omitted", () => {
    // A default that silently changed would restyle the 20-item language grid on
    // the challenges page, which is the opposite of what `plain` is for.
    const { container } = render(
      <BadgeSelect legend="Language" name="language" value="py" options={OPTIONS} onChange={() => {}} />,
    );
    const label = container.querySelector("label")!;
    expect(label.className).not.toContain(styles.optionPlain);
  });

  it("moves the focus ring to the tag, because the radio's own ring is invisible", () => {
    // The ring cannot live on the hidden radio (there is nothing to see), so it
    // moves to the label. And it must not depend on `:has(:focus-visible)` —
    // that would leave a keyboard user with no visible focus in a browser without
    // `:has()` support, which is exactly the case `.optionPlain` guards.
    const rule = CSS.match(/\.optionPlain:focus-within \{([^}]*)\}/)?.[1];
    expect(rule, "the plain option must draw a focus ring of its own").toBeTruthy();
    expect(rule).toContain("outline:");
    expect(CSS).not.toMatch(/\.optionPlain[^{]*:has\(/);
  });

  it("sizes the plain row to its content instead of a fixed track", () => {
    // In `card` mode each option owns an 11rem column, which is right for a
    // 20-item language grid and wrong for three short words: it would space them
    // across half the form. The plain row wraps instead.
    const optionsPlain = CSS.match(/\.optionsPlain \{([^}]*)\}/)?.[1];
    expect(optionsPlain).toContain("flex-wrap: wrap");

    const { container } = renderPlain();
    const row = container.querySelector(`.${styles.optionsPlain}`);
    expect(row, "the options row must use the plain variant").toBeTruthy();
  });
});
