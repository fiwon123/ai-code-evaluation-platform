import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Field, FieldGroup, SelectInput, TextAreaInput, TextInput } from "./Input.tsx";

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

  it("Field wires aria-invalid and aria-describedby to an erroring control", () => {
    render(
      <Field label="Email" id="email" error="Required">
        <TextInput id="email" />
      </Field>,
    );
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "email-error");
    // The announcement target is the actual error message, not a phantom id.
    expect(screen.getByText("Required")).toHaveAttribute("id", "email-error");
  });

  it("Field leaves a valid control without aria-error noise", () => {
    render(
      <Field label="Email" id="email">
        <TextInput id="email" />
      </Field>,
    );
    const input = screen.getByLabelText("Email");
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(input.getAttribute("aria-describedby")).toBeNull();
  });

  // #323: a second child used to make React hand over an array, and
  // `isValidElement(children)` is false for an array — so the wiring was
  // skipped and the error rendered as orphaned text. The register password
  // field has a strength hint beside its input and was the only field in the
  // app hitting this.
  it("Field wires the control when it has more than one child", () => {
    render(
      <Field label="Password" id="password" error="Too short">
        <TextInput id="password" />
        <span>Use at least 8 characters</span>
      </Field>,
    );
    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "password-error");
    // The sibling survives the rewrite of `children` into an array.
    expect(screen.getByText("Use at least 8 characters")).toBeInTheDocument();
    expect(screen.getByText("Too short")).toHaveAttribute("id", "password-error");
  });

  it("Field does not put the error on a non-control sibling", () => {
    render(
      <Field label="Password" id="password" error="Too short">
        <TextInput id="password" />
        <span>Use at least 8 characters</span>
      </Field>,
    );
    // Only the input — the first element — is wired, never the hint.
    expect(screen.getByText("Use at least 8 characters")).not.toHaveAttribute(
      "aria-describedby",
    );
  });

  it("Field still leaves a multi-child valid field free of aria-error noise", () => {
    render(
      <Field label="Password" id="password">
        <TextInput id="password" />
        <span>Use at least 8 characters</span>
      </Field>,
    );
    const input = screen.getByLabelText("Password");
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(input.getAttribute("aria-describedby")).toBeNull();
    expect(screen.getByText("Use at least 8 characters")).toBeInTheDocument();
  });

  it("FieldGroup announces a group error on the role=group wrapper", () => {
    render(
      <FieldGroup label="Start from an example" id="examples" error="Pick one">
        <button type="button">Two Sum</button>
      </FieldGroup>,
    );
    const group = screen.getByRole("group");
    expect(group).toHaveAttribute("aria-labelledby", "examples");
    expect(group).toHaveAttribute("aria-describedby", "examples-error");
    expect(screen.getByText("Pick one")).toHaveAttribute("id", "examples-error");
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