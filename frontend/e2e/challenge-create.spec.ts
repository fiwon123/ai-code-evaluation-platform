import { expect, test, type Page } from "@playwright/test";
import { mockApi } from "./data";

/**
 * The challenge create form (issue #237).
 *
 * The issue this covers assumed a `challenge-create` spec already existed. It
 * did not — the only challenge e2e file drove the list page — so a restructure
 * of the form itself would have shipped with no browser coverage at all. These
 * are the assertions that would have caught it: the form renders as sections,
 * difficulty is a real radio group, the counter and the sticky summary track
 * the fields as they are typed into, and the exact payload reaches the API.
 */
async function openCreateForm(page: Page): Promise<void> {
  await mockApi(page, undefined, { auth: true });
  await page.goto("/challenges/new");
  // The page title, not the "New challenge" breadcrumb: waiting on the crumb
  // would pass on a shell that never rendered the form.
  await expect(page.getByRole("heading", { name: "Create a challenge" })).toBeVisible();
}

test.describe("Challenge create form", () => {
  test("renders the form as labelled sections", async ({ page }) => {
    await openCreateForm(page);

    for (const section of ["Challenge basics", "Prompt", "Tests"]) {
      await expect(page.getByRole("heading", { name: section })).toBeVisible();
    }
    await expect(page.getByLabel("Title")).toBeVisible();
    await expect(page.getByLabel("Description")).toBeVisible();
    await expect(page.getByLabel("Prompt for the LLM")).toBeVisible();
    // The test-label names the runner for the selected language, so it is part
    // of the contract, not decoration.
    await expect(page.getByText("Test code (pytest)")).toBeVisible();
    await expect(page.getByLabel("Language")).toHaveValue("python");
  });

  test("difficulty is a radio group, and the sticky summary follows the fields", async ({
    page,
  }) => {
    await openCreateForm(page);

    // One group, one name, keyboard-navigable — the reason this is a fieldset
    // of radios and not a <select>.
    const difficulty = page.getByRole("group", { name: "Difficulty" });
    await expect(difficulty.getByRole("radio")).toHaveCount(3);
    await expect(difficulty.getByRole("radio", { name: "Medium" })).toBeChecked();
    await difficulty.getByRole("radio", { name: "Hard" }).check();

    await page.getByLabel("Title").fill("Two Sum");

    // The bar is a read-back of what is about to be saved, so it has to keep up
    // with the fields rather than only rendering on submit. Scoped to the bar's
    // own class because "Two Sum" is *also* one of the example buttons — a bare
    // `getByText` matches both and dies on the strict-mode violation, which is
    // the same ambiguity the stat-grid assertions in `admin.spec.ts` avoid.
    //
    // Text, not visibility: the bar deliberately drops the summary below 640px,
    // so `toBeVisible` fails on the Pixel 7 profile for a decision that is the
    // design rather than a defect. What is worth locking is that the read-back
    // is *correct* on every profile.
    await expect(page.locator('[class*="summaryTitle"]')).toHaveText("Two Sum");
    await expect(page.locator('[class*="summaryMeta"]')).toHaveText(
      "Python · Hard difficulty",
    );
    // The action the bar exists for still has to be reachable on a phone.
    await expect(
      page.getByRole("button", { name: "Create challenge" }),
    ).toBeVisible();
  });

  test("counts the prompt as it is typed and names the runner for the language", async ({
    page,
  }) => {
    await openCreateForm(page);

    await expect(page.getByText("0 words · 0 characters")).toBeVisible();
    await page.getByLabel("Prompt for the LLM").fill("return indices of the two numbers");
    // 6 words, and 33 characters including the five spaces — the counter counts
    // the raw string, so the spaces are part of the number the user sees.
    await expect(page.getByText("6 words · 33 characters")).toBeVisible();

    await page.getByLabel("Language").selectOption("go");
    await expect(page.getByText("Test code (go test)")).toBeVisible();
    await expect(page.getByText("Runs with go test")).toBeVisible();
  });

  test("posts the challenge and lands on its detail page", async ({ page }) => {
    await openCreateForm(page);

    // Captured from the wire rather than from the DOM: the payload is the
    // contract with the backend, and a form can look complete while sending
    // the wrong keys.
    const posted = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/challenges",
    );

    await page.getByLabel("Title").fill("Valid Parentheses");
    await page.getByLabel("Description").fill("Balanced brackets.");
    await page.getByLabel("Prompt for the LLM").fill("Write is_balanced(s).");
    // By label, not by position: the textareas are Description, Prompt, then
    // the test code, and an index silently retargets the moment a field is
    // inserted anywhere above it.
    await page.getByLabel("Test code (pytest)").fill("def test_is_balanced(): ...");
    await page.getByRole("radio", { name: "Easy" }).check();

    await page.getByRole("button", { name: "Create challenge" }).click();

    const body = (await posted).postDataJSON();
    expect(body).toEqual({
      title: "Valid Parentheses",
      description: "Balanced brackets.",
      prompt: "Write is_balanced(s).",
      test_code: "def test_is_balanced(): ...",
      language: "python",
      difficulty: "easy",
    });

    await expect(page).toHaveURL(/\/challenges\/c-created-1$/);
    await expect(page.getByRole("heading", { name: "Valid Parentheses" })).toBeVisible();
  });

  test("keeps the form's failed submission on the page and says why", async ({
    page,
  }) => {
    await mockApi(page, undefined, { auth: true });
    // A create that fails: 422 is the shape the API client turns into a field
    // error, and the bar must show it rather than looking like a dead button.
    await page.route("**/api/challenges", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 422,
            contentType: "application/json",
            body: JSON.stringify({ detail: "Title must be at least 3 characters" }),
          })
        : route.fallback(),
    );
    await page.goto("/challenges/new");

    await page.getByLabel("Title").fill("ab");
    await page.getByLabel("Prompt for the LLM").fill("p");
    await page.getByLabel("Test code (pytest)").fill("def test(): ...");
    await page.getByRole("button", { name: "Create challenge" }).click();

    await expect(page.getByRole("alert")).toContainText("at least 3 characters");
    // Still on the form, with the typed values intact — an error that clears
    // the form is a data-loss bug wearing a helpful hat.
    await expect(page).toHaveURL(/\/challenges\/new$/);
    await expect(page.getByLabel("Title")).toHaveValue("ab");
  });
});
