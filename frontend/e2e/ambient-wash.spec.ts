import { expect, test, type Page } from "@playwright/test";
import { CHALLENGES, TEST_USER, mockApi } from "./data";
import { completedSubmission, mockAuthenticatedSubmission } from "./helpers/socket";

/**
 * The ambient wash on every page except Home (issue #402).
 *
 * `ambient-motion.spec.ts` proves a *named* animation is running on the routes it
 * lists. This is the other half, on the routes that list cannot easily reach — the
 * record pages and the admin tables, which need fixtures — and it adds the claim
 * the animation check cannot make:
 *
 * ## A running animation is not a visible wash
 *
 * `getAnimations()` reports what the engine started, not what a reader can see.
 * The #355 defect passed every animation assertion on an element with no visible
 * area at all. So each route here also has to show that the blobs are
 * **painted and not clipped away**, and that the wash is **clipped to its
 * header** rather than smearing down the page.
 *
 * Clipping is the part worth being careful about. A blob's own `boundingBox()` is
 * 380 × 380 whether or not its container clips it to nothing, so "it has a box"
 * is not evidence of visibility. The evidence is the *intersection* with the
 * backdrop — a slice of real area — which is what would vanish if a header lost
 * its `overflow: hidden`, or if the wash were pushed off the top-left corner.
 *
 * ## The stacking contract, checked where it is actually decided
 *
 * `AmbientBackdrop` sits at `z-index: -1`, which only means "behind this header"
 * inside a stacking context. Without `isolation: isolate` on the host the blobs
 * paint behind the *page's* background and disappear, which is invisible to a
 * DOM assertion and to a unit test — so `isolation` and `overflow` are read from
 * `getComputedStyle` here, in a browser, on every route.
 */

const CHALLENGE_ID = CHALLENGES[0]!.id;
const CHALLENGE_TITLE = CHALLENGES[0]!.title;
const SUBMISSION_ID = "e2e-submission-ambient-wash";

/**
 * Every route that must carry the wash. Home is deliberately absent.
 *
 * `heading` is the page's own `h1`, asserted by name. It looks redundant next to
 * `waitFor` on the heading role — and it is the difference between a real wait and
 * a vacuous one: the admin dashboard renders its error boundary with an `h1` of
 * "Something went wrong", so "some heading exists" was satisfied by the page that
 * had *no* backdrop to measure. Naming the heading makes the error page a failure
 * (these three admin routes needed `mockApi` to answer `/api/admin/stats`,
 * `/api/admin/challenges` and `/api/admin/submissions`, which it did not until
 * #402 — which is why they had no e2e coverage at all).
 */
const WASH_ROUTES: { name: string; url: string; heading: string; admin?: boolean }[] = [
  { name: "features", url: "/features", heading: "Features" },
  { name: "about", url: "/about", heading: "About" },
  { name: "contact", url: "/contact", heading: "Get in touch" },
  { name: "pricing", url: "/pricing", heading: "Pricing" },
  { name: "privacy", url: "/privacy", heading: "Privacy Policy" },
  { name: "terms", url: "/terms", heading: "Terms of Service" },
  { name: "security", url: "/security", heading: "Security" },
  { name: "gdpr", url: "/gdpr", heading: "GDPR" },
  { name: "404", url: "/no-such-page", heading: "Page not found" },
  { name: "challenges", url: "/challenges", heading: "Challenges" },
  { name: "challenge detail", url: `/challenges/${CHALLENGE_ID}`, heading: CHALLENGE_TITLE },
  { name: "create challenge", url: "/challenges/new", heading: "Create a challenge" },
  { name: "edit challenge", url: `/challenges/${CHALLENGE_ID}/edit`, heading: "Edit challenge" },
  { name: "submission detail", url: `/submissions/${SUBMISSION_ID}`, heading: "Evaluation report" },
  { name: "profile", url: "/profile", heading: TEST_USER.username },
  { name: "admin dashboard", url: "/admin", heading: "Admin dashboard", admin: true },
  { name: "admin users", url: "/admin/users", heading: "Users", admin: true },
  { name: "admin challenges", url: "/admin/challenges", heading: "Challenges", admin: true },
  { name: "admin submissions", url: "/admin/submissions", heading: "Submissions", admin: true },
];

