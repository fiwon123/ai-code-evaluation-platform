import type { Page } from "@playwright/test";

/**
 * Deterministic animation control for the visual sweep.
 *
 * The rule this file exists to enforce: **never sample animation state by
 * elapsed time.** A screenshot taken 400ms after a click is a different image on
 * a loaded machine than on an idle one, so a sweep built that way reports
 * findings that are artefacts of the machine it ran on — and, worse, a reviewer
 * cannot tell an artefact from a defect. The same lesson as #246 and #252, where
 * sampling by the clock cost a test 27.9s and taught nothing.
 *
 * Every capture therefore *seeks* instead of *waits*. The Web Animations API
 * gives three kinds of animation here, and each needs different handling:
 *
 * | Kind | Example | How it is sampled |
 * |---|---|---|
 * | time-driven, finite | `Reveal`'s transition, button hovers | `pause()` + `currentTime = delay + fraction × duration` |
 * | time-driven, infinite | `.codeGrid` (30s), `.codeFragment`, hero blobs | `pause()` at a fixed phase; never left running |
 * | position-driven | `.scrollReveal` (`animation-timeline: view()`) | untouched — the scroll offset *is* the input |
 *
 * The last row is the subtle one. A scroll-driven animation's progress comes from
 * its `ScrollTimeline`, so assigning `currentTime` to it does nothing useful, and
 * a helper that cannot tell the two kinds apart will report "seeked 12
 * animations" while 4 of them never moved. `isTimeDriven` is the discriminator,
 * and `assertSeekable` refuses to let a run report success while an animation it
 * meant to place stayed put.
 *
 * One animation cannot be seeked at all: `useCountUp` is a `requestAnimationFrame`
 * loop writing React state, so `getAnimations()` has never heard of it. It is
 * handled by waiting for the *value* to settle — a state, not a time — and the
 * fact that its intermediate frames are load-dependent is recorded in the
 * manifest rather than hidden.
 *
 * Note what is deliberately absent: `waitForTimeout` appears nowhere, and there
 * is no `sleep`. `src/pages/visual-sweep.lock.test.ts` greps this file for both
 * so a future refactor cannot quietly reintroduce clock-based sampling and leave
 * a sweep that looks deterministic while it is not.
 */

/** What a page's animations looked like when they were inspected. */
export interface AnimationCensus {
  /** Every animation the document reported. */
  total: number;
  /** Finite or infinite, but on a `DocumentTimeline` — seekable. */
  timeDriven: number;
  /** On a `ScrollTimeline` or other non-document timeline — position decides. */
  positionDriven: number;
  /** Of the time-driven ones, those that never end. */
  infinite: number;
  /**
   * Time-driven animations with no measurable duration, which therefore cannot
   * be seeked. A non-empty list is a finding, not a routine: it means something
   * is animating that the sweep cannot place on a timeline.
   */
  unseekable: string[];
  /**
   * Transitions declared on a pseudo-element, which `getAnimations()` can never
   * report — see {@link censusPseudoTransitions} for why that is structural
   * rather than a matter of timing, and why it is recorded here instead of
   * crashing the run.
   */
  pseudoTransitions: string[];
}

/** Where a scroll landed, and whether the page had anything to reveal. */
export interface SettleReport extends AnimationCensus {
  scrollY: number;
  /** The largest scrollY the document allows — 0 on a page that does not scroll. */
  maxScroll: number;
  /** `Reveal` blocks currently on screen that have been revealed. */
  revealed: number;
  /** `Reveal` blocks on screen that have *not* been revealed. */
  pendingReveals: number;
  /**
   * True when a `Reveal` on screen never lit up inside the frame budget.
   *
   * This is a finding, not an error: a reveal that stays hidden is exactly the
   * failure the sweep exists to catch ("objects that just appear when you move
   * the scroll bar"), so it is recorded for the report instead of thrown or,
   * worse, waited on until the suite gives up.
   */
  revealsTimedOut: boolean;
  /**
   * True when a time-driven animation was still running when the frame budget
   * ran out, so the capture photographs a moment of motion rather than a settled
   * state.
   *
   * Same reasoning as `revealsTimedOut`: a page that cannot be brought to rest
   * is a result for the report, not a crash for the harness. It is also the
   * single most useful signal in the manifest, because it is the one that says
   * "this frame is not evidence".
   */
  unquiesced: boolean;
  /**
   * How many on-screen, revealed `Reveal` blocks were still translucent when the
   * settle gave up.
   *
   * Non-zero means the frame shows a reveal in transit. It is the specific shape
   * that byte-differed between two identical loads, so it is counted rather than
   * left for a reviewer to spot in a contact sheet.
   */
  unsettledReveals: number;
}

