import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Profile from "./Profile.tsx";
import profileCss from "./Profile.module.css?raw";
import profileSource from "./Profile.tsx?raw";
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

/**
 * The bubble belonging to a specific trigger.
 *
 * A card has two tooltips — the score's and the description's — so
 * `getByRole("tooltip")` is ambiguous by design. Resolving from the trigger
 * (its wrapper is the Tooltip's own element) keeps each assertion about the
 * trigger it names, which is also how a reader meets them.
 */
function bubbleFor(trigger: Element): HTMLElement {
  return trigger.parentElement!.querySelector<HTMLElement>(
    '[role="tooltip"]',
  )!;
}

/** The `<dd>` values, with each tooltip's bubble text left out. */
function statValues(list: HTMLElement): string[] {
  return within(list)
    .getAllByRole("definition")
    .map((d) => (d.querySelector("[class*='statValueInner']") ?? d).textContent ?? "");
}

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
    expect(terms).toEqual(["Score", "Best", "Runs", "Last run"]);

    expect(statValues(list)).toEqual(["75%", "100%", "2/3", "1.2s"]);
  });

  it("treats an absent duration as unmeasured, not as a number", async () => {
    // Regression lock. The API sends `null`, and a `!== null` check treats a
    // *missing* field as a value: `formatDurationMs(undefined)` printed "NaNs"
    // on the card. An absent field and a null one mean the same thing.
    stats.current = [
      stat({ last_duration_ms: undefined as unknown as number | null }),
    ];
    await renderProfile();

    expect(statValues(firstCard().querySelector<HTMLElement>("dl")!)[3]).toBe("—");
    expect(
      within(firstCard()).getByLabelText("last run: not measured"),
    ).toBeTruthy();
  });

  it("says 'not measured' rather than printing a zero duration", async () => {
    // A run that never produced a result has no duration. Rendering 0 would read
    // as "instant", which is a different and wrong claim.
    stats.current = [stat({ last_duration_ms: null })];
    await renderProfile();

    const list = firstCard().querySelector<HTMLElement>("dl")!;
    expect(statValues(list)).toEqual(["75%", "100%", "2/3", "—"]);
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

    // And it is described, so a keyboard user is pointed at the full text.
    // The bubble belongs to the description, which is what carries the
    // `aria-describedby`.
    const bubble = bubbleFor(description);
    expect(bubble).toHaveTextContent("Find two numbers that add up to a target.");
    expect(description).toHaveAttribute("aria-describedby", bubble.id);
  });

  it("does not open the description on a bare focus event, which is what a click is", async () => {
    // The requirement was "tooltips assist truncated content, keyboard
    // accessible", so the keyboard path must open the bubble — but a mouse press
    // focuses the title too, and opening a bubble under the cursor as someone
    // clicks cancels the click: mousedown and mouseup land on different elements
    // and the browser never fires a click, so the card stops working for the
    // mouse. Hence `:focus-visible`, not "was focused".
    //
    // This asserts the half jsdom can see: jsdom's `:focus-visible` never matches,
    // which is exactly what a click looks like here, so the bubble must stay shut.
    // The keyboard half cannot be asserted in jsdom and is covered in
    // `e2e/profile.spec.ts` with a real browser and real Tab focus.
    await renderProfile();
    const card = firstCard();
    const bubble = bubbleFor(card.querySelector('[class*="statsDescription"]')!);

    fireEvent.focus(card.querySelector('[class*="statsTitle"]')!);
    expect(bubble).not.toHaveAttribute("data-open");
  });

  it("keeps the description dismissed after Escape, even while still hovered", async () => {
    // Regression lock, found in a real browser rather than jsdom. Closing the
    // bubble moves the element under the pointer, so the browser fires another
    // mouseover at the card — and a card that cleared its own "dismissed" flag
    // on hover reopened the bubble immediately. WCAG 1.4.13 wants it dismissed
    // until the pointer leaves.
    await renderProfile();
    const card = firstCard();
    const body = card.querySelector<HTMLElement>('[class*="statsBody"]')!;
    const bubble = bubbleFor(card.querySelector('[class*="statsDescription"]')!);

    fireEvent.mouseEnter(body);
    expect(bubble).toHaveAttribute("data-open");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(bubble).not.toHaveAttribute("data-open");

    // Still hovering: another mouseover must not undo the dismissal.
    fireEvent.mouseEnter(body);
    expect(bubble).not.toHaveAttribute("data-open");

    // Leaving and coming back brings it back, which is the "persistent" half.
    fireEvent.mouseLeave(body);
    fireEvent.mouseEnter(body);
    expect(bubble).toHaveAttribute("data-open");
  });

  it("opens the description tooltip when the card is hovered", async () => {
    await renderProfile();
    const card = firstCard();
    const bubble = bubbleFor(card.querySelector('[class*="statsDescription"]')!);
    expect(bubble).not.toHaveAttribute("data-open");

    fireEvent.mouseEnter(card.querySelector('[class*="statsBody"]')!);
    expect(bubble).toHaveAttribute("data-open");
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

  it("keeps the best score, which the old card printed and the redesign nearly lost", async () => {
    // Regression lock. The old card wrote "best 90% · 3 runs · 1 failed" as a
    // line of text. A redesign that drops a field because it no longer fits the
    // new layout is still a data loss, so Best is a stat of its own.
    stats.current = [stat({ avg_score: 75, best_score: 100 })];
    await renderProfile();

    const terms = within(firstCard().querySelector<HTMLElement>("dl")!)
      .getAllByRole("term")
      .map((t) => t.textContent);
    expect(terms).toEqual(["Score", "Best", "Runs", "Last run"]);
    expect(statValues(firstCard().querySelector<HTMLElement>("dl")!)[1]).toBe("100%");
  });

  it("counts completed runs, not just attempted ones", async () => {
    // An average over three completed runs is a different claim from an average
    // over four attempts, and the old card made the reader subtract to find out.
    stats.current = [stat({ total_runs: 4, completed_runs: 3 })];
    await renderProfile();

    expect(statValues(firstCard().querySelector<HTMLElement>("dl")!)[2]).toBe("3/4");
  });

  it("says why a score is blank rather than showing a bare em dash", async () => {
    stats.current = [stat({ avg_score: null, best_score: null, completed_runs: 0 })];
    await renderProfile();

    // Not a tooltip: the em dash is the app's "no value", and a blank score needs
    // saying out loud for the same reason a blank duration does.
    expect(
      within(firstCard()).getByLabelText("no completed runs yet"),
    ).toHaveTextContent("—");
  });

  it("shows an em dash rather than a score when nothing has completed", async () => {
    // avg_score is null, not 0, and 0% would be a claim about quality.
    stats.current = [stat({ avg_score: null, best_score: null, completed_runs: 0 })];
    await renderProfile();

    expect(statValues(firstCard().querySelector<HTMLElement>("dl")!)[0]).toBe("—");
  });
});

