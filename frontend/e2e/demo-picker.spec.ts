import { expect, test } from "@playwright/test";
import { mockApi } from "./data";

/**
 * The demo page's challenge picker, read the way a reader uses it.
 *
 * The unit tests in `Demo.test.tsx` assert the same filter, selection and
 * preview behaviour from the DOM. These exist for the things only a browser can
 * settle:
 *
 * 1. A native `<select>`'s selected option is painted by the OS in the OS's
 *    own colours, so the stripe is the only place the language accent can
 *    appear. If the CSS custom property never reached the element, jsdom would
 *    still report the inline style and the page would look unaccented.
 * 2. Reduced motion is a browser-level media setting, so the rail's gate can be
 *    settled honestly with `emulateMedia` rather than a stubbed `matchMedia`.
 */
/**
 * `STEP_CYCLE_MS` from `Demo.tsx`, restated so the reduced-motion wait below can
 * be checked against it. If the constant changes, the wait must change with it
 * or the assertion silently weakens into proving less than it claims.
 */
const STEP_CYCLE_MS = 2600;
/** The span the reduced-motion wait must exceed to mean anything. */
const REDUCED_MOTION_SPAN_MS = 9000;

test.describe("Demo challenge picker", () => {
  test.beforeEach(async ({ page }) => {
    // Signed in, because the guest wall replaces the runner controls entirely
    // (#349) — a guest cannot see the picker this spec is about.
    await mockApi(page, undefined, { auth: true });
  });

  test("accents the picker with the selected language's colour", async ({
    page,
  }) => {
    await page.goto("/demo");

    const filter = page.getByLabel("Filter by language");
    const challenge = page.getByLabel("Demo challenge");
    await expect(filter).toBeVisible();
    await expect(challenge).toBeVisible();

    // The catalog is much larger than the three fixture challenges, so the
    // control is built from the challenges. A language with nothing behind it
    // would narrow the list to empty, which is a dead end for the reader.
    await expect(filter.locator("option")).toHaveCount(4);
    await expect(filter.locator("option").first()).toHaveText("All languages");

    // Unfiltered is transparent rather than absent, so "is there a stripe"
    // is the stylesheet's decision in every state.
    const stripe = page.locator("[style*='--lang-accent']").first();
    const unfiltered = await stripe.evaluate(
      (el) => getComputedStyle(el).getPropertyValue("--lang-accent").trim(),
    );
    expect(unfiltered).toBe("transparent");

    // Go is the third fixture challenge (#007C91 in `languageMeta`).
    await filter.selectOption("go");
    await expect(challenge.locator("option")).toHaveCount(1);
    // Title only. The option used to read "Edit Distance — Go"; the language was
    // dropped from the text rather than moved, because one filter admits one
    // language at a time and the suffix would be identical on every option in
    // the list. The identity is on screen instead as the stripe below and the
    // preview's language badge — neither of which a closed `<select>` paints.
    await expect(challenge.locator("option").first()).toHaveText("Edit Distance");

    const accent = await stripe.evaluate(
      (el) => getComputedStyle(el).getPropertyValue("--lang-accent").trim(),
    );
    expect(accent.toLowerCase()).toBe("#007c91");

    // The accent has to be a real, painted stripe, not just a set variable.
    // `::before` is where the colour is drawn, so it is measured there.
    const painted = await stripe.evaluate((el) => {
      const bar = getComputedStyle(el, "::before");
      return {
        width: bar.width,
        background: bar.backgroundColor,
        content: bar.content,
      };
    });
    expect(painted.content).not.toBe("none");
    expect(painted.background.toLowerCase()).toContain("rgb(0, 124, 145)");
    expect(parseFloat(painted.width)).toBeGreaterThan(0);

    // …and the filter has to open again. This is the assertion that was
    // impossible to write while no option matched the unfiltered state: the
    // reader could narrow the list and never widen it, and the control painted
    // the first language the whole time (#394). Selecting by *label* rather than
    // by value, because the label is the thing the reader clicks.
    await filter.selectOption({ label: "All languages" });

    await expect(challenge.locator("option")).toHaveCount(3);
    await expect(filter).toHaveValue("");
    const widened = await stripe.evaluate(
      (el) => getComputedStyle(el).getPropertyValue("--lang-accent").trim(),
    );
    expect(widened).toBe("transparent");
  });

  test("keeps the preview on the visible challenge after narrowing", async ({
    page,
  }) => {
    await page.goto("/demo");

    const filter = page.getByLabel("Filter by language");
    const challenge = page.getByLabel("Demo challenge");
    await expect(challenge).toHaveValue("c-easy-1");

    // Start on a challenge the filter is about to hide.
    await challenge.selectOption("c-hard-1");
    await expect(page.getByText("Compute the minimum number of edits")).toBeVisible();

    await filter.selectOption("typescript");

    // The selection must not be left pointing at a Go option that is no longer
    // listed: the control would show a blank first entry and the preview would
    // keep showing a challenge the reader cannot see selected.
    await expect(challenge).toHaveValue("c-med-1");
    await expect(page.getByText("Design a data structure that follows the LRU")).toBeVisible();
    await expect(page.getByText("Compute the minimum number of edits")).toBeHidden();
  });

  test("cycles the walkthrough step, and holds it under reduced motion", async ({
    page,
  }) => {
    await page.goto("/demo");

    const currentStep = page.locator("[class*='stepActive'] h2");
    await expect(currentStep).toHaveText("Create a challenge");

    // One hold of STEP_CYCLE_MS, plus slack for the interval's own scheduling.
    await expect(currentStep).toHaveText("Submit for evaluation", {
      timeout: 12_000,
    });

    // Now the same page with the OS preference set. The gate has to be in JS:
    // a CSS opt-out cannot stop a `setInterval` from moving the highlight.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await expect(currentStep).toHaveText("Create a challenge");

    // This is two holds of STEP_CYCLE_MS of wall time.
    //
    // The claim under test is the *absence* of a change across that span, so
    // there is no state to wait on and wall-clock is the only way to say it.
    // This is the one sleep in this file, registered as an exemption in
    // `no-wall-clock-sleeps.test.ts`, which checks this phrase — deleting the
    // justification fails the lock.
    //
    // The span is asserted against the interval first: a shortened
    // STEP_CYCLE_MS would otherwise let this pass by proving less, and the
    // exemption's own `because` pattern checks this phrase, so deleting the
    // justification fails the lock.
    expect(REDUCED_MOTION_SPAN_MS).toBeGreaterThan(STEP_CYCLE_MS * 2);
    await page.waitForTimeout(REDUCED_MOTION_SPAN_MS);
    await expect(currentStep).toHaveText("Create a challenge");
  });

  test("leaves every walkthrough step in the DOM, since the cycle only emphasises", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/demo");

    // A reader arriving mid-cycle, or one who cannot see the animation, still
    // needs the whole walkthrough — highlighting one step must not hide three.
    for (const title of [
      "Create a challenge",
      "Submit for evaluation",
      "Code is generated & tested",
      "Review the report",
    ]) {
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
    }
  });
});
