import { expect, test } from "@playwright/test";
import { mockApi } from "./data";

/**
 * Guest landing-page walkthrough.
 *
 * The Home page animates a typewriter + status chips; `reducedMotion` is
 * emulated so the terminal completes instantly and the assertions are stable.
 * `mockApi` guards the /demo CTA (the Demo page fetches /api/challenges on
 * mount).
 */
test.describe("Guest landing page", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockApi(page);
  });

  test("renders hero, sample report, and sample stats", async ({ page }) => {
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
    await expect(page.getByLabel("Sample evaluation report")).toBeVisible();
    await expect(page.getByText("two_sum_basic")).toBeVisible();
    await expect(page.getByText("two_sum_unsorted")).toBeVisible();
    await expect(page.getByText("Report ready")).toBeVisible();

    // Stats strip.
    await expect(page.getByText("Languages supported")).toBeVisible();
    await expect(page.getByText("Sample figures for the prototype")).toBeVisible();
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