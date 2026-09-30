import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Profile from "./Profile.tsx";
import profileCss from "./Profile.module.css?raw";
import { ToastProvider } from "../../components/Toast/ToastContext.tsx";
import { languageMeta } from "../../utils/language.ts";

/**
 * The "evaluations by challenge" card grid (issue #347).
 *
 * The page had no test of its own before this, so the properties below are new
 * coverage rather than a guard on existing behaviour. What they hold:
 *
 *  - the language is the card's accent, from the one source every other
 *    language cue reads (`languageMeta`);
 *  - the three stats read as label/value pairs, because a `<div>` soup of spans
 *    tells a screen reader nothing about what the numbers mean;
 *  - the *whole card* is the click target while the *title* stays the link, so
 *    the accessible name is the challenge's name and not a paragraph;
 *  - truncated text stays in the DOM and is reachable by keyboard, which is what
 *    makes the tooltip an aid rather than the only copy of the string.
 */

const stats = vi.hoisted(() => ({ current: [] as unknown[] }));
const submissions = vi.hoisted(() => ({ current: [] as unknown[] }));
const challenges = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock("../../services/api.ts", () => ({
  authApi: { changePassword: vi.fn() },
  challengesApi: {
    list: vi.fn(() =>
      Promise.resolve({
        items: challenges.current,
        total: challenges.current.length,
        pages: 1,
        page: 1,
      }),
    ),
  },
  submissionsApi: {
    list: vi.fn(() =>
      Promise.resolve({
        items: submissions.current,
        total: submissions.current.length,
        pages: 1,
        page: 1,
      }),
    ),
    stats: vi.fn(() => Promise.resolve({ items: stats.current })),
  },
}));

vi.mock("../../context/AuthContext.tsx", () => ({
  useAuth: () => ({
    user: { id: "u1", username: "ada", email: "a@b.c", is_admin: false },
    token: "t",
    initializing: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    loginWithOAuth: vi.fn(),
  }),
}));

function stat(overrides: Record<string, unknown> = {}) {
  return {
    challenge_id: "c1",
    challenge_title: "Two Sum",
    description: "Find two numbers that add up to a target.",
    language: "python",
    total_runs: 3,
    completed_runs: 2,
    failed_runs: 1,
    avg_score: 75,
    best_score: 100,
    last_run_at: new Date().toISOString(),
    last_duration_ms: 1200,
    ...overrides,
  };
}

