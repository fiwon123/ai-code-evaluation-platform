import { expect, test, type Page } from "@playwright/test";
import { mockApi } from "./data";

/**
 * The Home terminal story, in motion (issue #352).
 *
 * This is the one place the *sequence* is checked, and the interesting problem is
 * how to observe a ~5s animation without sleeping or racing it. Two rules decide
 * the shape of everything below:
 *
 *  1. No wall-clock waits (`no-wall-clock-sleeps.test.ts` enforces this for the
 *     Playwright suite too). Every assertion is a state wait: `toHaveText`,
 *     `toHaveAttribute`, and `expect.poll` re-querying the DOM.
 *  2. Assertions are about *invariants*, not about catching a specific frame.
 *     Sampling an animation is inherently lossy — the `results` stage is on
 *     screen for 420ms, and a loaded CI machine can step over it. So nothing
 *     here requires that a particular stage be sampled. What is asserted is that
 *     the stage never goes backwards, that the result rows only ever grow, that
 *     every sampled row-list is a prefix of the final one, and that the score is
 *     zero at every sample before the results are in. Those hold whether or not
 *     any given frame was caught, and a regression in the order breaks them.
 *
 * `landing.spec.ts` covers the resting state under emulated reduced motion; this
 * file covers the story itself, which reduced-motion readers never see.
 */

/** The sample run this file is written against, from `AnimatedTerminal`. */
const SAMPLE_TESTS = [
  "two_sum_basic",
  "two_sum_duplicates",
  "two_sum_unsorted",
] as const;

/**
 * A floor on the typing cadence, in absolute terms.
 *
 * Not imported from the hook: `tsconfig.e2e.json` deliberately keeps the e2e
 * project from reaching into `src/`, and the claim worth locking here is the
 * reader-facing one rather than the internal number. `TERMINAL_TIMING.typeMs` is
 * 24ms and the hook's own test pins it to the constant; what this file can
 * check without the coupling is that the prompt is typed at a human pace.
 * Anything faster than 10ms a character reads as a machine emptying a buffer,
 * which is the failure this guards.
 */
const MIN_TYPE_MS_PER_CHAR = 10;

/** The canonical stage order, indexed so "never goes backwards" is a number. */
const STAGE_ORDER = [
  "generating",
  "prompt",
  "running",
  "results",
  "score",
  "ready",
] as const;

/** Everything about the panel worth recording at one instant. */
interface Sample {
  stage: string;
  /** Row text in DOM order, with the verdict mark still attached. */
  rows: string[];
  /**
   * The same rows without their marks.
   *
   * A row's text is not stable: it reads `⋯name` while running and `✓name` once
   * resolved. Order and count are therefore asserted on the names, and the marks
   * are asserted separately. Comparing the marked text against the *final* rows
   * fails on every unresolved row, which is most of the story.
   */
  names: string[];
  /** Each row's `data-state`: `pending`/`running` while unresolved, `done` after. */
  states: string[];
  /** The ring's displayed percentage, parsed. */
  score: number;
  /** `data-scoring` — what actually triggers the ring. */
  scoring: string | null;
  /** `data-complete` — the ring's settled state, which outlives the trigger. */
  complete: string | null;
  /** The arc's resolved `animation-name`, `none` while it waits. */
  arc: string;
  /**
   * How much of the arc is actually drawn, as a fraction of the score's own arc
   * length: `0` empty, `1` full, and in between while it fills.
   *
   * `stroke-dasharray` is `<arc> <circumference>`, so an offset of exactly `arc`
   * hides the filled segment in the gap. Dividing the computed offset by the
   * arc length turns that into "how much is left to fill", which is the only
   * reading that can tell an empty ring from a full one.
   */
  arcUnfilled: number;
  /** How many characters of the prompt are on screen. */
  typed: number;
  /** The meta row's left-hand text: the tally once every row has resolved. */
  tally: string;
  /** `performance.now()` at the moment this sample was taken. */
  at: number;
}

