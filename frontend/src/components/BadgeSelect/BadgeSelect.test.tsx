import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Badge from "../Badge/Badge.tsx";
import BadgeSelect from "./BadgeSelect.tsx";

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