async function renderProfile() {
  const { container } = render(
    <MemoryRouter initialEntries={["/profile"]}>
      <Routes>
        <Route
          path="/profile"
          element={
            <ToastProvider>
              <Profile />
            </ToastProvider>
          }
        />
        <Route path="/challenges/:id" element={<h1>Challenge detail</h1>} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByText("Evaluations by challenge");
  await waitFor(() => expect(container.querySelector("li")).toBeTruthy());
  return container;
}

/**
 * The first card in the grid, as a scope for the per-card assertions.
 *
 * The `<li>` is the grid *item* and the `Card` div inside it is what carries the
 * card's own styling, so the assertions read the inner element — which is also
 * how the duplicate-class bug showed up: the accent was on both.
 */
function firstCard(): HTMLElement {
  const grid = screen.getByRole("list");
  const item = within(grid).getAllByRole("listitem")[0]!;
  return item.querySelector<HTMLElement>('[class*="statsItem"]') ?? item;
}

beforeEach(() => {
  stats.current = [stat()];
  submissions.current = [];
  challenges.current = [];
});

describe("Profile: evaluations by challenge cards (#347)", () => {
  it("renders the cards as a list, so a screen reader announces a set", async () => {
    stats.current = [stat(), stat({ challenge_id: "c2", challenge_title: "Three Sum" })];
    await renderProfile();

    const grid = screen.getByRole("list");
    expect(within(grid).getAllByRole("listitem")).toHaveLength(2);
  });

  it("tints the card with the language's brand colour, from the shared source", async () => {
    // The point of using the accent is that "blue means Python" is learned once.
    // Asserting it equals `languageMeta(...).color` is what makes that true: a
    // hard-coded hex would pass a comparison against itself and drift.
    stats.current = [stat({ language: "go" })];
    const container = await renderProfile();

    const card = firstCard();
    // The accent is a custom property, so this reads what the page actually set
    // rather than what the stylesheet would like to do with it.
    const accent = card.style.getPropertyValue("--card-accent");
    expect(accent).toBe(languageMeta("go").color);
    // Not the generic grey an unknown language falls back to.
    expect(accent).not.toBe(languageMeta("nonexistent-language").color);
    expect(container).toBeTruthy();
  });

  it("pairs each stat with its label, so the numbers mean something", async () => {
    await renderProfile();
    const card = firstCard();

    // A `<dl>` with dt/dd pairs. A div of spans with the label baked into the
    // text ("3 runs") reads as a string, not as a value and a name.
    const list = card.querySelector("dl")!;
    expect(list).toBeTruthy();
    const terms = within(list).getAllByRole("term").map((t) => t.textContent);
    expect(terms).toEqual(["Score", "Runs", "Last run"]);

    const values = within(list)
      .getAllByRole("definition")
      .map((d) => d.textContent);
    expect(values).toEqual(["75%", "3", "1.2s"]);
  });

  it("says 'not measured' rather than printing a zero duration", async () => {
    // A run that never produced a result has no duration. Rendering 0 would read
    // as "instant", which is a different and wrong claim.
    stats.current = [stat({ last_duration_ms: null })];
    await renderProfile();

    const list = firstCard().querySelector("dl")!;
    const values = within(list)
      .getAllByRole("definition")
      .map((d) => d.textContent);
    expect(values).toEqual(["75%", "3", "—"]);
    // And the em dash is explained, because on its own it is just a missing value.
    expect(
      within(list).getByLabelText("last run: not measured"),
    ).toBeTruthy();
  });

  it("keeps the link on the title, so the accessible name is not a paragraph", async () => {
    await renderProfile();
    const card = firstCard();

    const link = within(card).getByRole("link", { name: "Two Sum" });
    expect(link).toHaveAttribute("href", "/challenges/c1");
    // Exactly one link per card. A card wrapped in its own <a> would nest the
    // title link and produce a second, larger link with the whole grid's text
    // as its name.
    expect(within(card).getAllByRole("link")).toHaveLength(1);
  });

  it("makes the whole card the hit area via a stretched ::after", async () => {
    // The behaviour cannot be checked in jsdom (no layout, no hit testing), so
    // the lock is that the mechanism is there at all. `e2e/profile.spec.ts`
    // measures the box for real.
    expect(profileCss).toMatch(/\.statsTitle::after\s*\{[\s\S]*?position:\s*absolute/);
    expect(profileCss).toMatch(/\.statsTitle::after\s*\{[\s\S]*?inset:\s*0/);
  });

  it("keeps the whole description in the DOM and describes it for a keyboard", async () => {
    await renderProfile();
    const card = firstCard();

    // The text is in full, not sliced in JS: cutting it here would throw the
    // tail away for screen readers and for anyone who widens the window. The
    // `<p>` is matched by class because the tooltip bubble holds the same string,
    // so `getByText` is ambiguous by design.
    const description = card.querySelector('[class*="statsDescription"]')!;
    expect(description).toHaveTextContent(
      "Find two numbers that add up to a target.",
    );

    // And it is described, so a keyboard user can reach it without a pointer.
    const bubble = within(card).getByRole("tooltip", { hidden: true });
    expect(bubble).toHaveTextContent("Find two numbers that add up to a target.");
    expect(description).toHaveAttribute("aria-describedby", bubble.id);
  });

  it("opens the description tooltip on focus, not only on hover", async () => {
    // The requirement was "tooltips assist truncated content, keyboard
    // accessible" — a hover-only tooltip satisfies half of it.
    await renderProfile();
    const card = firstCard();
    const bubble = within(card).getByRole("tooltip", { hidden: true });

    const trigger = card.querySelector<HTMLElement>(
      '[class*="statsDescription"]',
    )!.parentElement!;
    trigger.focus();
    fireEvent.focus(trigger);

    expect(bubble).toHaveAttribute("data-open");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(bubble).not.toHaveAttribute("data-open");
  });

  it("reports failed runs, since a card that hides them flatters the score", async () => {
    stats.current = [stat({ failed_runs: 2 })];
    await renderProfile();
    expect(firstCard()).toHaveTextContent("2 failed");
  });

  it("leaves the failed count out entirely when nothing failed", async () => {
    stats.current = [stat({ failed_runs: 0 })];
    await renderProfile();
    expect(firstCard()).not.toHaveTextContent("failed");
  });

  it("omits the description block when the challenge has none", async () => {
    // A tooltip on an empty string is a bubble with nothing in it.
    stats.current = [stat({ description: "" })];
    const container = await renderProfile();
    expect(container.querySelector('[class*="statsDescription"]')).toBeNull();
  });

  it("shows an em dash rather than a score when nothing has completed", async () => {
    // avg_score is null, not 0, and 0% would be a claim about quality.
    stats.current = [stat({ avg_score: null, best_score: null, completed_runs: 0 })];
    await renderProfile();

    const values = within(firstCard().querySelector("dl")!)
      .getAllByRole("definition")
      .map((d) => d.textContent);
    expect(values[0]).toBe("—");
  });
});
