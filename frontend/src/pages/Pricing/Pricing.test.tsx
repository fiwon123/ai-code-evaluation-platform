import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import Pricing from "./Pricing.tsx";

function renderPage() {
  return render(
    <MemoryRouter>
      <Pricing />
    </MemoryRouter>,
  );
}

/** The body row for a capability, by its row header. */
function row(label: string): HTMLElement {
  return screen.getByRole("row", { name: new RegExp(`^${label}`) });
}

describe("Pricing comparison table", () => {
  it("names each yes/no cell for assistive tech", () => {
    renderPage();

    // The whole point: "Private challenges" must not be a row of unlabelled
    // glyphs. Reading the cells by accessible name is the assertion that the
    // meaning is available, not just drawn.
    const privateChallenges = row("Private challenges");
    expect(within(privateChallenges).getByText("Not included")).toBeTruthy();
    expect(within(privateChallenges).getAllByText("Included")).toHaveLength(2);
  });

  it("distinguishes not-included from included on the enterprise rows", () => {
    renderPage();

    for (const label of ["Self-hosted deployment", "SSO & audit logging"]) {
      const cells = within(row(label)).getAllByRole("cell");
      expect(within(cells[0]).getByText("Not included")).toBeTruthy();
      expect(within(cells[1]).getByText("Not included")).toBeTruthy();
      expect(within(cells[2]).getByText("Included")).toBeTruthy();
    }
  });

  it("leaves value cells as their text", () => {
    renderPage();

    // The quantities are not booleans and must not acquire a "Included" name —
    // "Unlimited" and "Dedicated" are answers, not ticks.
    const cells = within(row("Evaluations / month")).getAllByRole("cell");
    expect(cells[0].textContent).toBe("50");
    expect(cells[1].textContent).toBe("Unlimited");
    expect(within(row("Support")).getByText("Dedicated")).toBeTruthy();
  });

  it("keeps the table semantics intact", () => {
    renderPage();

    // Replacing glyphs with SVG is exactly the kind of change that quietly
    // flattens a table into a grid, so the header associations are asserted
    // rather than assumed.
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader")).toHaveLength(4);
    // Every capability is a row header, not a data cell.
    for (const label of [
      "Evaluations / month",
      "LLM providers",
      "Private challenges",
      "Metrics & history",
      "Support",
      "Self-hosted deployment",
      "SSO & audit logging",
    ]) {
      expect(within(row(label)).getByRole("rowheader")).toBeTruthy();
    }
  });

  it("renders the tier feature checks through the same mark", () => {
    const { container } = renderPage();

    // The card lists and the table must not disagree about what a check looks
    // like, so they share one component. Counting the SVGs proves the text
    // glyph is gone from both.
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThan(0);
    // Every feature item is a tick; none is a text "✓".
    expect(container.textContent).not.toContain("✓");
  });

  it("no longer contains the bare glyphs the data used to encode with", () => {
    renderPage();
    // A regression guard on the *data*, not the styles: "—" was how a row said
    // "no", and its return would be silent — the table would still render, just
    // without meaning.
    //
    // Scoped to the table, because an em dash is legitimate punctuation in the
    // FAQ prose ("…is illustrative — every tier is free to try"). Asserting on
    // the whole page would either fail on correct copy or, if loosened until it
    // passed, stop guarding the thing it was written for.
    const table = screen.getByRole("table");
    expect(table.textContent).not.toContain("—");
    expect(table.textContent).not.toContain("✓");
  });
});
