import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Field, SelectInput, TextAreaInput, TextInput } from "./Input.tsx";

describe("Input components", () => {
  it("Field associates the label and shows an error", () => {
    render(
      <Field label="Email" id="email" error="Required">
        <TextInput id="email" />
      </Field>,
    );
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByText("Required")).toBeInTheDocument();
  });

  it("TextInput applies the error class when invalid", () => {
    const { container } = render(<TextInput invalid />);
    expect(container.querySelector("input")?.className).toContain("error");
  });

  it("TextInput passes through additional attributes", () => {
    render(<TextInput aria-label="Search" type="search" />);
    expect(screen.getByLabelText("Search")).toHaveAttribute("type", "search");
  });

  it("SelectInput renders and selects options", () => {
    render(
      <SelectInput aria-label="Language" defaultValue="python">
        <option value="python">Python</option>
        <option value="javascript">JavaScript</option>
      </SelectInput>,
    );
    expect(screen.getByLabelText("Language")).toHaveValue("python");
  });

  it("TextAreaInput renders content and applies classes", () => {
    const { container } = render(<TextAreaInput defaultValue="hello" />);
    const area = container.querySelector("textarea");
    expect(area?.value).toBe("hello");
    expect(area?.className).toContain("textarea");
  });
});