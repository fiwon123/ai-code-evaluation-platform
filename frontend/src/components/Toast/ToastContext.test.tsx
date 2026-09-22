import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "./ToastContext.tsx";

function Probe() {
  const { showToast } = useToast();
  return (
    <div>
      <button onClick={() => showToast("Hello world", "success")}>
        Show success
      </button>
      <button onClick={() => showToast("Something failed", "error")}>
        Show error
      </button>
    </div>
  );
}

describe("ToastProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a toast when showToast is called", () => {
    render(
      <ToastProvider>
        <Probe />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("Show success"));
    expect(screen.getByText("Hello world")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("auto-dismisses the toast after the timeout", () => {
    render(
      <ToastProvider>
        <Probe />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("Show success"));
    expect(screen.getByText("Hello world")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5100);
    });
    expect(screen.queryByText("Hello world")).not.toBeInTheDocument();
  });
});