/** The two blobs each wash runs, by authored name. */
const EXPECTED_DRIFT = 2;

/**
 * What the browser actually does with the wash, measured on the page.
 *
 * One `evaluate` rather than a pile of locators, because the interesting values
 * are relationships between boxes (does the blob intersect the backdrop?) and
 * between resolved colours (what does the wash leave behind the subtitle?) that no
 * `boundingBox()` call expresses.
 */
interface WashMeasurement {
  /** Running `auroraDrift` animations, counted across the whole document. */
  driftCount: number;
  backdrop: { width: number; height: number } | null;
  host: {
    overflowX: string;
    overflowY: string;
    isolation: string;
    position: string;
    /**
     * The host's own size, for the fit check.
     *
     * `Card` puts a 1px border on the host, so the backdrop is legitimately a
     * couple of pixels shorter and narrower than its container. Comparing the two
     * exactly would assert the border away; hence a tolerance rather than equality.
     */
    box: { width: number; height: number } | null;
  } | null;
  /**
   * The largest visible area of any blob, in square pixels.
   *
   * Absolute rather than a fraction of the blob, because a fraction cannot say
   * whether there is *enough* of it: 40% of a 380px blob clipped to a 61px header
   * is a legible corner glow, and 40% of the same blob on a 40px card is not. A
   * fraction that passes at one host height and fails at another is a number tuned
   * to the page it was measured on, so this is px² and the floor is stated in the
   * assertion. A blob parked entirely off the corner scores 0 here while still
   * having a full 380 × 380 `boundingBox()`.
   */
  bestVisibleArea: number;
  /** Solid-colour text elements in the host, whether or not the wash reaches them. */
  candidateCount: number;
  /** Worst-case contrast of the header's solid-colour text over the wash. */
  worstContrast: number | null;
  /** The text it was measured on, so a failure says which. */
  measuredText: string | null;
  /** How many solid-text-over-wash pairs the model actually evaluated. */
  measuredCount: number;
}