/**
 * Scroll to `fraction` of the scrollable range, let the observers fire, and
 * bring every animation to a stable state — in one pass, in the page.
 *
 * Fractions rather than pixel offsets, because a page's height depends on the
 * viewport and the theme: a 0.5 fraction means the same *place* on a Pixel 7 as
 * on a desktop, which a fixed `scrollTo(0, 2400)` does not.
 *
 * The wait for `Reveal` is a frame budget checked against a *condition* — every
 * `Reveal` intersecting the viewport carries the revealed class — so the exit is
 * the state and not the clock. The budget is a ceiling: exceeding it is reported
 * as `revealsTimedOut` for the report rather than raised, because a stuck reveal
 * is a result, not a crash.
 */
export async function settleAtScroll(
  page: Page,
  fraction: number,
): Promise<SettleReport> {
  // Two round trips, deliberately. The pseudo-element scan runs *after* the
  // settle, on its own: it costs a forced computed-style resolution per element
  // per pseudo, and folding it into the loop would make the settle's cost depend
  // on the page's element count and its number of quiesce rounds. Nor can the
  // answer change in between — nothing here edits a stylesheet.
  const report = await page.evaluate(
    async (f: number): Promise<Omit<SettleReport, "pseudoTransitions">> => {
    // --- scroll ------------------------------------------------------------
    const scroller = document.scrollingElement ?? document.documentElement;
    const maxScroll = Math.max(0, scroller.scrollHeight - window.innerHeight);
    const target = Math.round(maxScroll * Math.min(1, Math.max(0, f)));
    window.scrollTo({ top: target, left: 0, behavior: "instant" });

    // --- settle animations -------------------------------------------------
    // Document-level `getAnimations()` already covers every animation in the
    // tree; only the *element* method takes a `subtree` option.
    //
    // A *closure*, not a loop, because the animation set is not a snapshot: a
    // `Reveal` block lit up during the wait below has its transition created
    // after this runs, and a transition that nobody pins keeps running — the
    // capture lands on whatever point of it the machine happened to be at, and
    // the determinism lock sees 0.674 opacity on one run and 0.519 on the next.
    // So the pinning is re-applied every frame while reveals light up, and the
    // census reported is the one from the *final* pass.
    // Returns the census minus the pseudo-transition list, which is merged in
    // from Node after the settle: `pin` runs on every quiesce round and that
    // scan is far too expensive to repeat.
    const pin = (): Omit<AnimationCensus, "pseudoTransitions"> => {
      const animations = document.getAnimations();
      const census: Omit<AnimationCensus, "pseudoTransitions"> = {
        total: animations.length,
        timeDriven: 0,
        positionDriven: 0,
        infinite: 0,
        unseekable: [],
      };
      for (const animation of animations) {
        // The discriminator. A scroll-driven animation is attached to a
        // `ScrollTimeline`/`ViewTimeline`; everything placeable on a clock is
        // attached to the document timeline.
        if (!(animation.timeline instanceof DocumentTimeline)) {
          census.positionDriven += 1;
          continue;
        }
        census.timeDriven += 1;

        const timing = animation.effect?.getComputedTiming();
        if ((timing?.iterations ?? 1) === Infinity) {
          census.infinite += 1;
          // Frozen, not cancelled: `pause()` keeps the animation in the tree so
          // it can be seeked later, while pinning it to a known phase.
          // `cancel()` would drop it and the element would fall back to its
          // *unanimated* style, which is a different image than "the ambient
          // layer, at rest".
          animation.pause();
          animation.currentTime = 0;
          continue;
        }

        const duration = timing?.duration;
        const delay = timing?.delay ?? 0;
        if (typeof duration === "number" && Number.isFinite(duration) && duration > 0) {
          // Pinned to its end and *paused* — not `finish()`.
          //
          // `finish()` is a one-way door: a finished animation is in the play-
          // finished state, and nothing moves it back. The static pass visits
          // offsets 0 → 0.5 → 1 on one page, so with `finish()` the 0.5 frame was
          // really "whatever 0 had already completed" and the 1 frame "whatever
          // 0.5 had completed". The three frames of a route were not three
          // independent measurements of three positions, and the determinism
          // lock caught it by refusing to reproduce them.
          //
          // Pausing at the end gives the same pixels as `finish()` — including
          // the fill, since `currentTime` is placed past `delay + duration` —
          // while staying reversible: `seekAnimations` can still place it at
          // 30% for a motion frame, and a re-settle at the same offset lands on
          // the same state.
          animation.pause();
          animation.currentTime = delay + duration;
        } else {
          animation.pause();
          census.unseekable.push(describe(animation));
        }
      }
      return census;
    };

    // Freeze the ambient loops before the waits below, so they cannot drift
    // while reveals light up; the reveal transitions are caught by later passes.
    pin();

    // --- wait for reveals --------------------------------------------------
    // One implementation of "is this a Reveal block", used by the census below
    // and by the condition — an earlier version had a copy of this in each,
    // which is how a parser and its twin drift apart.
    const isReveal = (el: Element): boolean => {
      for (const token of Array.from(el.classList)) {
        // `Reveal`'s base class is a CSS-module token (`reveal_1a2b3c`, or bare
        // `reveal` if hashing is ever off), so it is matched by prefix. The
        // global `.scrollReveal` from `globals.css` is *not* a module class and
        // is never revealed, hence the exclusion — matching it would wait
        // forever for a class that cannot exist.
        if (token.startsWith("reveal") && token !== "scrollReveal") return true;
      }
      return false;
    };
    const hasRevealed = (el: Element): boolean => {
      for (const token of Array.from(el.classList)) {
        if (token.startsWith("visible")) return true;
      }
      return false;
    };
    const onScreen = (el: Element): boolean => {
      const box = el.getBoundingClientRect();
      return box.bottom > 0 && box.top < window.innerHeight;
    };
    const revealBlocks = (): Element[] =>
      Array.from(document.querySelectorAll("div")).filter(isReveal);

    // 180 frames is ~3s at 60fps and generously more than an observer callback
    // plus a React commit needs. It bounds the wait; it is not the wait.
    const BUDGET = 180;
    let frames = 0;
    let revealsTimedOut = false;
    for (;;) {
      const blocks = revealBlocks().filter(onScreen);
      const pending = blocks.filter((el) => !hasRevealed(el));
      if (pending.length === 0) break;
      if (frames >= BUDGET) {
        revealsTimedOut = true;
        break;
      }
      frames += 1;
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
      // Re-pin every frame: each pass picks up the transitions the previous
      // frame's reveals created, and places them at their end state rather than
      // wherever a 60fps clock left them. Waiting for the class and only then
      // pinning once is the version that shipped as "flaky on mobile".
      pin();
    }

    // --- quiesce -----------------------------------------------------------
    // Waiting for the revealed *class* is not the same as the transition being
    // there. The class is committed by React, the transition is created by the
    // style engine on the next update, and only then does it start running — so
    // a harness that pins and immediately photographs catches a `Reveal` at 13%
    // opacity on one run and 19% on the next. Both are "correct"; neither is
    // evidence.
    //
    // So: pin, yield a frame, and ask whether anything on the document timeline
    // is still *running*. The exit is that condition and not a duration, and the
    // budget only bounds a page that refuses to come to rest.
    const timeDriven = (): Animation[] =>
      document.getAnimations().filter(
        (animation) => animation.timeline instanceof DocumentTimeline,
      );
    const hasRunning = (): boolean =>
      timeDriven().some((animation) => animation.playState === "running");

    // Two conditions, because one is not enough. "Nothing is running" is true in
    // the gap between React committing `_visible` and the style engine creating
    // the transition from it — a window in which the honest answer is "no
    // animation exists yet" and the wrong answer is "settled". So the set is also
    // required to *stop growing* across consecutive frames: a late transition
    // shows up as a count bump, and the loop keeps going until it does not.
    const QUIESCE_BUDGET = 30;
    let quiesceRounds = 0;
    let unquiesced = false;
    let settledCount = -1;
    let stableRounds = 0;
    for (;;) {
      pin();
      quiesceRounds += 1;
      // Yield *after* pinning, so a transition created during this frame is seen
      // by the next round — both as a running animation and as a larger count.
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
      const count = timeDriven().length;
      stableRounds = count === settledCount ? stableRounds + 1 : 0;
      settledCount = count;
      if (stableRounds >= 2 && !hasRunning()) break;
      if (quiesceRounds >= QUIESCE_BUDGET) {
        unquiesced = true;
        break;
      }
    }

    // The end state, verified rather than assumed. A reveal that is on screen,
    // carries the revealed class, and is still not opaque was photographed
    // mid-flight — and that is the difference between evidence and a snapshot of
    // the machine, so it is a finding, not a shrug.
    const unsettledReveals = revealBlocks()
      .filter(onScreen)
      .filter(hasRevealed)
      .filter((el) => Number(getComputedStyle(el).opacity) < 0.999).length;

    // One last pass, so the census describes the state that is about to be
    // photographed: reveals lit, transitions pinned, ambient loops frozen.
    const census = pin();

    const onScreenBlocks = revealBlocks().filter(onScreen);
    const revealed = onScreenBlocks.filter(hasRevealed).length;

    return {
      ...census,
      scrollY: window.scrollY,
      maxScroll,
      revealed,
      pendingReveals: onScreenBlocks.length - revealed,
      revealsTimedOut,
      unquiesced,
      unsettledReveals,
    };

    function describe(animation: Animation): string {
      const target = (animation.effect as KeyframeEffect | null)?.target;
      if (target instanceof Element) {
        const id = target.id ? `#${target.id}` : "";
        const cls =
          typeof target.className === "string" && target.className
            ? `.${target.className.trim().split(/\s+/).slice(0, 2).join(".")}`
            : "";
        return `${target.tagName.toLowerCase()}${id}${cls}`;
      }
      return animation.constructor.name;
    }
  }, fraction);

  // Counters last, and they are the reason this is not just "pin the
  // animations".
  //
  // `useCountUp` is a rAF loop writing React state, so it is invisible to
  // `getAnimations()` and no seek can reach it. Worse, scrolling a `Reveal`
  // block back into view re-runs the observer that starts it — so a frame
  // captured after a scroll could catch a counter mid-count, a number that
  // depends on how long the page had been open. That is exactly the
  // "different bytes every run" failure this harness exists to prevent, and the
  // determinism lock is what surfaced it.
  await waitForTextSettled(page);
  return { ...report, pseudoTransitions: await censusPseudoTransitions(page) };
}

