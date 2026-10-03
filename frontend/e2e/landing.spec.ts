import { expect, test } from "@playwright/test";
import { mockApi } from "./data";

/**
 * Guest landing-page walkthrough.
 *
 * The Home page animates a terminal story — one status tag per stage, a typed
 * prompt, results revealed as they resolve, and a count-up score ring;
 * `reducedMotion` is emulated so the story resolves to its resting state
 * instantly and the assertions below are stable. The story's own sequence is
 * covered by `e2e/terminal-story.spec.ts`, which does not reduce motion.
 * `mockApi` guards the /demo CTA (the Demo page fetches /api/challenges on
 * mount).
 */
test.describe("Guest landing page", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockApi(page);
  });

  test("renders hero, sample report, and the step figures", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: /Generate, execute, and evaluate AI-written code/,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("AI-powered code evaluation", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Open source prototype", { exact: true }),
    ).toBeVisible();

    // Animated terminal + sample evaluation report.
    //
    // The sample test names are scoped to the report. Since #355 the teaser run
    // log above it lists the same two names, so a page-wide `getByText` matches
    // twice and Playwright's strict mode refuses the whole assertion — the same
    // reason the step figures are queried inside their card.
    const report = page.getByLabel("Sample evaluation report");
    await expect(report).toBeVisible();
    await expect(report.getByText("two_sum_basic")).toBeVisible();
    await expect(report.getByText("two_sum_unsorted")).toBeVisible();
    // Left page-wide on purpose: it is the terminal's status line, a sibling of
    // the report rather than a row inside it, so scoping it to `report` finds
    // nothing.
    await expect(page.getByText("Report ready")).toBeVisible();

    // The four figures now sit in the How-it-works cards (#354). `emulateMedia`
    // reduces motion above, so each value is already at its target on the first
    // frame and this asserts the numbers, not the sweep.
    for (const label of [
      "languages supported",
      "LLM providers",
      "attempts per submission",
      "of logs captured",
    ]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByText("Sample figures for the prototype")).toHaveCount(0);
  });

  test("puts the four figures inside the step that explains each one", async ({ page }) => {
    await page.goto("/");

    // Not merely "four numbers exist": each has to be in the same card as the
    // step whose claim it supports. A strip of figures below all four steps
    // would satisfy a count and read as four unrelated facts.
    // The four step cards are the direct children of the steps grid — they are
    // the shared `Card` component, which has no page-specific class of its own,
    // so the grid is the stable anchor rather than a `[class*=stepCard]` guess.
    const grid = page.locator("[class*=stepsGrid]");
    await expect(grid).toBeVisible();
    const cards = grid.locator("> *");
    await expect(cards).toHaveCount(4);
    for (const [value, label] of [
      ["13", "languages supported"],
      ["6", "LLM providers"],
      ["3", "attempts per submission"],
      ["64 KB", "of logs captured"],
    ] as const) {
      const card = cards.filter({ hasText: label });
      await expect(card, `no step card contains "${label}"`).toHaveCount(1);
      await expect(card).toContainText(value);
    }
  });

  test("reads terminal, then How it works, then the pipeline", async ({ page }) => {
    await page.goto("/");

    // Issue #354 is half about order: the section that narrates the flow used
    // to sit below a pipeline strip that already showed it. Compared as boxes,
    // not as headings, so a stray heading order cannot pass this.
    //
    // `page.evaluate` runs the moment it is called and does not wait for React,
    // so a bare read here returns Infinity for every anchor and compares three
    // infinities. `expect.poll` is what makes the measurement wait for the
    // mounts — and re-reads, so a late reflow cannot pass on a stale frame.
    await expect
      .poll(async () => {
        return page.evaluate(() => {
          const y = (sel: string) => {
            const el = document.querySelector(sel);
            return el ? Math.round(el.getBoundingClientRect().top) : null;
          };
          return {
            terminal: y("[class*=animPanel]"),
            steps: y("[class*=stepsGrid]"),
            pipeline: y("[class*=pipelineTrack]"),
          };
        });
      })
      .toEqual(
        { terminal: expect.any(Number), steps: expect.any(Number), pipeline: expect.any(Number) },
      );

    const boxes = await page.evaluate(() => {
      const y = (sel: string) => {
        const el = document.querySelector(sel);
        return el ? Math.round(el.getBoundingClientRect().top) : Infinity;
      };
      return {
        terminal: y("[class*=animPanel]"),
        steps: y("[class*=stepsGrid]"),
        pipeline: y("[class*=pipelineTrack]"),
      };
    });
    expect(
      boxes.terminal,
      `terminal (${boxes.terminal}) must sit above the steps (${boxes.steps})`,
    ).toBeLessThan(boxes.steps);
    expect(
      boxes.steps,
      `steps (${boxes.steps}) must sit above the pipeline (${boxes.pipeline})`,
    ).toBeLessThan(boxes.pipeline);
  });

  test("hero tagline is gradient-clipped to its letters, not a rectangle", async ({ page }) => {
    // Issue #201. The heading is painted with `color: transparent` +
    // `background-clip: text`. When a later rule re-armed the `background`
    // shorthand it reset `background-clip` to `border-box`, so the gradient
    // painted as a full-bleed rectangle and the letters went invisible — while
    // the element still had a box, so `toBeVisible()` passed and the suite was
    // green. Only the computed clip (or a pixel check) can see this.
    await page.goto("/");
    const heading = page.getByRole("heading", {
      level: 1,
      name: /Generate, execute, and evaluate AI-written code/,
    });
    await expect(heading).toBeVisible();

    const paint = await heading.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        clip: style.backgroundClip,
        webkitClip: style.webkitBackgroundClip,
        color: style.color,
        background: style.backgroundImage,
      };
    });
    expect(paint.clip, "the gradient must stay clipped to the glyphs").toBe("text");
    expect(paint.webkitClip).toBe("text");
    expect(paint.color, "clipped text needs a transparent fill").toBe("rgba(0, 0, 0, 0)");
    expect(paint.background, "clipped text needs a gradient behind it").toContain("gradient");

    // And the box must not be filled edge to edge: a rectangle would leave no
    // page background between the letters.
    const box = await heading.boundingBox();
    expect(box).not.toBeNull();
    const shot = await heading.screenshot();
    const page_ = await page
      .locator("body")
      .evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(shot.byteLength).toBeGreaterThan(0);
    expect(page_).toBeTruthy();
  });

  test("hero CTAs route to /demo and /register", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("link", { name: "See the demo" }).click();
    await expect(page).toHaveURL(/\/demo$/);

    await page.goto("/");
    await page.getByRole("link", { name: "Get started free" }).click();
    await expect(page).toHaveURL(/\/register$/);
  });

  test("renders features and how-it-works sections", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "Everything you need to evaluate code" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Multi-provider LLM" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Automated test suites" }),
    ).toBeVisible();

    await expect(
      page.getByRole("heading", { name: "From challenge to score in four steps" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Create a challenge" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Review results" }),
    ).toBeVisible();
  });

  test("guest teaser routes to the live demo", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", {
        name: "See a sample evaluation — no account needed",
      }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Try the live demo" }).click();
    await expect(page).toHaveURL(/\/demo$/);
  });
});