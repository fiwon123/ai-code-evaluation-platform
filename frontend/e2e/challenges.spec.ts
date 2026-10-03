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
    // matches the filter options.
    await expect(page.getByTitle("Python · pytest")).toBeVisible();
    // Scoped to each card by link, because the difficulty words are no longer
    // unique to the cards: the filter group renders the same "All / Easy /
    // Medium / Hard" pills, and a page-level `getByText("Easy")` matches both.
    await expect(
      page.getByRole("link", { name: /Two Sum/ }).getByText("Easy", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /LRU Cache/ }).getByText("Medium", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Edit Distance/ }).getByText("Hard", { exact: true }),
    ).toBeVisible();
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
    // A radio, not a `<select>`: the difficulty options are coloured badges and
    // a closed dropdown paints its own text over an option's colour. Reached by
    // role, which is also the assertion that the group is still labelled —
    // its `<legend>` is visually hidden to keep the bar on one line.
    await page
      .getByRole("radio", { name: "Easy", exact: true })
      .check();

    const url = new URL((await filteredRequest).url());
    expect(url.searchParams.get("difficulty")).toBe("easy");
    expect(url.searchParams.get("page")).toBe("1");

    await expect(page.getByText("Two Sum")).toBeVisible();
    await expect(page.getByText("LRU Cache")).not.toBeVisible();
    await expect(page.getByText("Edit Distance")).not.toBeVisible();
  });

  test("keeps the whole filter bar on one line", async ({ page }) => {
    await mockApi(page);
    await page.goto("/challenges");

    // The bar's whole point is that it is one row rather than the stacked
    // dropdown rows it replaced. Measured rather than eyeballed: the toolbar
    // and the filter group have to share a top edge, which only holds if
    // nothing inside the group wrapped onto a second line.
    const toolbar = page.locator('[class*="toolbar"]').first();
    const group = page.getByRole("group", { name: /Filter by difficulty/i });

    const toolbarBox = await toolbar.boundingBox();
    const groupBox = await group.boundingBox();
    expect(toolbarBox).not.toBeNull();
    expect(groupBox).not.toBeNull();
    // A wrapped group is taller than the row it sits in; this is the assertion
    // that fails if the legend is laid out again or the axis reverts to column.
    expect(groupBox!.height).toBeLessThanOrEqual(toolbarBox!.height);
  });

  test("parks each card's forward link at the right edge, under its arrow", async ({ page }) => {
    await mockApi(page);
    await page.goto("/challenges");

    // "View challenge →" is a forward affordance, so it belongs at the forward
    // edge of the card. It rendered from the left, pointing back across the card
    // (#397). Measured rather than asserted by class name, because the span was
    // a stretched flex child: the *box* was already full width, so only the text
    // inside it moved and a bounding-box check on its own would pass either way.
    const card = page.getByRole("link", { name: /Two Sum/ }).locator("div").first();
    const label = card.getByText("View challenge →", { exact: true });

    const cardBox = await card.boundingBox();
    const labelBox = await label.boundingBox();
    const titleBox = await card.locator("h2").boundingBox();
    expect(cardBox).not.toBeNull();
    expect(labelBox).not.toBeNull();
    expect(titleBox).not.toBeNull();

    // The trailing arrow ends flush with the content's right edge, where the
    // title's does — one pixel of tolerance for subpixel layout rounding.
    expect(labelBox!.x + labelBox!.width).toBeCloseTo(titleBox!.x + titleBox!.width, 0);
    // And the label is sized to its own text rather than stretched across the
    // card, which is the half that actually moved it off the left edge.
    expect(labelBox!.width).toBeLessThan(cardBox!.width / 2);
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