/**
 * Source-level locks for two #348 properties that no rendered assertion can see.
 *
 * Both are things the *build* cannot observe and jsdom actively hides:
 *
 *  - A CSS module's class names are hashed per build, so "the difficulty pill
 *    painted the danger tint" is unobservable here — the DOM says
 *    `_badge_x_1` either way. What *is* observable from source is whether the
 *    card reads the shared `DIFFICULTY_VARIANT` mapping or hand-rolls its own,
 *    and the hand-rolled copy is the real risk: it would drift from
 *    `utils/difficulty.ts` silently, and #346's contrast work would not reach it.
 *  - `Date.now()` inside a card compiles, runs, and renders a plausible value.
 *    The bug is temporal: the page's `useNow` only re-renders while something is
 *    in flight, so a card sampling the clock itself shows a "waiting 0s" that
 *    never moves. jsdom cannot catch that either, because nothing advances.
 */
describe("Profile list cards, at the source level", () => {
  // Comments are stripped first, for the reason `theme-contrast.test.ts` gives:
  // prose that merely *mentions* a pattern is not a use of it. This file's own
  // doc comment names `Date.now()` to explain why the card must not call it, and
  // a raw substring check reads that explanation as the bug.
  const body = (name: string) => {
    const start = profileSource.indexOf(`function ${name}(`);
    expect(start, `Profile.tsx must define ${name}`).toBeGreaterThan(-1);
    const next = profileSource.indexOf("\nfunction ", start + 1);
    return profileSource
      .slice(start, next === -1 ? undefined : next)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
  };

  it("reads the shared difficulty vocabulary instead of a local mapping", () => {
    const source = body("ChallengeListCard");
    expect(source).toContain("DIFFICULTY_VARIANT[");
    expect(source).toContain("difficultyLabel(");
    // A local map would be an object literal of easy/medium/hard next to the pill.
    expect(source).not.toMatch(/hard:\s*"(success|danger|warning)"/);
  });

  it("takes the page clock rather than reading Date.now() inside the card", () => {
    const source = body("SubmissionListCard");
    expect(source).toMatch(/\bnow:\s*number/);
    // The frozen-clock bug, spelled out.
    expect(source).not.toMatch(/Date\.now\(\)/);
  });
});