/**
 * Collapse consecutive repeats from one field's series.
 *
 * The history holds one entry per change to *any* observed field, so a field
 * that is not currently moving repeats: the count-up runs while the stage sits on
 * `score`, so the row count reads 0, 0, 0, 1. The transitions are what matter.
 */
function transitions<T>(series: T[]): T[] {
  return series.filter((value, index) => index === 0 || value !== series[index - 1]);
}

/**
 * Have the *page* record its own history, and return it once the story settles.
 *
 * The first version of this polled from Node and it was wrong twice over. Polling
 * is lossy — a ~400ms window in which exactly one result row is visible can be
 * missed entirely, and `toHaveCount(1)` then fails on correct code for the same
 * reason it would pass on a regression that skipped the intermediate state. It
 * was also slower than the animation: a round-trip per sample accumulated about
 * 500ms of skew, which is what made the score look like it moved mid-suite.
 *
 * A `MutationObserver` on the document from before the app boots sees every
 * change the app makes, at the moment it makes it. Nothing is missed no matter
 * how loaded the machine is, and nothing here has to be fast. The DOM-reading
 * below is duplicated rather than shared with the Node-side assertions because
 * Playwright serialises an init script to send it to the browser, so it cannot
 * close over anything at module scope.
 *
 * Only changes in *observed state* are kept: the count-up alone produces ~60
 * samples a second and the landing page's ambient layers mutate for other
 * reasons, so a record is appended only when a tracked field differs from the
 * previous one.
 */