/**
 * Place every seekable time-driven animation at `fraction` of its own effect,
 * and return how many moved.
 *
 * `fraction` is progress through the effect *including its delay*, so a delayed
 * element is caught mid-flight: the seek is `delay + fraction × duration`. That
 * detail is the difference between a transition filmstrip that works and one
 * that lies — `Reveal` staggers by 80ms a step over a ~550ms transition, so the
 * naive `fraction × duration` puts the last element at 13% progress and every
 * frame reads as "still hidden".
 */
export async function seekAnimations(page: Page, fraction: number): Promise<number> {
  const moved = await page.evaluate((f: number): number => {
    const animations = document
      .getAnimations()
      .filter((a) => a.timeline instanceof DocumentTimeline);

    let seeked = 0;
    for (const animation of animations) {
      const timing = animation.effect?.getComputedTiming();
      const duration = timing?.duration;
      if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) {
        continue;
      }
      const delay = typeof timing?.delay === "number" ? timing.delay : 0;
      const endDelay = typeof timing?.endDelay === "number" ? timing.endDelay : 0;
      animation.pause();
      animation.currentTime = delay + Math.min(1, Math.max(0, f)) * Math.max(0, duration + endDelay);
      seeked += 1;
    }
    return seeked;
  }, fraction);

  // Counters last, and they are the reason this is not just "pin the
  // animations".
  //
  // `useCountUp` is a rAF loop writing React state, so it is invisible to
  // `getAnimations()` and no seek can reach it. Worse, scrolling a `Reveal`
  // block back into view re-runs the observer that starts it — so a frame
  // captured after a scroll could catch a counter mid-count, a number that
  // depends on how long the page had been open. That is exactly the
  // "different bytes every run" failure this harness exists to prevent, and the
  // determinism lock is what surfaced it. A filmstrip of a transition with a
  // counter mid-count is a filmstrip of a race.
  await waitForTextSettled(page);
  return moved;
}

