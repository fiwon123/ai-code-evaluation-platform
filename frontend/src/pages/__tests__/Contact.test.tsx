import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import Contact from "../Contact/Contact.tsx";

function renderPage() {
  return render(
    <MemoryRouter>
      <Contact />
    </MemoryRouter>,
  );
}

describe("Contact", () => {
  it("renders the contact form and info sections", () => {
    renderPage();
    expect(
      screen.getByRole("heading", { name: /Get in touch/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText(/Company/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Contact info/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Sales & partnerships/i }),
    ).toBeInTheDocument();
  });

  it("shows a success message after submitting the form", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Jane" },
    });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "jane@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Hello!" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Send message/i }));

    expect(
      screen.getByRole("heading", { name: /Message received!/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Thanks Jane/i)).toBeInTheDocument();
  });
});