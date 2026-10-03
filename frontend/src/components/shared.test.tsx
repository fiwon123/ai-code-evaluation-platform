import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Button from "./Button/Button.tsx";
import Card from "./Card/Card.tsx";
import Badge from "./Badge/Badge.tsx";
import CodeBlock from "./CodeBlock/CodeBlock.tsx";

describe("shared components", () => {
  describe("Button", () => {
    it("renders children", () => {
      render(<Button>Click me</Button>);
      expect(screen.getByRole("button", { name: "Click me" })).toBeInTheDocument();
    });

    it("applies variant and size classes", () => {
      const { container } = render(
        <Button variant="danger" size="sm">
          Delete
        </Button>,
      );
      const button = container.querySelector("button");
      expect(button?.className).toContain("button");
      expect(button?.className).toContain("danger");
      expect(button?.className).toContain("sm");
    });

    it("is disabled when disabled prop set", () => {
      render(
        <Button disabled>
          Save
        </Button>,
      );
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    });

    it("shows a spinner and disables the button while loading", () => {
      const { container } = render(<Button loading>Save</Button>);
      const button = screen.getByRole("button", { name: "Save" });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("aria-busy", "true");
      expect(container.querySelector("span")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
    });

    it("swaps the label while loading when loadingText is provided", () => {
      render(<Button loading loadingText="Saving…">Save</Button>);
      expect(screen.getByRole("button", { name: "Saving…" })).toBeInTheDocument();
    });
  });

  describe("Card", () => {
    it("renders children", () => {
      render(<Card>Card content</Card>);
      expect(screen.getByText("Card content")).toBeInTheDocument();
    });

    it("applies compact padding class", () => {
      const { container } = render(<Card padding="compact">Content</Card>);
      expect(container.querySelector("div")?.className).toContain("compact");
    });

    // #387: marketing/informational panels ask for the dark surface without
    // knowing which theme is active.
    it("applies the dark variant class on request", () => {
      const { container } = render(<Card variant="dark">Content</Card>);
      const className = container.querySelector("div")?.className ?? "";
      expect(className).toContain("card");
      expect(className).toContain("dark");
    });

    it("does not apply the dark class by default", () => {
      const { container } = render(<Card>Content</Card>);
      expect(container.querySelector("div")?.className).not.toContain("dark");
    });
  });

  describe("Badge", () => {
    it("renders children with variant classes", () => {
      const { container } = render(<Badge variant="success">Passed</Badge>);
      const badge = container.querySelector("span");
      expect(badge?.className).toContain("badge");
      expect(badge?.className).toContain("success");
      expect(screen.getByText("Passed")).toBeInTheDocument();
    });

    it("defaults to neutral variant", () => {
      const { container } = render(<Badge>N/A</Badge>);
      expect(container.querySelector("span")?.className).toContain("neutral");
    });
  });

  describe("CodeBlock", () => {
    it("renders code content", () => {
      render(<CodeBlock code="print('hello')" filename="solution.py" />);
      expect(screen.getByText("print('hello')")).toBeInTheDocument();
      expect(screen.getByText("solution.py")).toBeInTheDocument();
    });

    it("copies code to clipboard on button click", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });

      render(<CodeBlock code="x = 1" />);
      const copyButton = screen.getByRole("button", { name: "Copy" });
      fireEvent.click(copyButton);

      expect(writeText).toHaveBeenCalledWith("x = 1");
      expect(await screen.findByText("Copied!")).toBeInTheDocument();
    });
  });
});