/**
 * Count the animations on the page and split them by what drives them.
 *
 * Separate from `settleAtScroll` because the motion passes need the census
 * *without* the settle — a transition filmstrip seeks deliberately and must not
 * have its animations finished out from under it first.
 */
export async function censusAnimations(page: Page): Promise<AnimationCensus> {
  // Two separate `page.evaluate` round trips, not one function calling the
  // other: `censusPseudoTransitions` is Node-side and opens its own channel, so
  // calling it from inside an in-page callback would be asking the browser to
  // make a request it has no way to make. They are independent reads, so they
  // run together.
  const [census, pseudoTransitions] = await Promise.all([
    page.evaluate((): Omit<AnimationCensus, "pseudoTransitions"> => {
      // Document-level `getAnimations()` already covers every animation in the
      // tree; only the *element* method takes a `subtree` option.
      const animations = document.getAnimations();
      const census: Omit<AnimationCensus, "pseudoTransitions"> = {
        total: animations.length,
        timeDriven: 0,
        positionDriven: 0,
        infinite: 0,
        unseekable: [],
      };
      for (const animation of animations) {
        if (!(animation.timeline instanceof DocumentTimeline)) {
          census.positionDriven += 1;
          continue;
        }
        census.timeDriven += 1;
        if ((animation.effect?.getComputedTiming().iterations ?? 1) === Infinity) {
          census.infinite += 1;
        }
        const duration = animation.effect?.getComputedTiming().duration;
        if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) {
          const target = (animation.effect as KeyframeEffect | null)?.target;
          census.unseekable.push(
            target instanceof Element
              ? `${target.tagName.toLowerCase()}.${
                  typeof target.className === "string" ? target.className.split(/\s+/)[0] : ""
                }`
              : animation.constructor.name,
          );
        }
      }
      return census;
    }),
    censusPseudoTransitions(page),
  ]);
  return { ...census, pseudoTransitions };
}

