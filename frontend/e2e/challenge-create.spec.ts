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

/**
 * Sub-pixel slack on a 44px hit target, for the float error in the rects — not
 * for a pill that is genuinely short (#404).
 *
 * The difficulty tag is `height: 44px`, and `offsetHeight` reports exactly 44 on
 * every run, so the layout never missed the target. What moved was the *report*:
 * `getBoundingClientRect` is measured while this page's `fadeInUp` entrance is
 * still translating (the test does not set `reducedMotion`), and a transformed
 * rect is returned from the compositor path in float32. Near y≈530 one ULP is
 * 2**-15 = 0.0000305px, so `bottom - top` came back as `43.999969482421875` — the
 * same 44px box, one rounding step short — and the old bare `>= 44` failed on
 * it. #404 surfaced it because centralising the page header moved the form down
 * ~32px (the field sits at y≈486 instead of y≈454), which changed which frame the
 * measurement lands in; dev passes the same assertion today and would fail the
 * same way on the next shift.
 *
 * 0.05px is three orders of magnitude above that artefact and four below the
 * ~19px the visual sweep originally measured (25.2px tags), so a real
 * regression still fails loudly — the same shape of call as #400's
 * `CENTRE_TOLERANCE_PX`, and the same lesson as #399: an exact boundary is only
 * trustworthy once it has been measured at the offsets it will be read at.
 */
const HIT_TARGET_TOLERANCE_PX = 0.05;

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

  test("each difficulty tag owns its own hit area, so a click selects that difficulty", async ({
    page,
  }) => {
    await openCreateForm(page);

    // Issue #346 renders the difficulty row as plain tags with the radios hidden
    // behind them. That overlay is an absolutely positioned radio at `inset: 0`,
    // which resolves against its nearest *positioned* ancestor — and the label was
    // not one. Measured in Chromium, all three radios came out at 1280×720: the
    // whole viewport, stacked, last one on top. Clicking "Easy" checked "Hard",
    // and Playwright reported it as `…<input value="hard">… intercepts pointer
    // events`.
    //
    // This is asserted against geometry rather than inferred from the fact that
    // `.check()` works, because the bug's signature *is* the geometry: a
    // `pointer-events` overlay that covers everything still lets the last element
    // win, so a naive "click works" probe would have passed on whichever tag
    // happened to be on top.
    const measured = await page.evaluate(() => {
      const labels = [...document.querySelectorAll("label")].filter((l) =>
        l.querySelector<HTMLInputElement>('input[name="difficulty"]'),
      );
      return labels.map((label) => {
        const radio = label.querySelector<HTMLInputElement>('input[name="difficulty"]')!;
        const r = radio.getBoundingClientRect();
        const l = label.getBoundingClientRect();
        return {
          value: radio.value,
          // Does the radio stay inside its own tag, or has it escaped to the page?
          withinOwnTag: r.top >= l.top - 1 && r.left >= l.left - 1,
          // And is it roughly tag-sized, rather than viewport-sized?
          notViewportSized: r.width < l.width * 2 && r.height < l.height * 2,
        };
      });
    });

    expect(measured).toHaveLength(3);
    for (const m of measured) {
      expect(m.withinOwnTag, `${m.value}'s radio escaped its own tag`).toBe(true);
      expect(m.notViewportSized, `${m.value}'s radio covers more than its tag`).toBe(true);
    }

    // The behaviour itself, on each tag in turn — not just the checked one.
    for (const value of ["easy", "hard", "medium"]) {
      await page.locator(`label:has(input[name="difficulty"][value="${value}"])`).click();
      await expect(page.getByRole("radio", { name: new RegExp(value, "i") })).toBeChecked();
    }
  });

  test("the plain difficulty pill is a 44px target without growing the tag (#364)", async ({
    page,
  }) => {
    await openCreateForm(page);

    // WCAG 2.5.5 AAA, and the visual sweep's only `touch-target-small`:
    // `.radioHidden` is an `inset: 0` overlay, so the control's activation box
    // *is* the label box, and a label with `padding: 0` is exactly as tall as
    // the badge inside it. At 25.2px the sweep filed 12 instances (55×25px here,
    // 46×25px on the filter bar).
    //
    // Measured as the union of the radio and its label, because that is the box a
    // click can actually land on and it is what the audit rule uses — the radio
    // alone resolves to the label's *padding* box, 2px shorter than the border
    // box, so asserting on the input directly would fail on a correct fix.
    //
    // Paired with "the tag did not grow", because the two failure modes are
    // opposites and only asserting the first would accept padding that made
    // every difficulty a fat 44px pill instead of a 23px tag with room to tap.
    const pills = await page
      .getByRole("group", { name: "Difficulty" })
      .locator("label")
      .evaluateAll((labels) =>
        labels.map((label) => {
          const radio = label.querySelector<HTMLInputElement>("input")!;
          const badge = label.querySelector("span span")!;
          const union = (a: DOMRect, b: DOMRect) => ({
            width: Math.max(a.right, b.right) - Math.min(a.left, b.left),
            height: Math.max(a.bottom, b.bottom) - Math.min(a.top, b.top),
          });
          const l = label.getBoundingClientRect();
          return {
            value: radio.value,
            hit: union(radio.getBoundingClientRect(), l),
            badge: {
              width: badge.getBoundingClientRect().width,
              height: badge.getBoundingClientRect().height,
            },
          };
        }),
      );

    expect(pills).toHaveLength(3);
    for (const p of pills) {
      expect(
        p.hit.width,
        `${p.value}'s target is under 44px wide`,
      ).toBeGreaterThanOrEqual(44 - HIT_TARGET_TOLERANCE_PX);
      expect(
        p.hit.height,
        `${p.value}'s target is under 44px tall`,
      ).toBeGreaterThanOrEqual(44 - HIT_TARGET_TOLERANCE_PX);
      // The rendered tag is still the tag, not the 44px box.
      expect(
        p.badge.height,
        `${p.value}'s tag grew to its target box — the hit area should be invisible`,
      ).toBeLessThan(p.hit.height);
    }

    // The three tags stay side by side rather than the row wrapping to a stack,
    // which a taller pill could have caused. Widths are unchanged by this fix, so
    // this is the cheap way to notice if a future change alters that.
    const tops = await page
      .getByRole("group", { name: "Difficulty" })
      .locator("label")
      .evaluateAll((labels) => labels.map((l) => Math.round(l.getBoundingClientRect().top)));
    expect(new Set(tops).size, "the difficulty pills wrapped onto separate rows").toBe(1);
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