async function recordStory(page: Page, timeout = 30_000): Promise<Sample[]> {
  await page.addInitScript(() => {
    const store = window as unknown as {
      __terminalHistory: { key: string; sample: unknown }[];
    };
    store.__terminalHistory = [];
    const read = () => {
      const report = document.querySelector('[aria-label="Sample evaluation report"]');
      const status = document.querySelector('[class*="animStatus_"]');
      const rows = [...document.querySelectorAll('[class*="sampleTests_"] li')];
      const value = document.querySelector(".ringValue");
      const arc = document.querySelector(".ringProgress");
      return {
        stage: status?.getAttribute("data-stage") ?? "",
        rows: rows.map((row) => (row.textContent ?? "").trim()),
        names: rows.map((row) => (row.textContent ?? "").trim().slice(1)),
        states: rows.map((row) => row.getAttribute("data-state") ?? ""),
        score: Number.parseInt(value?.textContent ?? "", 10) || 0,
        scoring: report?.getAttribute("data-scoring") ?? null,
        complete: report?.getAttribute("data-complete") ?? null,
        arc: arc ? getComputedStyle(arc).animationName : "",
        // Inlined rather than calling `unfilledFraction` above: Playwright
        // serialises an init script to send it to the browser, so it cannot
        // close over anything at module scope. The first version did call it,
        // the observer threw a ReferenceError on every callback past mount, and
        // the history held exactly one sample — the pre-mount one, taken while
        // `arc` was still null and the ternary had not reached the call.
        arcUnfilled: arc
          ? Math.min(
              1,
              Math.max(
                0,
                Number.parseFloat(getComputedStyle(arc).strokeDashoffset) /
                  Number.parseFloat(
                    getComputedStyle(arc).getPropertyValue("--ring-arc"),
                  ),
              ),
            )
          : 1,
        typed: Number.parseInt(
          document.querySelector("[data-typed]")?.getAttribute("data-typed") ?? "",
          10,
        ) || 0,
        tally: (document.querySelector('[class*="sampleMetaRow_"] span')?.textContent ?? "").trim(),
        at: performance.now(),
      };
    };
    const record = () => {
      const sample = read();
      const history = store.__terminalHistory;
      const previous = history[history.length - 1];
      // Dedup on the fields a test can observe changing, but store the whole
      // sample: a CSS module hashes `@keyframes` as well as class names, so the
      // arc is compared on whether it is running, not on its scoped name.
      const key = JSON.stringify([
        sample.stage,
        sample.rows,
        sample.score,
        sample.scoring,
        sample.complete,
        sample.arc.includes("ringFill"),
        sample.typed,
        sample.tally,
        // Rounded: the fill is a continuous animation, and an unrounded value
        // would record a sample per frame and swamp the history.
        Math.round(sample.arcUnfilled * 20),
      ]);
      // `at` is deliberately not part of the key: the key decides *whether* this
      // is a new observation, and a timestamp differs every time.
      if (!previous || previous.key !== key) history.push({ key, sample });
    };
    // `addInitScript` runs at document-start, before there is a documentElement.
    // `observe(null)` throws, and the throw is silent from here: the test sees an
    // empty history rather than an error, which looks like a story that never
    // ran. So attach as soon as there is a root to attach to.
    const attach = () => {
      const root = document.documentElement;
      if (!root) {
        setTimeout(attach, 0);
        return;
      }
      new MutationObserver(record).observe(root, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      record();
    };
    attach();
  });

  await page.goto("/");
  await expect(page.getByLabel("Sample evaluation report")).toBeVisible();
  await expect(page.locator('[class*="animStatus_"]')).toHaveText("report ready", {
    timeout,
  });

  const history = await page.evaluate(
    () => (window as unknown as { __terminalHistory: { sample: unknown }[] }).__terminalHistory,
  );
  return history.map((entry) => entry.sample as Sample);
}

/**
 * Wait for the story to finish and its number to land.
 *
 * Two things this does not do. It is not a sleep: it waits on state, so a faster
 * machine finishes sooner. And it does not read the number off the last sample —
 * the `ready` stage and the count-up's final value are separate React commits, and
 * which lands first is a race (observed at 0, 65 and 67 on successive runs). So
 * the settled value is read from the DOM after waiting for it, which is the only
 * stable way to ask.
 */
async function settle(page: Page): Promise<string> {
  await expect(page.locator('[class*="animStatus_"]')).toHaveText("report ready", {
    timeout: 20_000,
  });
  const value = page.locator(".ringValue");
  await expect(value).toHaveText("67%", { timeout: 20_000 });
  return (await value.textContent()) ?? "";
}

test.describe("Home terminal story", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
  });

  test("runs its stages in order and settles on the finished report", async ({ page }) => {
    // Explicit, because the whole file is about motion and the fixture default
    // would otherwise depend on the config.
    await page.emulateMedia({ reducedMotion: "no-preference" });

    const samples = await recordStory(page);
    // Settle before reading the resting state, for the reason in `settle`.
    const settled = await settle(page);

    expect(settled).toBe("67%");
    expect(samples.at(-1)?.names).toHaveLength(3);

    // The exact stage sequence, every stage, in order.
    //
    // This file used to settle for something weaker — "these five stages were
    // sampled" — because a Node-side poller could miss a short one, and `results`
    // was dropped from the list for that reason. A `MutationObserver` cannot miss
    // a DOM change, so the caveat no longer applies and the strict form is both
    // available and better: it pins the order, catches a rewind (the old looping
    // status chip, which cycled ready → running → …) and catches a stage that
    // never ran, which the weak form could not see either way.
    //
    // Leading empty strings are samples taken before React mounted the panel,
    // where there is genuinely no stage yet.
    const stages = transitions(
      samples.map((sample) => sample.stage).filter((stage) => stage !== ""),
    );
    expect(stages.join(" → ")).toBe(STAGE_ORDER.join(" → "));
  });

  test("types the prompt one character at a time, at the designed cadence", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });

    const samples = await recordStory(page);

    // Every character, once, in order — no skips, no repeats, no going back.
    // The count is read off the last sample rather than written down here, so
    // shortening the prompt does not quietly turn this into a test of a number
    // nobody looked at again.
    const typed = transitions(
      samples.map((sample) => sample.typed),
    );
    const total = typed.at(-1) ?? 0;
    expect(total, "the prompt was never fully typed").toBeGreaterThan(0);
    expect(typed, `typed ${typed.length} observations for ${total} characters`)
      .toEqual(Array.from({ length: total + 1 }, (_, i) => i));

    // Typed at a readable pace. A *lower* bound on purpose: load can only make
    // the typing slower, so this cannot flake, and it is exactly the direction
    // that breaks when a gap is tuned down to the render cost and the chain
    // silently runs ahead of the design.
    const typingStarted = samples.find((sample) => sample.typed === 1);
    const typingFinished = samples.find((sample) => sample.typed === total);
    expect(typingStarted, "no sample caught the first character").toBeDefined();
    expect(typingFinished).toBeDefined();
    const typedFor = typingFinished!.at - typingStarted!.at;
    const perChar = typedFor / Math.max(total - 1, 1);
    expect(
      perChar,
      `typing ran at ${perChar.toFixed(1)}ms a character, faster than a reader can follow`,
    ).toBeGreaterThanOrEqual(MIN_TYPE_MS_PER_CHAR);

    // And the story finishes, rather than stalling part-way. A ceiling, but a
    // deliberately loose one: a slow machine makes this longer, and the point is
    // to catch a chain that stopped, not to benchmark the host.
    const elapsed = samples.at(-1)!.at - samples[0]!.at;
    expect(elapsed, `the story took ${Math.round(elapsed)}ms to settle`).toBeLessThan(20_000);
  });

  test("reveals the results one at a time, starting from none", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });

    // Read off the page's own history rather than polled for from here. Polling
    // missed the one-row window often enough to flake on correct code, and
    // `toHaveCount(3)` — the obvious alternative — passes just as happily for
    // three rows appearing at once, which is the regression.
    const samples = await recordStory(page);
    const counts = samples.map((sample) => sample.names.length);

    // Exactly the row counts the page passed through, in order: none at the
    // start, then each row as it resolves, and never a count that skips one. A
    // MutationObserver cannot miss a transition, so this is the whole claim
    // rather than a sample of it — including `results` being on screen at all,
    // which no assertion in this file used to be able to see.
    expect(
      transitions(counts),
      `row counts over the story: ${counts.join(" → ")}`,
    ).toEqual([0, 1, 2, 3]);
  });

  test("adds the results in order and never removes one", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });

    const samples = await recordStory(page);

    const finalNames = samples.at(-1)!.names;
    expect(finalNames).toEqual([...SAMPLE_TESTS]);

    // Every row list is a prefix of the final one, so rows are only ever appended
    // and never reordered. The old implementation declared `opacity: 0` in the
    // rule and relied on a `forwards` fill to undo it, which meant a row could be
    // in the DOM and invisible — a failure this property cannot see but that a
    // reader would.
    // Every sampled row list is a prefix of the final one. This is the "in order"
    // claim: a row that appeared out of sequence, or a duplicate, breaks the
    // prefix property without depending on having caught the exact frame.
    for (const sample of samples) {
      expect(sample.names, `rows out of order: ${sample.names.join(", ")}`).toEqual(
        finalNames.slice(0, sample.names.length),
      );
    }

    // It starts empty and ends full. Which intermediate lengths the sampler
    // happened to catch is not asserted: with rows 400ms apart and a poll
    // round-trip in the way, demanding a sample at every length is a race, and a
    // race is a flake that teaches people to re-run rather than to look.
    const lengths = samples.map((s) => s.names.length);
    expect(lengths[0], "results were present before the suite ran").toBe(0);
    expect(lengths.at(-1)).toBe(3);
  });

  test("marks a running test without a verdict, and a resolved one with one", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");

    // Start the wait *before* the rows are due, so the poller is already running
    // when the first one appears. Waiting for the first row and then looking for
    // the second would be a race against a 560ms gap.
    // The first row is due about 3.5s after the panel appears, so these waits
    // need more than the 5s default on a loaded machine.
    const first = page.locator('[class*="sampleTests_"] li').first();
    await expect(first).toBeVisible({ timeout: 15_000 });
    await expect(first).toContainText("two_sum_basic");

    // An unresolved row cannot carry ✓ or ✗ — it carries the pending mark, so a
    // passing-looking row never sits above a suite that has not resolved it.
    //
    // Stated as an invariant over every sample rather than by racing to look at
    // one: the first version waited for row two and asserted it read `⋯`, which
    // is a ~260ms window and a coin flip on a loaded machine. Checking the rule
    // on whatever rows each sample caught is true whenever it is evaluated, and
    // the sample that first shows a row is necessarily a pending one.
    const samples = await recordStory(page);
    for (const sample of samples) {
      sample.rows.forEach((row, index) => {
        const mark = row.slice(0, 1);
        const state = sample.states[index];
        if (state === "done") {
          expect(["✓", "✗"], `${sample.names[index]} resolved but shows "${mark}"`).toContain(mark);
        } else {
          expect(mark, `${sample.names[index]} is ${state} but shows "${mark}"`).toBe("⋯");
        }
      });
    }
    expect(
      samples.some((sample) => sample.states.some((state) => state !== "done")),
      "no unresolved row was ever observed, so the pending-mark rule was not checked",
    ).toBe(true);

    // The tally appears with the *last resolution*, not at the end of the story.
    // Gated on the story being over it sat under three resolved rows claiming
    // "running suite…" for the whole scoring beat; the screenshot is what caught
    // it, because the DOM said nothing wrong.
    for (const sample of samples) {
      // The *whole* run, not the rows on screen. `sample.states` only covers
      // revealed rows, so "every revealed row is done" is true after the first
      // one and would have accepted a tally reading "1 passed · 0 failed" under
      // a suite with two tests outstanding.
      const allResolved =
        sample.states.length === SAMPLE_TESTS.length &&
        sample.states.every((state) => state === "done");
      if (sample.states.length > 0) {
        expect(
          sample.tally,
          `${sample.states.filter((s) => s === "done").length} of ${SAMPLE_TESTS.length} resolved, tally reads "${sample.tally}"`,
        ).toEqual(allResolved ? expect.stringContaining("2 passed") : "running suite…");
      }
    }

    // The settled report: the marks match the names, and the tally agrees with
    // them — 2 + 1, and the score that means.
    const rows = page.locator('[class*="sampleTests_"] li');
    await expect(rows.nth(0)).toHaveText("✓two_sum_basic", { timeout: 20_000 });
    await expect(rows.nth(1)).toHaveText("✓two_sum_duplicates", { timeout: 20_000 });
    await expect(rows.nth(2)).toHaveText("✗two_sum_unsorted", { timeout: 20_000 });
    await expect(page.getByText("2 passed · 1 failed · 142 ms · pytest")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("img", { name: "Sample score 67 / 100" })).toBeVisible();

    // The mark and the name are separate elements and the mark is decorative, so
    // a row's accessible text is the test name alone.
    await expect(rows.nth(0).locator('[aria-hidden="true"]')).toHaveText("✓");
  });

  test("keeps the arc empty until the score stage, then fills it to the score", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });

    const samples = await recordStory(page);

    // Before the score stage the arc is not merely un-animated, it is empty.
    // Asserting the *geometry* is what makes this bite: the pre-fill shipped
    // with `animation-name: none` and a hardcoded offset in the keyframe, so it
    // satisfied every name-based assertion in the file while showing two thirds
    // of a filled ring next to a 0% number for the whole run.
    for (const sample of samples) {
      // "Empty" is the claim only until the score is out. Once the run is
      // complete the arc is *supposed* to be drawn — that is the resting state,
      // and it is why `data-complete` exists separately from the trigger.
      if (sample.scoring !== "true" && sample.complete !== "true") {
        // Close to, not exactly: the computed `stroke-dashoffset` comes back
        // rounded to two decimals, so the ratio is 0.99999… on a correct build.
        expect(
          sample.arcUnfilled,
          `at stage "${sample.stage}" (data-scoring=${sample.scoring}) the arc was ${(
            (1 - sample.arcUnfilled) * 100
          ).toFixed(0)}% drawn beside a score of ${sample.score}`,
        ).toBeGreaterThan(0.999);
      }
    }

    // And it ends filled, to the score rather than to a fixed offset.
    //
    // Read live, after the story settles, and not off the last history sample.
    // Reading a CSS-animated computed style inside a `MutationObserver` callback
    // is not a reliable read of the element that just changed: the callback can
    // run before the style recalc that dropped the animation, so the "settled"
    // entry recorded the still-animating value — 41% filled beside a resting
    // 67%, which is why this flaked once in a full run and never alone. A live
    // read once the page is quiet has no such window.
    const resting = await page.evaluate(() => {
      const arc = document.querySelector(".ringProgress");
      if (!arc) return null;
      const style = getComputedStyle(arc);
      return {
        offset: Number.parseFloat(style.strokeDashoffset),
        arc: Number.parseFloat(style.getPropertyValue("--ring-arc")),
      };
    });
    expect(resting, "no ring arc in the DOM").not.toBeNull();
    expect(resting!.arc).toBeGreaterThan(0);
    expect(
      Math.abs(resting!.offset),
      `at rest the arc is still ${(Math.abs(resting!.offset) / resting!.arc * 100).toFixed(0)}% unfilled`,
    ).toBeLessThan(0.5);
  });

  test("starts the score only once every result is in", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });

    const samples = await recordStory(page);

    // The score is zero for the whole of the run. A tally that counts itself up
    // while the suite is still going would contradict the rows above it.
    const early = samples.filter((s) => s.stage !== "ready" && s.stage !== "score");
    expect(early.length).toBeGreaterThan(0);
    for (const sample of early) {
      expect(sample.score, `score read ${sample.score} at stage "${sample.stage}"`).toBe(0);
    }

    // And once it does move, the results are already there.
    for (const sample of samples.filter((s) => s.score > 0)) {
      expect(
        sample.names.length,
        `the score moved before the results were in (${sample.names.length} rows)`,
      ).toBe(3);
    }

    // 66.7 is what `services/evaluation.py` computes for two of three passing
    // tests, and the panel used to claim 88 beside a visible ✗. Read after
    // settling, because the last *sample* is taken mid-commit.
    expect(await settle(page)).toBe("67%");
  });

  test("starts the ring when the story says so, not on a clock of its own", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");

    // The panel mounts a beat after load, and this test reads it directly rather
    // than polling — the previous version read the custom property straight after
    // `goto` and got `""` because the panel was not in the DOM yet.
    const report = page.getByLabel("Sample evaluation report");
    await expect(report).toBeVisible();

    // One number drives both halves of the ring. It is the shake — small, and
    // relative to the score stage — rather than the story's absolute score time
    // of about 5s, which is the version that desynced.
    const delay = await report.evaluate(
      (el) => getComputedStyle(el).getPropertyValue("--ring-delay").trim(),
    );
    expect(delay, "--ring-delay should be set by the component").toMatch(/^\d+(\.\d+)?ms$/);
    expect(Number.parseFloat(delay)).toBeGreaterThan(0);
    // Under a second: a slip of this size is invisible, a slip of 5s was a lie.
    expect(Number.parseFloat(delay)).toBeLessThan(1000);

    // The arc is *gated*, not merely delayed: no animation until the story
    // enters the score stage.
    const arc = page.locator(".ringProgress");
    await expect(arc).toHaveCSS("animation-name", "none");
    // And the digits are held at zero for the whole run, so nothing about the
    // ring moves while the suite is still going.
    await expect(page.locator(".ringValue")).toHaveText("0%");
  });

  test("the arc and the digits are triggered by the same stage", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });

    const samples = await recordStory(page);

    // The contract, stated as the invariant that actually broke: the number
    // moves if and only if the score stage is running, and the arc is animating
    // if and only if the score stage is running. The old design gated both on a
    // wall-clock deadline, so a story that ran late — which it always did under
    // load — had the ring at 26% with two of three tests outstanding.
    //
    // One direction only, and deliberately. "Score > 0 implies scoring" is the
    // claim that broke: the old deadline-based ring moved the number while the
    // suite ran. The converse is false *by design* — the shake runs before the
    // count-up, so for the first 400ms of the score stage the number is
    // deliberately still 0%, and asserting the other direction would be asserting
    // that the shake does not exist.
    for (const sample of samples) {
      if (sample.score > 0) {
        expect(
          sample.scoring === "true" || sample.stage === "ready",
          `the number moved (${sample.score}%) at stage "${sample.stage}", where data-scoring=${sample.scoring}`,
        ).toBe(true);
      }
    }
    // The shake — 400ms of the score stage where the digits are deliberately
    // still 0% — is deliberately NOT asserted here. It is a sub-second window in
    // a wall clock, and a loaded machine can starve the observer straight past
    // it, which it did: this file failed once in a full parallel run and passed
    // three times alone. Asserted on fake timers instead, in
    // `src/pages/landing.test.tsx`, where the window cannot be missed. A
    // sampling test for a timing claim is a flake wearing a test's clothes.

    // The arc's animation tracks the attribute exactly, never a timer.
    //
    // Matched by containment, not equality: a CSS module scopes its *keyframe
    // names* as well as its class names, so the computed value comes back as
    // `_ringFill_10lro_1`. The first version of this compared it to `ringFill`
    // and failed on correct code. `none` is a keyword and is not scoped, so that
    // side is still an exact match.
    for (const sample of samples) {
      const scoring = sample.scoring === "true";
      const running = sample.arc.includes("ringFill");
      expect(
        running,
        `at stage "${sample.stage}" the arc was "${sample.arc}" with data-scoring=${sample.scoring}`,
      ).toBe(scoring);
    }

    // And both did run: the assertion above is only meaningful if the scoring
    // stage was actually sampled. (A test that passed because nothing ever
    // triggered would look exactly like a test that passed because the trigger is
    // correct.)
    expect(samples.some((sample) => sample.scoring === "true"), "no scoring stage was observed").toBe(true);
    expect(samples.some((sample) => sample.score > 0), "the count-up never ran").toBe(true);
  });

  test("reduced motion gets the whole report at once, and nothing moving", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");

    const report = page.getByLabel("Sample evaluation report");
    // No story to wait for: the final state is the first state. These are
    // immediate reads rather than polls, which is the real assertion — a
    // `toBeVisible()` that has to retry would mean the state was not there yet.
    await expect(report).toBeVisible();
    await expect(page.locator('[class*="animStatus_"]')).toHaveText("report ready");
    await expect(page.locator('[class*="sampleTests_"] li')).toHaveCount(3);
    await expect(page.getByRole("img", { name: "Sample score 67 / 100" })).toBeVisible();
    await expect(page.locator(".ringValue")).toHaveText("67%");
    await expect(page.getByText("2 passed · 1 failed · 142 ms · pytest")).toBeVisible();

    // And nothing is animating: no arc fill, no shake, no pulsing dot. A
    // reduced-motion reader gets the content, not a slower version of the
    // animation — and `data-active` is off, so the dot is not mid-pulse.
    const motion = await page.evaluate(() => {
      const arc = document.querySelector(".ringProgress");
      const wrap = document.querySelector('[class*="scoreWrap_"]');
      const dot = document.querySelector('[class*="animStatusDot_"]');
      return {
        arc: arc ? getComputedStyle(arc).animationName : "",
        wrap: wrap ? getComputedStyle(wrap).animationName : "",
        dotActive: dot?.getAttribute("data-active"),
      };
    });
    expect(motion.arc, "the score arc should not animate").toBe("none");
    expect(motion.wrap, "the shake should not run").toBe("none");
    expect(motion.dotActive).toBe("false");
  });
});