/**
 * Transitions the census can see declared in CSS but that no `Animation` object
 * ever represents, so no seek can place them.
 *
 * This is a *structural* blind spot, not a timing one, and that is what makes it
 * safe to detect without a clock: no amount of seeking, waiting or pausing will
 * make these appear in `getAnimations()`.
 *
 * **The scope is narrower than "pseudo-elements", and an earlier draft of this
 * comment got that wrong.** It claimed no pseudo-element transition is ever
 * reported, on the evidence of a page whose `::after` transition had never been
 * *triggered* — an untriggered transition has no `Animation` to report, so the
 * test would have "confirmed" the claim about any pseudo-element ever. Triggering
 * it properly gives the opposite answer:
 *
 * | declaration                          | in `getAnimations()`?          |
 * |--------------------------------------|--------------------------------|
 * | `.a::after { transition: transform }` | **yes** — `pseudo=::after`    |
 * | `.c::details-content { transition }` | **no** — no entry at all      |
 *
 * So `::before`/`::after` transitions are seekable and must *not* be reported
 * here: doing so would tell the report that the sweep cannot reach motion it can
 * in fact place, which is the same class of error as the one this function
 * exists to remove. The list below is the verified-unreachable set and nothing
 * else; extending it means re-running the experiment above, not reasoning about
 * it.
 *
 * It is recorded rather than thrown, because the page is not at fault. The
 * shipped consumer is `/pricing`'s FAQ answer, which animates through
 * `::details-content` — a supported mechanism (Chrome 131+, Safari 18.4+,
 * Firefox 139+) that #332 put on that page deliberately. Throwing would make the
 * sweep permanently red over a correct page and train everyone to ignore the
 * guard, which is worse than the false all-clear it replaces.
 *
 * The consequence is recorded instead: a pass that intends to film one of these
 * has to sample the *value* rather than seek the animation, the way `useCountUp`
 * is handled below, and the manifest says so rather than implying the run
 * covered it.
 *
 * Detection is a computed-style read, so it is deterministic — no clock, no
 * sampling, nothing to flake. `transition-property` and `transition-duration` are
 * both non-inherited, so their initial values (`all` and `0s`) are what an
 * element with no such rule reports: a non-zero duration is therefore a genuine
 * declaration and cannot be an artefact of inheritance.
 */
