import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ThemeToggle from "./ThemeToggle.tsx";

function stubMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

describe("ThemeToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    stubMatchMedia(false);
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("applies the light theme by default", () => {
    render(<ThemeToggle />);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("toggles to dark mode and persists the choice", () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: /dark mode/i }));

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
  });

  it("respects a stored dark preference", () => {
    localStorage.setItem("theme", "dark");
    render(<ThemeToggle />);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("follows the system preference when nothing is stored", () => {
    stubMatchMedia(true);
    render(<ThemeToggle />);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});