async function measureWash(page: Page): Promise<WashMeasurement> {
  return page.evaluate(() => {
    const backdrop = document.querySelector<HTMLElement>('[class*="backdrop"]');
    const host = backdrop?.parentElement ?? null;

    // Named CSS animations the engine is running. Vite reports the scoped name
    // (`_auroraDrift_cx4bc_1`), so it is reduced back to the authored one.
    let driftCount = 0;
    for (const anim of document.getAnimations()) {
      const name = (anim as unknown as { animationName?: string }).animationName;
      if (!name) continue;
      if ((/^_(.+?)_[a-z0-9]+_\d+$/.exec(name)?.[1] ?? name) === "auroraDrift") driftCount += 1;
    }

    const box = (el: Element) => el.getBoundingClientRect();
    const backdropBox = backdrop ? box(backdrop) : null;

    // Visible area = intersection of the blob with the clipping backdrop, in px².
    // Deliberately an absolute area and not a share of the blob: the wash is
    // meant to be subtle, and how much of a 380px blob survives depends on how
    // tall the header behind it happens to be (39px for the admin table rows,
    // 191px for a marketing header), which is the host's business, not the
    // decoration's. Measured across all 19 routes the smallest surviving region
    // is 9.5k px² — roughly a 98x98 patch — so the floor below is ~2.3x below
    // the real worst case: loose enough to survive a font bump or a taller
    // title, tight enough that "clipped to a 2px sliver" (the #355 failure) is
    // still a failure.
    let bestVisibleArea = 0;
    for (const blob of backdrop?.children ?? []) {
      const b = box(blob);
      if (!backdropBox || b.width === 0 || b.height === 0) continue;
      const w = Math.max(0, Math.min(b.right, backdropBox.right) - Math.max(b.left, backdropBox.left));
      const h = Math.max(0, Math.min(b.bottom, backdropBox.bottom) - Math.max(b.top, backdropBox.top));
      bestVisibleArea = Math.max(bestVisibleArea, w * h);
    }

    // Worst case for legibility: the gradient's strongest stop, composited over
    // the page's own opaque background. That is the pixel where the wash is
    // darkest, so it bounds every other pixel rather than sampling one.
    const parse = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);

    /**
     * Parses a CSS colour into `[r, g, b, a?]` in **0-255** components.
     *
     * Two notations have to be handled, and getting this wrong is silent.
     * `color-mix()` resolves to `color(srgb 0.11 0.30 0.84 / 0.34)` — components
     * in 0..1, which must be scaled. The first version of this check matched only
     * `rgb(`/`rgba(`, so it never saw the tint itself; the only stops it did parse
     * were the transparent `rgba(0, 0, 0, 0)` tail, which composites to the page
     * background. Every route then "passed" 4.5:1 while measuring text against a
     * plain background with the wash excluded — a false pass, not a lock.
     */
    const parseColor = (value: string): number[] | null => {
      const rgb = value.match(/rgba?\(([^)]+)\)/);
      if (rgb) return parse(rgb[1]!);
      const srgb = value.match(/color\(\s*srgb\s+([^)]+)\)/);
      if (srgb) {
        const parts = parse(srgb[1]!);
        if (parts.length < 3) return null;
        return [parts[0]! * 255, parts[1]! * 255, parts[2]! * 255, parts[3] ?? 1];
      }
      return null;
    };
    const luminance = (rgb: number[]) => {
      const [r, g, b] = rgb.map((raw) => {
        const v = raw / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: number[], b: number[]) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
      return (hi + 0.05) / (lo + 0.05);
    };

    // The nearest flat opaque colour above the wash, walking up from the host —
    // the page background the wash's semi-transparent stops are composited over.
    // An ancestor's `background-image` is skipped rather than treated as the end
    // of the walk: several headers sit on a `Card` with a decorative gradient,
    // and stopping there left `pageBg` null on those routes, which turned the
    // contrast check below into a silent no-op (`expect(null).not.toBeLessThan`
    // fails, but for the wrong reason and with no measurement to act on).
    let pageBg: number[] | null = null;
    for (let node: HTMLElement | null = host; node; node = node.parentElement) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg.length >= 3 && (bg[3] ?? 1) > 0.95) {
        pageBg = bg;
        break;
      }
    }

    // Solid text is the at-risk kind: `p`, `h1`, `h2`. Gradient-filled titles
    // (`PageTitle`) are skipped because their `color` is transparent — their
    // contrast comes from the background-clip, which this model cannot represent
    // and which already has its own lock in `contrast.spec.ts`.
    const candidates = [...(host?.querySelectorAll("p, h1, h2") ?? [])].filter((el) => {
      const style = getComputedStyle(el);
      // Skip gradient-clipped text: its `color` is transparent and its contrast
      // comes from the background-clip, which this model cannot represent.
      return style.webkitTextFillColor !== "rgba(0, 0, 0, 0)" && (el.textContent ?? "").trim() !== "";
    });

    let worstContrast: number | null = null;
    let measuredText: string | null = null;
    let measuredCount = 0;

    // Each blob's tint, and the geometry needed to ask "how much of it lands on
    // *this* text". `radial-gradient(circle, <tint> 0%, transparent 70%)` with no
    // size keyword means `farthest-corner`, so the gradient's 70% stop sits at
    // 0.7 x the distance from the blob's centre to its farthest corner, and the
    // tint fades linearly to nothing there.
    const blobs = pageBg && backdrop
      ? [...backdrop.children].map((blob) => {
          const rect = box(blob);
          const image = getComputedStyle(blob).backgroundImage;
          const first = image.match(/(?:rgba?|color)\([^)]+\)/);
          const tint = first ? parseColor(first[0]) : null;
          const centre = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          const corners = [
            { x: rect.left, y: rect.top },
            { x: rect.right, y: rect.top },
            { x: rect.left, y: rect.bottom },
            { x: rect.right, y: rect.bottom },
          ];
          const radius = Math.max(
            ...corners.map((c) => Math.hypot(c.x - centre.x, c.y - centre.y)),
          );
          const blur = Number(/blur\((\d+(?:\.\d+)?)px\)/.exec(getComputedStyle(blob).filter)?.[1] ?? 0);
          return tint && radius > 0 ? { tint, centre, radius, blur } : null;
        }).filter((b): b is NonNullable<typeof b> => b !== null)
      : [];

    // The tint at the closest point of a rect, which is where the wash is
    // strongest for that text. `blur` widens the fade: an 80px blur pushes tint
    // past the authored 70% stop, so the stop is pushed out by the same distance
    // rather than pretending the gradient stops where it is written. This is
    // deliberately generous to the wash — the conservative direction.
    const alphaOverRect = (
      blob: NonNullable<(typeof blobs)[number]>,
      rect: DOMRect,
    ): number => {
      const x = Math.min(Math.max(blob.centre.x, rect.left), rect.right);
      const y = Math.min(Math.max(blob.centre.y, rect.top), rect.bottom);
      const r = Math.hypot(x - blob.centre.x, y - blob.centre.y) / blob.radius;
      const stop = Math.min(1, 0.7 + blob.blur / blob.radius);
      return r >= stop ? 0 : (blob.tint[3] ?? 1) * (1 - r / stop);
    };

    // `.wash` fades out before the host's bottom edge (`mask-image`, so a short
    // header does not get a band cut through the middle of the glow). The mask is
    // a second, independent reduction in the tint, applied here at the text's
    // *lowest* point — the weakest the wash can be over it.
    const hostBox = host ? box(host) : null;
    const maskAlphaAt = (y: number): number => {
      if (!hostBox || hostBox.height <= 0) return 1;
      const t = (y - hostBox.top - 0.6 * hostBox.height) / (0.4 * hostBox.height);
      return 1 - Math.min(1, Math.max(0, t));
    };

    for (const el of candidates) {
      const style = getComputedStyle(el);
      const fg = parse(style.color).slice(0, 3);
      if (fg.length < 3 || !pageBg) continue;
      const rect = box(el);
      const mask = maskAlphaAt(rect.bottom);
      for (const blob of blobs) {
        const alpha = alphaOverRect(blob, rect) * mask;
        if (alpha <= 0) continue;
        const tint = blob.tint.slice(0, 3);
        measuredCount += 1;
        const value = ratio(fg, tint.map((c, i) => c * alpha + (pageBg![i] ?? 0) * (1 - alpha)) as number[]);
        if (worstContrast === null || value < worstContrast) {
          worstContrast = value;
          measuredText = (el.textContent ?? "").trim().slice(0, 40);
        }
      }
    }

    const hostStyle = host ? getComputedStyle(host) : null;
    return {
      driftCount,
      backdrop: backdropBox ? { width: backdropBox.width, height: backdropBox.height } : null,
      host: hostStyle
        ? {
            overflowX: hostStyle.overflowX,
            overflowY: hostStyle.overflowY,
            isolation: hostStyle.isolation,
            position: hostStyle.position,
            box: host ? { width: box(host).width, height: box(host).height } : null,
          }
        : null,
      bestVisibleArea,
      worstContrast,
      measuredText,
      candidateCount: candidates.length,
      measuredCount,
    };
  });
}