export async function censusPseudoTransitions(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    // Verified-unreachable pseudo-elements, and *only* those. `::before` and
    // `::after` are excluded on evidence, not taste: Chromium does report them,
    // as `pseudo=::before` / `pseudo=::after` entries. See the doc comment for
    // the experiment. Each entry costs a `getComputedStyle` per element on the
    // page, which is also why the list stays this short.
    const PSEUDOS = ["::details-content"] as const;

    /**
     * Forced style is a real cost: one `getComputedStyle` per element per
     * pseudo-element, on every page in the sweep. Bounded, and the bound is
     * reported rather than hidden, because a silent truncation would show up as
     * a clean bill of health for the elements that were never looked at.
     */
    const MAX_ELEMENTS = 3000;

    const describe = (el: Element) => {
      const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/)[0] : "";
      const tag = el.tagName.toLowerCase();
      return cls ? `${tag}.${cls}` : tag;
    };

    /** `0.2s` / `200ms` / `0s` -> milliseconds. NaN for anything unparseable. */
    const toMs = (value: string) => {
      const raw = value.trim();
      if (raw.endsWith("ms")) return Number.parseFloat(raw);
      if (raw.endsWith("s")) return Number.parseFloat(raw) * 1000;
      return Number.NaN;
    };

    const found: string[] = [];
    const elements = Array.from(document.querySelectorAll("*"));
    for (const el of elements.slice(0, MAX_ELEMENTS)) {
      for (const pseudo of PSEUDOS) {
        const style = getComputedStyle(el, pseudo);
        const property = style.transitionProperty;
        if (!property || property === "none") continue;

        // CSS repeats a shorter list to match the longer one, so a single
        // `transition-duration` covers a two-property `transition-property`.
        // Reading index 0 alone would miss the second property entirely, and
        // `::details-content` declares exactly that shape.
        const properties = property.split(",").map((p) => p.trim());
        const durations = style.transitionDuration.split(",").map(toMs);
        const at = (i: number) => durations[i % durations.length];
        if (!Number.isFinite(at(0)) || at(0) <= 0) continue;

        found.push(`${describe(el)}${pseudo} { ${properties.map((p, i) => `${p} ${at(i)}ms`).join(", ")} }`);
      }
    }
    if (elements.length > MAX_ELEMENTS) {
      found.push(`… and ${elements.length - MAX_ELEMENTS} element(s) not scanned (MAX_ELEMENTS=${MAX_ELEMENTS})`);
    }
    return found;
  });
}

