import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Toast from "./Toast.tsx";

describe("Toast", () => {
  it("renders the message with a success icon", () => {
    render(<Toast message="Saved!" type="success" onDismiss={vi.fn()} />);
    expect(screen.getByText("Saved!")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("uses the alert role for error toasts", () => {
    render(<Toast message="Failed" type="error" onDismiss={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Failed");
  });

  it("dismisses when the close button is clicked", () => {
    const onDismiss = vi.fn();
    render(<Toast message="Info" onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(onDismiss).toHaveBeenCalled();
  });
});