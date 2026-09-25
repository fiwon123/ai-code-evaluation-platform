import { expect, test } from "@playwright/test";
import { mockApi, TEST_USER, WRONG_PASSWORD } from "./data";

/**
 * Auth flows (API mocked — no backend required).
 *
 * The Login/Register pages surface inline errors via `role="alert"` (credential
 * endpoints never trigger the 401 redirect), and successful auth navigates to
 * /challenges, which fetches the mocked challenge list.
 */
test.describe("Authentication flows", () => {
  test("registers a new account and lands on challenges", async ({ page }) => {
    await mockApi(page);

    await page.goto("/register");
    await page.getByLabel("Email").fill(TEST_USER.email);
    await page.getByLabel("Username").fill(TEST_USER.username);
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL(/\/challenges$/);
    await expect(
      page.getByText("Account created. Welcome!", { exact: true }),
    ).toBeVisible();
    // Mocked challenge list rendered after redirect.
    await expect(page.getByText("Two Sum")).toBeVisible();
    await expect(page.getByText("LRU Cache")).toBeVisible();
  });

  test("logs in and lands on challenges", async ({ page }) => {
    await mockApi(page);

    await page.goto("/login");
    await page.getByLabel("Email or username").fill(TEST_USER.email);
    await page.getByLabel("Password").fill("password123");
    // Scope to the form — the navbar also exposes a "Log in" button.
    await page.locator("form").getByRole("button", { name: "Log in" }).click();

    await expect(page).toHaveURL(/\/challenges$/);
    await expect(page.getByText("Two Sum")).toBeVisible();
  });

  test("shows an inline error for invalid credentials and stays on /login", async ({
    page,
  }) => {
    await mockApi(page);

    await page.goto("/login");
    await page.getByLabel("Email or username").fill(TEST_USER.email);
    await page.getByLabel("Password").fill(WRONG_PASSWORD);
    await page.locator("form").getByRole("button", { name: "Log in" }).click();

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("alert")).toContainText(
      "Incorrect identifier or password",
    );
  });

  test("links between login and register", async ({ page }) => {
    // Navbar, footer, and the auth card all expose these links; every
    // "Sign up" routes to /register and every "Log in" to /login.
    await page.goto("/login");
    await page.getByRole("link", { name: "Sign up" }).first().click();
    await expect(page).toHaveURL(/\/register$/);

    await page.getByRole("link", { name: "Log in" }).first().click();
    await expect(page).toHaveURL(/\/login$/);
  });
});