/**
 * Wait for every animated number on the page to stop moving.
 *
 * The one animation the Web Animations API cannot reach: `useCountUp` is a
 * `requestAnimationFrame` loop writing React state, so there is no `Animation`
 * object to pause and `getAnimations()` is empty while it runs. Waiting on it by
 * elapsed time is precisely the wall-clock trap — under load a frame catches a
 * counter mid-ease, and the number in the screenshot becomes a report of the
 * machine's CPU count rather than of the design. The determinism lock is what
 * caught this: two captures of the same state differed by exactly `72%` against
 * `79%`.
 *
 * The wait is therefore on **convergence**: the page's visible text is read once
 * a frame until it stops changing. A running counter changes every frame, so it
 * cannot be mistaken for a settled one.
 *
 * It watches the whole page's text rather than a list of classes, because the
 * list was the bug: `statValue` (Home's stat cards) and `ringValue`
 * (`ScoreRing`) are two different components calling the same hook, and a
 * selector naming one of them silently photographs the other mid-count. A
 * surface added next month is covered without touching this file. The cost is
 * one `innerText` read per frame for a handful of frames.
 *
 * Two details a naive version gets wrong:
 *
 * - **Stable is not always settled.** Counters start after a delay (Home's
 *   stat cards wait 200ms), and during that delay the value sits at zero and does
 *   not move — so "unchanged for a few frames" can be true before the count has
 *   begun. The first wait in a page load therefore demands a longer stable run
 *   than later ones.
 * - **The tracker lives on `window`**, so the fact that *something has already
 *   moved* survives across settles. Without it, re-settling after a scroll —
 *   which the static pass does at every offset — would look like a fresh page
 *   load, see already-settled counters that are not moving, and pay the long
 *   wait at every offset instead of once per page.
 *
 * Returns false rather than throwing when the budget runs out: a number that
 * never lands is a finding for the manifest, not a harness crash. The budget is
 * short on purpose — this runs once per capture, and a long timeout on a page
 * whose numbers never move would add minutes to a 344-frame run.
 */
export async function waitForTextSettled(page: Page): Promise<boolean> {
  return page
    .waitForFunction(
      (stableNeeded) => {
        const text = (document.body.innerText ?? "").replace(/\s+/g, " ").trim();
        const store = window as unknown as {
          __visualSweepText?: { prev: string; stable: number; moved: boolean };
        };
        const tracker = store.__visualSweepText;
        if (!tracker) {
          // First look at this page: nothing has been observed changing yet.
          store.__visualSweepText = { prev: text, stable: 0, moved: false };
          return false;
        }
        if (text !== tracker.prev) {
          store.__visualSweepText = { prev: text, stable: 0, moved: true };
          return false;
        }
        const stable = tracker.stable + 1;
        // Before anything has moved, a counter in its 200ms delay looks exactly
        // like a finished one, so the first settle in a page load has to watch
        // longer than the ones after it.
        const settled = tracker.moved ? stable >= stableNeeded.later : stable >= stableNeeded.first;
        store.__visualSweepText = { ...tracker, stable };
        return settled;
      },
      // The long run covers a start delay; the short one is for re-settles on a
      // page that has already moved its numbers at least once.
      { first: 30, later: 5 },
      { timeout: 3_000, polling: "raf" },
    )
    .then(() => true)
    .catch(() => false);
}

/**
 * Fail if a page reported time-driven animations the sweep cannot place.
 *
 * The guard on the guard. Without it, `seekAnimations` returning 0 on a page
 * that visibly animates looks exactly like a page with nothing to animate, and
 * the motion pass would report "nothing to see" — which is how an animation
 * system quietly stops being reviewed.
 */
export function assertSeekable(census: AnimationCensus, context: string): void {
  if (census.unseekable.length > 0) {
    throw new Error(
      `${context}: ${census.unseekable.length} time-driven animation(s) with no measurable duration, so the sweep cannot place them deterministically: ${census.unseekable.join(", ")}`,
    );
  }
}
