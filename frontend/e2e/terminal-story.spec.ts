import { expect, test, type Page } from "@playwright/test";
import { mockApi } from "./data";

/**
 * The Home terminal story, in motion (issues #352, #389).
 *
 * The panel types one prompt and then tries it three times — 33.3, 66.7, 100 —
 * clearing its rows and its ring between attempts, so the story is ~8s rather than
 * ~5s. Three runs because one run can only ever put the ring in one band of the
 * score scale: the hero is the surface built to demonstrate that scale, and a
 * single run was the one thing that never showed it.
 *
 * This is the one place the *sequence* is checked, and the interesting problem is
 * how to observe an ~8s animation without sleeping or racing it. Two rules decide
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

/** The sample suite this file is written against, from `AnimatedTerminal`. */
const SAMPLE_TESTS = [
  "two_sum_basic",
  "two_sum_duplicates",
  "two_sum_unsorted",
] as const;

/**
 * What each attempt passes, in order, and the score that implies.
 *
 * Written out rather than imported: `tsconfig.e2e.json` deliberately keeps the
 * e2e project from reaching into `src/`, and the claim worth locking is the
 * reader-facing one — the panel says "2 passed" and shows a ring that means it.
 * Every attempt fixes one more test, so the marks accumulate rather than being
 * re-rolled, and the scores land on red, orange and green in that order.
 */
