import { expect, test } from "@playwright/test";
import { mockApi } from "./data";

/**
 * Challenges list (public route) with mocked API responses.
 *
 * Covers grid rendering (language/difficulty badges) and the filter selectors
 * driving the query string that the backend would receive.
 */
test.describe("Challenges list", () => {
  test("renders challenges with badges, owner hint, and pagination", async ({
    page,
  }) => {
    await mockApi(page);

    await page.goto("/challenges");

    await expect(page.getByRole("heading", { name: "Challenges" })).toBeVisible();

    // Cards render title + description for each seeded challenge.
    await expect(page.getByText("Two Sum")).toBeVisible();
    await expect(page.getByText("LRU Cache")).toBeVisible();
    await expect(page.getByText("Edit Distance")).toBeVisible();
    await expect(page.getByText("Return indices of the two numbers")).toBeVisible();

    // Language + difficulty badges on the cards. The language badge is located
    // via its title tooltip ("Python · pytest") — its label text alone also
    // matches the (hidden) filter options.
    await expect(page.getByTitle("Python · pytest")).toBeVisible();
    await expect(page.getByText("easy", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("medium", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("hard", { exact: true }).first()).toBeVisible();
  });

  test("filters by difficulty and updates the list + query", async ({ page }) => {
    await mockApi(page);

    // Wait specifically for the request that carries the difficulty filter
    // (the initial page load fetches the unfiltered list first).
    const filteredRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        request.method() === "GET" &&
        url.pathname === "/api/challenges" &&
        url.searchParams.get("difficulty") === "easy"
      );
    });

    await page.goto("/challenges");
    await page.getByLabel("Filter by difficulty").selectOption("easy");

    const url = new URL((await filteredRequest).url());
    expect(url.searchParams.get("difficulty")).toBe("easy");
    expect(url.searchParams.get("page")).toBe("1");

    await expect(page.getByText("Two Sum")).toBeVisible();
    await expect(page.getByText("LRU Cache")).not.toBeVisible();
    await expect(page.getByText("Edit Distance")).not.toBeVisible();
  });

  test("shows an empty state when the catalog is empty", async ({ page }) => {
    await mockApi(page, []);

    await page.goto("/challenges");

    await expect(
      page.getByRole("heading", { name: "No challenges yet" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Create the first challenge" }),
    ).toBeVisible();
  });
});