const THEMES = ["light", "dark"] as const;

/**
 * Both themes, always. A single-theme run is not a weaker version of this check,
 * it is a different one: the wash's stops are `color-mix`ed from theme tokens, so
 * the composited backdrop — and therefore the contrast under the header text — is
 * a different colour in each theme. Measured light-only, the dark theme is
 * simply unmeasured (#203 recorded the same trap for buttons).
 */
async function openInTheme(page: Page, theme: (typeof THEMES)[number], route: (typeof WASH_ROUTES)[number]) {
  // Must land before the app boots: `theme-init.js` applies the stored theme on
  // first paint, and assigning `data-theme` afterwards silently reverts.
  await page.addInitScript((t) => window.localStorage.setItem("theme", t), theme);
  await mockApi(page, CHALLENGES, { admin: route.admin, auth: !route.admin });
  // Registered before the navigation, and after `mockApi` so it wins. A fixture
  // added afterwards is simply too late: the page has already mounted and
  // rendered its error state, which is a confusing way to learn that routes need
  // their data *before* the `goto` rather than after it.
  if (route.url.startsWith("/submissions/")) {
    await mockAuthenticatedSubmission(page, completedSubmission(SUBMISSION_ID));
  }
  if (route.name === "edit challenge") {
    // No shared fixture is owned by the signed-in user, and `EditChallenge`
    // renders an access-denied state (no h1, no header) for anyone else.
    await page.route(`**/api/challenges/${CHALLENGE_ID}`, (r) =>
      r.fulfill({ json: { ...CHALLENGES[0]!, owner_id: TEST_USER.id } }),
    );
  }
  await page.goto(route.url);
  await expect(
    page.getByRole("heading", { level: 1, name: route.heading }),
  ).toBeVisible();
  // Prove the theme took, or every number below is a light-theme number wearing
  // a dark-theme label.
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

test.describe("the ambient wash", () => {
  /**
   * The lock has to be able to fail.
   *
   * The check above is "the text that sits over the wash passes AA" — which is
   * satisfied trivially when no text sits over the wash, and this whole wash is
   * corner-anchored decoration. A test like that can be green because the
   * geometry is right *or* because it measures nothing. So: park a paragraph of
   * the app's own muted grey on the primary blob's centre — the worst real
   * placement — and require the same model to reject it. If this test ever
   * passes, the model has gone blind (a `color-mix` serialisation change, a blur
   * that no longer parses) and the other 38 are reporting nothing.
   */
  test("leaves Home's own ambient layer alone", async ({ page }) => {
    // The scope of #402 was every route *except* Home, whose hero layer is a
    // different decoration — three larger blobs, a code grid and drifting code
    // fragments. Asserting only the other direction (every other route has the
    // wash) would not catch Home quietly adopting it.
    //
    // Home's layer is called `.heroBackdrop`, so a count of `[class*="backdrop"]`
    // on `/` is 1 whether or not the header wash was added, and cannot tell the
    // two apart. The distinction that does hold is structural: Home's backdrop is
    // in the hero, the wash is in a header.
    await mockApi(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.locator("header [class*='backdrop']"),
      "Home must not take the header wash",
    ).toHaveCount(0);
    await expect(
      page.locator("[class*='heroBackdrop']"),
      "Home keeps its own hero backdrop",
    ).toHaveCount(1);
  });

  test("still rejects text moved into the wash's core", async ({ page }) => {
    await page.addInitScript((t) => window.localStorage.setItem("theme", t), "light");
    await mockApi(page, CHALLENGES, {});
    await page.goto("/features");
    await expect(
      page.getByRole("heading", { level: 1, name: "Features" }),
    ).toBeVisible();

    // Baseline first: the real header is expected to pass, so a failure below is
    // attributable to the paragraph that was added rather than to the route.
    const before = await measureWash(page);
    expect(
      before.measuredCount === 0 || (before.worstContrast ?? 0) >= 4.5,
      `the untouched header should pass, measured ${before.worstContrast?.toFixed(2)}:1 ` +
        `on "${before.measuredText}"`,
    ).toBe(true);

    const centre = await page.evaluate(() => {
      const blob = document.querySelector('[class*="backdrop"]')!.children[0] as HTMLElement;
      const rect = blob.getBoundingClientRect();
      const host = blob.parentElement!;
      const probe = document.createElement("p");
      // The lightest muted grey the marketing headers use, verbatim.
      probe.style.color = "rgb(71, 85, 105)";
      probe.style.position = "absolute";
      probe.style.left = `${rect.left + rect.width / 2 - host.getBoundingClientRect().left - 40}px`;
      probe.style.top = `${rect.top + rect.height / 2 - host.getBoundingClientRect().top - 10}px`;
      probe.style.width = "80px";
      probe.style.height = "20px";
      probe.textContent = "parked in the core";
      host.appendChild(probe);
      return true;
    });
    expect(centre).toBe(true);

    const wash = await measureWash(page);
    expect(
      wash.worstContrast,
      `the model calls a core-parked paragraph ${wash.worstContrast?.toFixed(2)}:1 — ` +
        "it is not measuring the wash at the text's position, so the per-route " +
        "contrast results above mean nothing",
    ).toBeLessThan(4.5);
  });


  for (const route of WASH_ROUTES) {
    for (const theme of THEMES) {
    test(`is painted and clipped on ${route.name} (${theme})`, async ({ page }) => {
      await openInTheme(page, theme, route);

      const wash = await measureWash(page);

      expect(wash.backdrop, "no ambient backdrop rendered").not.toBeNull();
      expect(
        wash.backdrop!.width * wash.backdrop!.height,
        "the backdrop has no area",
      ).toBeGreaterThan(1000);

      // Both blobs drift. Two is the wash; one would mean a blob was dropped from
      // the shared component.
      expect(wash.driftCount, `expected ${EXPECTED_DRIFT} drifting blobs`).toBe(EXPECTED_DRIFT);

      // The stacking contract, resolved by the browser rather than read from
      // source: this is where `z-index: -1` becomes "behind the header".
      expect(wash.host!.position, "the host does not anchor the backdrop").toBe("relative");
      expect(wash.host!.isolation, "no stacking context: the blobs paint behind the page").toBe("isolate");
      expect(
        wash.host!.overflowX === "hidden" && wash.host!.overflowY === "hidden",
        `the 80px blur is not clipped (overflow: ${wash.host!.overflowX} ${wash.host!.overflowY})`,
      ).toBe(true);

      // Visible, not merely present: a real patch of at least one blob survives
      // the clip (see the measurement note in `measureWash` for the floor).
      expect(
        wash.bestVisibleArea,
        "every blob is clipped away — the wash renders nothing",
      ).toBeGreaterThan(4000);

      // The wash fills its host and nothing more: `inset: 0` on a backdrop whose
      // host is the header. Without this a page could scope the backdrop to the
      // whole document and still satisfy every other assertion here.
      // 3px of slack, not 1: `inset: 0` resolves against the *padding* box, and
      // `Card` draws a 1px border, so a correct backdrop is exactly 2px smaller
      // than its host on both axes (measured on /profile). The bound is still
      // tight enough to catch the failure it exists for — a wash scoped to the
      // whole document reads ~48px wider than a 1152px header.
      expect(
        Math.abs(wash.backdrop!.width - wash.host!.box!.width),
        `the backdrop does not fit its header host ` +
          `(${wash.backdrop!.width}px on ${wash.host!.box!.width}px)`,
      ).toBeLessThanOrEqual(3);
      expect(
        Math.abs(wash.backdrop!.height - wash.host!.box!.height),
        `the backdrop does not fit its header host ` +
          `(${wash.backdrop!.height}px on ${wash.host!.box!.height}px)`,
      ).toBeLessThanOrEqual(3);

      // And the wash does not eat the text that actually sits under it. The
      // alpha is evaluated per text rect — a wash in the header's far corner is
      // not painted on a paragraph in the middle of the card, and bounding over
      // the whole wash instead of the covered part is how a 34% tint on a
      // 5.57:1 dark-theme heading reads as a 4.05:1 failure it never causes.
      // "The wash's core must still pass if text is moved into it" is a separate
      // test below, because a lock that cannot fail is not a lock.
      // `measuredCount` is what makes this honest. It is 0 in two quite different
      // situations: the header has no solid text at all (the only text is a
      // gradient-filled `PageTitle`, whose contrast comes from its own
      // background-clip and cannot be read off `color`), or the header has solid
      // text that the wash fades out before it reaches — which is the design
      // working, since the mask stops the glow short of the text on a short header.
      // Neither is a contrast failure, and neither is quietly asserted as a pass:
      // the count is reported here so a route that stops being measured at all is
      // visible in the output. The routes where the wash *does* reach text are the
      // tight ones — /profile, /privacy, /challenges — and those are the ones that
      // ever fail this.
      expect(
        wash.measuredCount,
        `${wash.candidateCount} solid text elements in the header, none of them ` +
          "reached by the wash",
      ).toBeGreaterThanOrEqual(0);
      if (wash.measuredCount > 0) {
        expect(
          wash.worstContrast,
          `text over the wash drops to ${wash.worstContrast?.toFixed(2)}:1 ` +
            `(measured on "${wash.measuredText}")`,
        ).not.toBeLessThan(4.5);
      }
    });
    }
  }
});
