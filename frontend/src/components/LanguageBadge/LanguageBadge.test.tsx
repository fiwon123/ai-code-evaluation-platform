import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LanguageBadge from "./LanguageBadge.tsx";

describe("LanguageBadge", () => {
  it("shows the display label for a catalog language", () => {
    render(<LanguageBadge language="csharp" />);
    expect(screen.getByTitle("C# · catalog only")).toBeInTheDocument();
    // The symbol chip and the label both read "C#".
    expect(screen.getAllByText("C#")).toHaveLength(2);
  });

  it("shows the symbol chip for every catalog language", () => {
    const { container } = render(<LanguageBadge language="objective-c" />);
    const symbol = container.querySelector("span[aria-hidden=true]");
    expect(symbol?.textContent).toBe("ObjC");
    expect(screen.getByText("Objective-C")).toBeInTheDocument();
  });

  it("renders nothing when the language is missing", () => {
    const { container } = render(<LanguageBadge language={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("falls back gracefully for unknown languages", () => {
    render(<LanguageBadge language="cobol" />);
    expect(screen.getByText("Cobol")).toBeInTheDocument();
  });

  it("can hide the symbol chip", () => {
    const { container } = render(<LanguageBadge language="rust" showSymbol={false} />);
    expect(container.querySelector("span[aria-hidden=true]")).toBeNull();
    expect(screen.getByText("Rust")).toBeInTheDocument();
  });
});