const SAMPLE_ATTEMPTS = [
  { passed: [true, false, false], score: "33%" },
  { passed: [true, true, false], score: "67%" },
  { passed: [true, true, true], score: "100%" },
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

/**
 * The canonical stage order, indexed so "never goes backwards" is a number.
 *
 * Written out in full, repetitions and all, because the repetition *is* the
 * claim: three runs of the same order with a `re-running` beat between them.
 * Collapsing this to a set would have accepted a story that ran once, or one that
 * rewound.
 */
const STAGE_ORDER = [
  "generating",
  "prompt",
  "running",
  "results",
  "score",
  "retrying",
  "running",
  "results",
  "score",
  "retrying",
  "running",
  "results",
  "score",
  "ready",
] as const;

/** Everything about the panel worth recording at one instant. */
interface Sample {
  stage: string;
  /**
   * The header's `attempt N of 3` tag, parsed to its number.
   *
   * Read rather than derived from the stage, because the tag is what a reader is
   * actually looking at: a story that re-resolved its rows three times without
   * saying so would pass every other assertion in this file.
   */
  attempt: number;
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
  /**
   * How much of the whole circle is actually drawn, 0–1.
   *
   * `arcUnfilled` answers "how far through *this* attempt's fill are we", which
   * was the whole claim while each attempt refilled the ring from empty. The ring
   * now holds the score it has reached between attempts (#389), so that reading is
   * 0 for the entire repair beat — correct, and blind to the thing that matters.
   * This one is absolute: the fraction of the circumference on screen, so it can
   * be compared against the digits beside it at any moment, filled or not.
   */
  drawn: number;
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
async function recordStory(page: Page, timeout = 60_000): Promise<Sample[]> {
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
      const arc = document.querySelector(".ringProgress") as SVGElement | null;
      const attempt = document.querySelector('[class*="animAttempt_"]');
      return {
        stage: status?.getAttribute("data-stage") ?? "",
        attempt:
          Number.parseInt(
            /attempt\s+(\d+)/.exec(attempt?.textContent ?? "")?.[1] ?? "",
            10,
          ) || 0,
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
        // What is actually drawn, read from the values React wrote rather than
        // from the animated computed style.
        //
        // `stroke-dasharray` is `<visibleArc> <circumference>` and lives on the
        // circle as an attribute; the two arc lengths are custom properties on the
        // parent `<svg>`, written in its `style` attribute. Both are read straight
        // off the DOM node, so this is a snapshot of the commit that just happened
        // — no style recalc, no animation.
        //
        // That last part is the whole point. The held fill is not the animated
        // `stroke-dashoffset`; it is the number the arc was told to hold. Outside a
        // score stage the animation is `none`, the offset is `--ring-arc -
        // --ring-arc-from`, and the drawn fraction is simply `--ring-arc-from /
        // circumference`. Reading the animated computed offset here is what
        // recorded a resting 67% fill beside a 32% number and failed a correct
        // page: inside a `MutationObserver` callback its computed value can lag
        // the recalc. The committed attribute cannot. Deriving the fill from the
        // hold also makes it constant across a hold, so the dedup key below stops
        // recording a sample per rAF frame of a settle.
        drawn: (() => {
          if (!arc) return 0;
          const parts = (arc.getAttribute("stroke-dasharray") ?? "")
            .split(/[\s,]+/)
            .map((part) => Number.parseFloat(part));
          const circumference = parts[1] ?? 0;
          if (!(circumference > 0)) return 0;
          const ringStyle = arc.closest("svg")?.getAttribute("style") ?? "";
          const held = Number.parseFloat(
            /--ring-arc-from\s*:\s*([^;]+)/.exec(ringStyle)?.[1] ?? "",
          );
          return Math.min(1, Math.max(0, (Number.isFinite(held) ? held : 0) / circumference));
        })(),
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
        sample.attempt,
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
        Math.round(sample.drawn * 20),
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
  // Scroll the panel into view before waiting on it, because that is what starts
  // the story: it is withheld until the panel is 15% on screen, and at 412px wide
  // the hero leaves 60px of a 413px panel below the fold — 14.5%, just under the
  // gate. Without this the whole file timed out on the Pixel 7 profile waiting for
  // a story that a reader on that phone would start by scrolling.
  //
  // Not a workaround for the test: it is the trigger, and the story is
  // deliberately *not* started on mount (a reader who never scrolls should not have
  // the whole thing play out behind the fold).
  await page.locator('[class*="animPanel_"]').scrollIntoViewIfNeeded();
  await expect(page.locator('[class*="animStatus_"]')).toHaveText("report ready", {
    timeout,
  });

  const history = await page.evaluate(
    () => (window as unknown as { __terminalHistory: { sample: unknown }[] }).__terminalHistory,
  );
  return history.map((entry) => entry.sample as Sample);
}

/**
 * Open the Home page and start the story.
 *
 * The scroll is the trigger, not a convenience: the panel is withheld until it
 * is 15% on screen (`useOnScreen`), and the Pixel 7 profile leaves 14.5% of it
 * above the fold. A test that navigates and then waits for the first result row
 * waits forever on that viewport — which is what happened once the story got
 * slower and a 15s wait expired with the element never added. Every test in this
 * file has to start the story the way a reader does.
 */
async function openStory(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByLabel("Sample evaluation report")).toBeVisible();
  await page.locator('[class*="animPanel_"]').scrollIntoViewIfNeeded();
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
 *
 * 100%, not 67% (#389): the ring climbs to the finished score, so a settled story
 * that stopped at the second attempt's tally would be a regression the helper
 * would have papered over — it is the last thing every story test reads.
 */
async function settle(page: Page): Promise<string> {
  await expect(page.locator('[class*="animStatus_"]')).toHaveText("report ready", {
    timeout: 30_000,
  });
  const value = page.locator(".ringValue");
  await expect(value).toHaveText("100%", { timeout: 30_000 });
  return (await value.textContent()) ?? "";
}

/**
 * The score-scale band the arc is currently painted with (#389) — the class on
 * the arc, with the shared `ringProgress` removed.
 *
 * Read from the class rather than from the computed `stroke` because the class is
 * the decision: four classes and four thresholds in the component, and the
 * computed colour would hide a band that resolved to the wrong token.
 */
async function bandOf(page: Page): Promise<string> {
  return page.evaluate(() => {
    const arc = document.querySelector(".ringProgress");
    return (arc?.getAttribute("class") ?? "").replace("ringProgress ", "");
  });
}

test.describe("Home terminal story", () => {
  // The story is now ~11s of real animation (three attempts, each with a slowed
  // count-up and a settle beat), against Playwright's 30s default. Alone that is
  // comfortable; fully parallel on a saturated host the chained `setTimeout`
  // timeline runs late, and a 30s cap failed a *correct* story at the scoring
  // stage. The budget is per-test, so raising it does not weaken an assertion —
  // `recordStory` and `settle` still poll for state and finish the moment the
  // story does.
  test.describe.configure({ timeout: 90_000 });

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

    expect(settled).toBe("100%");
    expect(samples.at(-1)?.names).toHaveLength(3);
    // The last thing on screen is the third attempt, and the panel says so.
    expect(samples.at(-1)?.attempt, "the story did not finish on its last attempt").toBe(3);

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
    //
    // And every attempt's tag is consistent with the stage around it: the three
    // runs are told apart by the header, so a reset that showed the *next*
    // attempt's rows under the previous attempt's number would read as two
    // attempts happening at once.
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
    //
    // 0 → 1 → 2 → 3, then the panel repairs rather than resets: attempt 1's two
    // failures come out one at a time (3 → 2 → 1) and are re-run (1 → 2 → 3), and
    // the last failure does the same (3 → 2 → 3).
    //
    // That middle descent is the whole point, so it is spelled out rather than
    // derived. A retry that emptied the panel would show 3 → 0 → 3 and read as a
    // reload; a retry that forgot to remove anything would show 3 → 3 and claim
    // the second attempt re-proved rows it had already passed.
    expect(
      transitions(counts),
      `row counts over the story: ${counts.join(" → ")}`,
    ).toEqual([0, 1, 2, 3, 2, 1, 2, 3, 2, 3]);
  });

  test("adds the results in order, and only ever removes a failure", async ({ page }) => {
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

    // Rows only ever *disappear* as failures being pulled out for another run, and
    // only during the repair beat. This is the claim that distinguishes a retry
    // from a re-run of everything: a ✓ taken off screen and put back says the
    // second attempt proved nothing, which is the story the panel used to tell.
    //
    // Checked over every pair of consecutive samples rather than at one moment,
    // so it holds whether or not any particular removal frame was caught — and
    // the removals themselves are asserted below, or the loop would pass vacuously
    // on a story that never removed anything.
    const removals: string[] = [];
    for (let i = 1; i < samples.length; i += 1) {
      const previous = samples[i - 1]!;
      const sample = samples[i]!;
      if (previous.names.length <= sample.names.length) continue;
      expect(
        sample.stage,
        `rows disappeared at stage "${sample.stage}", which is not the repair`,
      ).toBe("retrying");
      for (const row of previous.rows.slice(sample.names.length)) {
        expect(
          row.slice(0, 1),
          `a ✓ was taken off screen and will be put back ("${row}")`,
        ).not.toBe("✓");
        removals.push(row);
      }
    }
    expect(
      removals.length,
      "no row was ever removed, so the retry is re-running the whole suite",
    ).toBeGreaterThan(0);
    // Only the failures, and off the end: attempt 1's `unsorted` then
    // `duplicates`, then attempt 2's `unsorted` again. Nothing else goes — the
    // `basic` row that passed first time is on screen for the whole story, and
    // `duplicates` is the one row that is removed, re-run and comes back green.
    expect(removals).toEqual([
      "✗two_sum_unsorted",
      "✗two_sum_duplicates",
      "✗two_sum_unsorted",
    ]);

    // And the failure is gone by the time the repair ends. The row being taken
    // away is still red *while* it goes — that is the removal, and asserting it
    // away was asserting that the previous attempt's verdict had already been
    // replaced by the next one's before the re-run that earns it, which is the
    // defect this test caught in the browser. What must not survive is a ✗ the
    // repair has finished with.
    const lastRepair = new Map<number, Sample>();
    for (const sample of samples) {
      if (sample.stage === "retrying") lastRepair.set(sample.attempt, sample);
    }
    expect(lastRepair.size, "no repair was sampled").toBeGreaterThan(0);
    for (const [attempt, sample] of lastRepair) {
      expect(
        sample.rows.filter((row) => row.startsWith("✗")),
        `attempt ${attempt}'s repair ended with a failure still on screen`,
      ).toEqual([]);
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
    await openStory(page);

    // Start the wait *before* the rows are due, so the poller is already running
    // when the first one appears. Waiting for the first row and then looking for
    // the second would be a race against a 560ms gap.
    // The first row is due a beat after the panel appears, so this wait needs
    // room on a loaded machine beyond the 15s `expect` default.
    const first = page.locator('[class*="sampleTests_"] li').first();
    await expect(first).toBeVisible({ timeout: 30_000 });
    await expect(first).toContainText("two_sum_basic");

    // An unresolved row cannot carry ✓ or ✗ — it carries the pending mark, so a
    // passing-looking row never sits above a suite that has not resolved it.
    //
    // Stated as an invariant over every sample rather than by racing to look at
    // one: the first version waited for row two and asserted it read `⋯`, which
    // is a ~220ms window and a coin flip on a loaded machine. Checking the rule
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
    //
    // Checked against the tally the attempt in question actually earned, so the
    // three runs' differing pass counts are part of the assertion rather than a
    // hardcoded "2 passed" that only the middle attempt would satisfy.
    for (const sample of samples) {
      // The *whole* run, not the rows on screen. `sample.states` only covers
      // revealed rows, so "every revealed row is done" is true after the first
      // one and would have accepted a tally reading "1 passed · 0 failed" under
      // a suite with two tests outstanding.
      const allResolved =
        sample.states.length === SAMPLE_TESTS.length &&
        sample.states.every((state) => state === "done");
      if (sample.states.length === 0) continue;
      const attempt = SAMPLE_ATTEMPTS[sample.attempt - 1];
      expect(attempt, `sample claims attempt ${sample.attempt}, which is not one of them`).toBeDefined();
      const earned = attempt!.passed.filter(Boolean).length;
      if (allResolved) {
        expect(
          sample.tally,
          `attempt ${sample.attempt} resolved every test, tally reads "${sample.tally}"`,
        ).toContain(`${earned} passed`);
        // And nothing failed on the run that passes everything.
        if (earned === SAMPLE_TESTS.length) {
          expect(sample.tally).toContain("0 failed");
        }
      } else {
        expect(
          sample.tally,
          `${sample.states.filter((s) => s === "done").length} of ${SAMPLE_TESTS.length} resolved, tally reads "${sample.tally}"`,
        ).toBe("running suite…");
      }
    }

    // The settled report: the marks match the names, and the tally agrees with
    // them — the third attempt's 3 + 0, and the full ring that means.
    const rows = page.locator('[class*="sampleTests_"] li');
    await expect(rows.nth(0)).toHaveText("✓two_sum_basic", { timeout: 20_000 });
    await expect(rows.nth(1)).toHaveText("✓two_sum_duplicates", { timeout: 20_000 });
    await expect(rows.nth(2)).toHaveText("✓two_sum_unsorted", { timeout: 20_000 });
    await expect(page.getByText("3 passed · 0 failed · 142 ms · pytest")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("img", { name: /attempt 3 of 3 100 \/ 100/ })).toBeVisible();

    // The mark and the name are separate elements and the mark is decorative, so
    // a row's accessible text is the test name alone.
    await expect(rows.nth(0).locator('[aria-hidden="true"]')).toHaveText("✓");
  });

  test("holds the arc at the score it has reached, and never rewinds it", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });

    const samples = await recordStory(page);

    // The arc's held fraction, sampled from the commit rather than from the
    // animation, so it is the geometry of the hold and not a frame of the sweep.
    // Outside a score stage the ring holds 0% while the first suite runs, 33%
    // while attempt 1's failures are pulled out, 67% through attempt 2's, and
    // 100% at rest.
    //
    // This is what makes the test bite. The pre-fill shipped with
    // `animation-name: none` and a hardcoded offset in the keyframe, so it
    // satisfied every name-based assertion in this file while showing two thirds
    // of a filled ring next to a 0% number for the whole run — the arc pinned at
    // its *target* from the first frame.
    //
    // Deliberately NOT `expect(drawn).toBeCloseTo(score / 100)`: the arc's hold is
    // React state and lands with the commit, while the digits are a
    // `requestAnimationFrame` loop. On a saturated host the main thread can starve
    // the loop past a stage boundary and the number reads 0 beside a held 33%
    // without anything being wrong on screen — a frame later it lands. Comparing
    // the two frame by frame was asserting that two clocks agree, and it flaked.
    // The number's agreement with the arc is asserted where it can be, on fake
    // timers: `src/pages/landing.test.tsx` and `useCountUp.test.ts`.
    const holds = samples
      .filter((sample) => sample.scoring !== "true" && sample.complete !== "true")
      .map((sample) => sample.drawn);
    expect(
      transitions(holds.map((hold) => Math.round(hold * 100))),
      "the arc must stop at the scores the attempts reached",
    ).toEqual([0, 33, 67]);
    // And the digits never get ahead of the arc: the arc is the authority on the
    // score, so a number above the held fill is the ring claiming more than it has
    // been given — the "emptied between attempts" defect, seen from the number.
    for (const sample of samples) {
      if (sample.scoring === "true" || sample.complete === "true") continue;
      expect(
        sample.score / 100,
        `at stage "${sample.stage}" the number was ${sample.score}% above a ${(sample.drawn * 100).toFixed(0)}% arc`,
      ).toBeLessThanOrEqual(sample.drawn + 0.06);
    }

    // And it only ever goes up. Sampled off the history rather than off three
    // chosen moments, so it holds for a story that was faster or slower than this.
    const drawn = samples.map((sample) => sample.drawn);
    for (let i = 1; i < drawn.length; i += 1) {
      expect(
        drawn[i],
        `the ring went backwards: ${drawn.slice(0, i + 1).map((d) => `${Math.round(d * 100)}%`).join(" → ")}`,
      ).toBeGreaterThanOrEqual(drawn[i - 1]! - 0.02);
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

    // The score is zero for the whole of the *first* run. A tally that counts
    // itself up while the suite is still going would contradict the rows above it.
    //
    // Zero rather than "not moving" on purpose: after the first score stage the
    // ring holds its value through the repair beats, so a number that dropped back
    // to 0 there would be correct by this test's old rules and wrong by the design
    // — the panel would be showing three runs rather than one ring climbing.
    const firstScore = samples.findIndex((sample) => sample.stage === "score");
    expect(firstScore, "the story never scored").toBeGreaterThan(0);
    for (const sample of samples.slice(0, firstScore)) {
      expect(sample.score, `score read ${sample.score} at stage "${sample.stage}"`).toBe(0);
    }
    // Which is also why the ring cannot be the thing that re-proves a row: from
    // here on it only ever goes up.
    const after = samples.slice(firstScore).map((sample) => sample.score);
    for (let i = 1; i < after.length; i += 1) {
      expect(after[i], "the score rewound").toBeGreaterThanOrEqual(after[i - 1]!);
    }

    // And every score stage counts over the whole suite: three rows, the same
    // three the attempt ran. Scoped to the score stages because that is where the
    // number moves — a held score during a repair sits above a panel that is
    // deliberately down to the rows that still need running.
    for (const sample of samples.filter((s) => s.stage === "score")) {
      expect(
        sample.names.length,
        `a score stage counted to ${sample.score} with ${sample.names.length} rows`,
      ).toBe(3);
    }

    // And every attempt reaches its own score, in order: 33.3, 66.7 and 100 are
    // what `services/evaluation.py` computes for one, two and three of three
    // passing tests, and the panel used to claim 88 beside a visible ✗.
    //
    // Read from the settled DOM rather than the history, because the last
    // *sample* is taken mid-commit.
    const scores = SAMPLE_ATTEMPTS.map((attempt) => attempt.score);
    expect(scores).toEqual(["33%", "67%", "100%"]);
    expect(await settle(page)).toBe("100%");
  });

  test("starts the ring when the story says so, not on a clock of its own", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openStory(page);

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

    // The contract, stated as the invariant that actually broke: the number moves
    // only while the score stage is running, and the arc is animating if and only
    // if the score stage is running. The old design gated both on a wall-clock
    // deadline, so a story that ran late — which it always did under load — had
    // the ring at 26% with two of three tests outstanding.
    //
    // Stated as *changes* rather than as a value, because the ring now holds its
    // score between attempts: 33% at a stage that is not `score` is the hold and
    // is correct, and only a number that moves is a violation. The old form of
    // this assertion ("score > 0 implies scoring") was the claim that broke when
    // the deadline-based ring moved the number while the suite ran; it has to
    // become this one rather than be weakened, or it would now pass for the wrong
    // reason — every hold would look like a failure.
    const moves = samples.filter(
      (sample, index) => index > 0 && sample.score !== samples[index - 1]!.score,
    );
    expect(moves.length, "the number never moved, so the trigger was not checked").toBeGreaterThan(0);
    // A `running` stage must never show a number above the score it is holding
    // from the attempt before. That is the defect, stated without racing a
    // timer: the broken ring reached 26% while attempt 1's three tests were
    // still resolving, so it read a score the attempt had not earned. The count
    // for attempt N starts only once attempt N's rows are all in, so while
    // attempt N runs the number is the previous attempt's score — or, on a
    // loaded machine, the previous count still landing on it, which is why this
    // is a bound rather than an equality. Attempt 1 runs before any score, so it
    // holds 0.
    for (const sample of samples.filter((s) => s.stage === "running")) {
      const previous =
        sample.attempt >= 2
          ? Number.parseInt(SAMPLE_ATTEMPTS[sample.attempt - 2]!.score, 10)
          : 0;
      expect(
        sample.score,
        `the number reached ${sample.score} while attempt ${sample.attempt} was still running`,
      ).toBeLessThanOrEqual(previous);
    }
    expect(
      moves.some((sample) => sample.stage === "score"),
      "the number never counted during a score stage",
    ).toBe(true);
    // The shake — the first 300ms (200ms on later attempts) of the score stage
    // where the digits are deliberately still holding — is deliberately NOT
    // asserted here. It is a sub-second window in a wall clock, and a loaded
    // machine can starve the observer straight past it, which it did: this file
    // failed once in a full parallel run and passed three times alone. Asserted on
    // fake timers instead, in `src/pages/landing.test.tsx`, where the window
    // cannot be missed. A sampling test for a timing claim is a flake wearing a
    // test's clothes.

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
    await openStory(page);

    const report = page.getByLabel("Sample evaluation report");
    // No story to wait for: the final state is the first state. These are
    // immediate reads rather than polls, which is the real assertion — a
    // `toBeVisible()` that has to retry would mean the state was not there yet.
    await expect(report).toBeVisible();
    await expect(page.locator('[class*="animStatus_"]')).toHaveText("report ready");
    await expect(page.locator('[class*="sampleTests_"] li')).toHaveCount(3);
    // The *final* attempt, not the first: reduced motion skips the three runs
    // rather than showing the first one on its own, so the resting state is a full
    // pass and the tag says which attempt it was.
    await expect(page.getByRole("img", { name: /attempt 3 of 3 100 \/ 100/ })).toBeVisible();
    await expect(page.locator(".ringValue")).toHaveText("100%");
    await expect(page.getByText("3 passed · 0 failed · 142 ms · pytest")).toBeVisible();

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

    // The #389 scale is painted here too — one flat band per score — and a
    // reduced-motion reader is given the final one rather than a sweep. Which
    // band depends on the score; the last attempt's 100 is the fourth.
    expect(await bandOf(page), "100 should be the fourth band").toBe("ringScoreGreen");
    // Scoped to the panel: the page has gradients of its own (the logo), and this
    // is a claim about the score arc.
    expect(
      await page.locator(".sampleReport").locator("linearGradient").count(),
      "the arc is a flat colour",
    ).toBe(0);
  });

  test("steps the arc through the scale as the number counts", async ({ page }) => {
    // Issue #389. The scale is the point: a reader landing on the hero should see
    // where 66.7 sits, not just be told it is a "warning". It is one flat colour
    // at a time — the earlier version interpolated a gradient across the arc,
    // which put three colours on a ring whose entire content is one number.
    //
    // The claim under test is that the colour changes *while* the number runs, so
    // this samples the story from the first frame and records the band at every
    // change rather than only the settled one.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.addInitScript(() => {
      const w = window as unknown as { __bands: Array<[string, string]> };
      w.__bands = [];
      const attach = () => {
        const root = document.documentElement;
        if (!root) {
          setTimeout(attach, 0);
          return;
        }
        const sample = () => {
          const arc = document.querySelector(".ringProgress");
          const value = document.querySelector(".ringValue");
          if (!arc || !value) return;
          const entry = [`${arc.getAttribute("class")}`, value.textContent ?? ""];
          const last = w.__bands.at(-1);
          if (!last || last[0] !== entry[0]) w.__bands.push(entry as [string, string]);
        };
        // `attributes` because the band is a class swap on an element that
        // already exists — a subtree childList observer would miss every change
        // after the ring mounted.
        new MutationObserver(sample).observe(root, {
          attributes: true,
          subtree: true,
          childList: true,
          characterData: true,
        });
        sample();
      };
      attach();
    });

    await openStory(page);
    await settle(page);

    const bands = await page.evaluate(
      () => (window as unknown as { __bands: Array<[string, string]> }).__bands,
    );
    const bandOf = (cls: string) => cls.replace("ringProgress ", "");
    const seen = bands.map(([cls]) => bandOf(cls));

    // The observer has to have been watching long enough to see the runs; a
    // single entry means the ring was not sampled while it counted.
    expect(seen.length, `only saw ${JSON.stringify(bands)}`).toBeGreaterThan(2);
    // Red at 0%, and green at the end — the third attempt passes everything. The
    // first run cannot reach any other band on its own, which is why the panel
    // runs three: one score per band would leave orange and yellow unseen.
    expect(seen[0], `the arc started on ${seen[0]}`).toBe("ringScoreRed");
    expect(seen.at(-1), `the arc ended on ${seen.at(-1)}`).toBe("ringScoreGreen");
    // And it passed through the middle bands rather than jumping straight there.
    expect(seen, `the arc only used ${seen.join(" → ")}`).toContain("ringScoreOrange");

    // Every band a sample was on belongs to the score it was showing. This is the
    // pairing that makes the effect meaningful rather than decorative: a band
    // change at a number that is still inside the previous band would be the
    // scale disagreeing with its own dial.
    //
    // The thresholds are the app-wide ones (`scoreVariant`'s 60/80 nested inside
    // `scoreBand`'s 60/75/80), written out rather than imported for the same
    // reason as the sample attempts: this is the claim a reader checks by looking,
    // and a copy that drifts from the component is caught by this test rather
    // than by both drifting together.
    const bandFor = (n: number) =>
      n < 60
        ? "ringScoreRed"
        : n < 75
          ? "ringScoreOrange"
          : n < 80
            ? "ringScoreYellow"
            : "ringScoreGreen";
    for (const [cls, number] of bands) {
      const n = Number.parseInt(number, 10);
      expect(bandFor(n), `${bandOf(cls)} while the ring read ${number}`).toBe(bandOf(cls));
    }

    // The bands are real colours in the light theme, and the ring is one flat
    // paint: no paint server left over from the gradient version.
    const strokes = await page.evaluate(() => {
      const arc = document.querySelector(".ringProgress") as SVGElement | null;
      return arc ? getComputedStyle(arc).stroke : "";
    });
    expect(strokes, "the arc's computed stroke").toMatch(/^rgb\(/);
    // Scoped to the panel: the logo has a gradient and always did.
    await expect(page.locator(".sampleReport").locator("linearGradient")).toHaveCount(0);
  });

  test("keeps the panel's height fixed for the whole story", async ({ page }) => {
    // Issue #389. The typewriter wrapped to a new line mid-run and the result
    // rows arrived one at a time, so the whole hero shifted down while the one
    // thing a reader was watching played. The fix reserves the tallest state of
    // each region; this measures the rendered panel and asserts it never moved.
    await page.emulateMedia({ reducedMotion: "no-preference" });

    await page.addInitScript(() => {
      const store = window as unknown as { __panelHeights: number[] };
      store.__panelHeights = [];
      const attach = () => {
        const root = document.documentElement;
        if (!root) {
          setTimeout(attach, 0);
          return;
        }
        const read = () => {
          const panel = document.querySelector('[class*="animPanel"]');
          if (panel) store.__panelHeights.push(panel.getBoundingClientRect().height);
        };
        new MutationObserver(read).observe(root, {
          childList: true,
          subtree: true,
          characterData: true,
        });
        read();
      };
      attach();
    });

    await openStory(page);
    await settle(page);

    const heights = await page.evaluate(
      () => (window as unknown as { __panelHeights: number[] }).__panelHeights,
    );
    // The observer fires per typed character, so a correct run leaves hundreds
    // of samples. A handful means the panel was not watched at all.
    expect(heights.length, "the panel was never measured").toBeGreaterThan(20);
    const min = Math.min(...heights);
    const max = Math.max(...heights);
    // Sub-pixel slack: layout rounds between reflows.
    expect(
      max - min,
      `the hero terminal changed height by ${(max - min).toFixed(1)}px during the story`,
    ).toBeLessThanOrEqual(1);
  });
});
