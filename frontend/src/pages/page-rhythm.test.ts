/**
 * Locks the vertical rhythm of the page shells (issue #236).
 *
 * Every page is a `.page` element, and a page's padding is the first thing a
 * reader perceives as "this site is considered" — before any component, any
 * type, any colour. It was also the least consistent thing in the app: of the
 * sixteen shells, five used one vertical rhythm, four another, three another,
 * and `Features` and `Pricing` were on a rhythm of their own, being the only two
 * pages in the app with a 4-unit horizontal gutter instead of 6.
 *
 * The rhythms are not being flattened into one value. Marketing pages get more
 * air than a working table, and that hierarchy is deliberate. What is pinned is
 * *which group a page belongs to*, so a page cannot quietly drift out of its
 * group — which is how `Features` ended up with 8 units of bottom padding
 * against its 48 of siblings', and looked like it ran out of page.
 *
 * What is checked:
 *   1. each shell's padding matches the rhythm of its group,
 *   2. every shell in a group agrees, so a new page has a precedent to copy,
 *   3. no shell invents a horizontal gutter (the `space-4` outlier),
 *   4. an unknown group fails loudly instead of passing by default,
 *   5. the marketing subtitle is on the type scale, not a literal,
 *   6. the marketing measure is the same 600px everywhere.
 */
import { describe, expect, it } from "vitest";

import globalsCss from "../styles/globals.css?raw";

/** Every page-level CSS module, keyed by path. */
const MODULES = import.meta.glob("../pages/**/*.module.css", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/**
 * The recognised page rhythms: `[top, side, bottom]`.
 *
 * `marketing` — landing and informational pages, where the page itself is the
 * content. `app` — dashboards and lists, where a row of data is. `detail` — a
 * single record, which needs less air above the fold than a list does.
 */
const RHYTHMS = {
  marketing: ["--space-16", "--space-6", "--space-20"],
  app: ["--space-12", "--space-6", "--space-16"],
  detail: ["--space-8", "--space-6", "--space-16"],
} as const;

type Rhythm = keyof typeof RHYTHMS;

/**
 * Which group each page belongs to.
 *
 * Explicit rather than inferred from the current padding: a test that derives
 * its expectation from the thing it is checking asserts only that the value is
 * stable, not that it is right. A new page has to be added here, which is the
 * point — the decision gets made once, deliberately.
 */
const PAGE_GROUP: Record<string, Rhythm> = {
  "About/About.module.css": "marketing",
  "Contact/Contact.module.css": "marketing",
  "Demo/Demo.module.css": "marketing",
  "Features/Features.module.css": "marketing",
  "Legal/Legal.module.css": "marketing",
  "Pricing/Pricing.module.css": "marketing",
  "Admin/Admin.module.css": "app",
  "Challenges.module.css": "app",
  "Profile/Profile.module.css": "app",
  "ChallengeDetail.module.css": "detail",
  "SharedResultPage.module.css": "detail",
  "SubmissionDetail.module.css": "detail",
};

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The `padding` shorthand of a page's `.page` rule, normalised to three sides. */
function shellPadding(css: string): string[] | null {
  const rule = /\.page\s*\{([^}]*)\}/.exec(stripComments(css));
  const value = rule?.[1].match(/padding:\s*([^;]+);/)?.[1];
  if (!value) return null;
  const parts = value.trim().split(/\s+/).map((p) => p.replace(/^var\(|\)$/g, ""));
  // `padding: X` is all four sides; `X Y Z` is top/side/bottom.
  if (parts.length === 1) return [parts[0], parts[0], parts[0]];
  if (parts.length === 2 || parts.length === 3) return [parts[0], parts[1], parts[2] ?? parts[0]];
  if (parts.length === 4) return [parts[0], parts[1], parts[3]];
  return null;
}

const SHELLS = Object.entries(MODULES).map(([path, css]) => ({
  // Glob keys are relative to this file: "./About/About.module.css".
  page: path.replace(/^\.\.\/pages\//, "").replace(/^\.\//, ""),
  padding: shellPadding(css),
}));

/** Pages with no `.page` padding of their own: the auth pages, whose layout
 *  is the shared `AuthLayout` and whose own `.page` is a loading placeholder. */
const HANDED_OFF = ["Login.module.css", "OAuthCallback.module.css", "Register.module.css"];

describe("page shell rhythm", () => {
  it("classifies every page shell, and nothing unclassified", () => {
    // A new page must be placed in a group. If it is missing here, the loop
    // below would skip it and the page would ship on whatever rhythm its author
    // typed — which is how the drift started.
    const unclassified = SHELLS.filter(
      (s) => s.padding && !HANDED_OFF.includes(s.page) && !(s.page in PAGE_GROUP),
    );
    expect(
      unclassified.map((s) => s.page),
      "page shell(s) with padding but no declared rhythm",
    ).toEqual([]);
    expect(SHELLS.filter((s) => s.padding).length).toBeGreaterThan(10);
  });

  it("gives every page the rhythm of its group", () => {
    for (const { page, padding } of SHELLS) {
      const group = PAGE_GROUP[page as keyof typeof PAGE_GROUP];
      if (!group) continue;
      expect(padding, `${page} has no readable .page padding`).not.toBeNull();
      expect(
        padding,
        `${page} is a ${group} page and should use ${RHYTHMS[group].join(" ")}`,
      ).toEqual([...RHYTHMS[group]]);
    }
  });

  it("keeps every page's horizontal gutter at one value", () => {
    // The side padding is the one value with no group to it: a page that is
    // narrower than its siblings on desktop is a bug, not a style.
    for (const { page, padding } of SHELLS) {
      if (!padding) continue;
      expect(padding[1], `${page} uses a ${padding[1]} gutter`).toBe("--space-6");
    }
  });

  it("uses each group more than once, so the grouping means something", () => {
    // A "rhythm" that exactly one page uses is a one-off, and pinning it would
    // freeze an accident.
    const counts = Object.values(PAGE_GROUP).reduce<Record<string, number>>(
      (acc, g) => ({ ...acc, [g]: (acc[g] ?? 0) + 1 }),
      {},
    );
    for (const [group, rhythm] of Object.entries(RHYTHMS)) {
      expect(counts[group] ?? 0, `the ${group} rhythm (${rhythm.join(" ")}) has no members`)
        .toBeGreaterThan(1);
    }
  });
});

describe("marketing hero", () => {
  const MARKETING = Object.keys(PAGE_GROUP).filter((p) => PAGE_GROUP[p] === "marketing");

  /**
   * Marketing pages that genuinely have no hero paragraph.
   *
   * `Legal` is a documents shell — it renders whatever `content.ts` holds and
   * opens straight into the first document — so there is nothing to measure.
   * Named rather than skipped silently, so a page that loses its hero is a
   * failing test instead of a quiet pass.
   */
  const NO_HERO = ["Legal/Legal.module.css"];

  /**
   * The hero subtitle rule, however the page chose to name it.
   *
   * `About` calls it `.tagline`, `Pricing` calls it `.pageSubtitle`, and the
   * rest call it `.subtitle`. Reading one name would have covered two thirds of
   * the marketing pages and quietly tested nothing on the third, so all three
   * are tried and a miss is reported rather than tolerated.
   */
  function heroRule(page: string): { selector: string; body: string } | null {
    const css = stripComments(MODULES[`./${page}`] ?? "");
    const match =
      /([^{}]*)\.(subtitle|pageSubtitle|tagline)\s*\{([^}]*)\}/.exec(css);
    if (!match) return null;
    return { selector: match[2], body: match[3] };
  }

  it("finds a hero subtitle on every marketing page that has one", () => {
    // Guard on the guard. An earlier version of this block looked its rules up
    // under the wrong glob key, so every page yielded an empty string and the
    // two tests below asserted against nothing at all — and passed. A lock that
    // cannot fail is worse than no lock, so the lookup is verified first.
    const missing = MARKETING.filter(
      (page) => !NO_HERO.includes(page) && heroRule(page) === null,
    );
    expect(missing, `no hero subtitle rule found in: ${missing.join(", ")}`).toEqual([]);

    // And the exemption list is itself checked: a page only earns an entry by
    // having no hero, and a new one cannot join it silently.
    const exempt = MARKETING.filter((page) => NO_HERO.includes(page));
    expect(exempt, "NO_HERO names a page that does have a hero").toEqual(NO_HERO);
    for (const page of NO_HERO) {
      expect(heroRule(page), `${page} is exempted but does have a hero`).toBeNull();
    }
    expect(MARKETING.length).toBeGreaterThan(4);
  });

  it.each(MARKETING.filter((page) => !NO_HERO.includes(page)))(
    "%s sets its subtitle on the type scale",
    (page) => {
    // `Features` carried a literal `1.05rem` — a value in no scale, so it
    // matched nothing and could never be adjusted along with the rest.
    const rule = heroRule(page);
    expect(rule, `${page} has no hero subtitle rule`).not.toBeNull();
    expect(
      rule?.body,
      `${page} .${rule?.selector} sets a literal font size instead of a scale token`,
    ).not.toMatch(/font-size:\s*[\d.]+(px|rem|em)/);
  });

  it("gives every marketing hero the same measure", () => {
    // Three pages said 560px, two said 600px, and `Features` said 48rem —
    // 768px, nearly a third wider, which is a different text block rather than a
    // different value for the same one.
    //
    // The width is read from the hero's own rule, not the first `max-width` in
    // the file: every page's `.page` sets one, so scanning the file would have
    // measured the page container every single time and passed.
    for (const page of MARKETING.filter((p) => !NO_HERO.includes(p))) {
      const rule = heroRule(page);
      const width = rule?.body.match(/max-width:\s*([^;]+);/)?.[1]?.trim();
      expect(width, `${page} .${rule?.selector} has no max-width measure`).toBeDefined();
      expect(width, `${page} .${rule?.selector} measure`).toBe("600px");
    }
  });
});

describe("the scales the rhythms are written in", () => {
  it("defines every spacing token a shell rhythm names", () => {
    // The rhythms above are written as token names, not numbers. That is what
    // makes them a rhythm: a page that moves with the scale rather than against
    // it. It only holds if every token named is one the scale actually defines —
    // `--space-9` would be a plausible typo that renders as `padding: 0`.
    for (const side of Object.values(RHYTHMS).flat()) {
      // `toMatch`, not `toContain`: `toContain` is substring-only and coerces a
      // RegExp to its source text, so it reports a miss on a token that is
      // right there in the file.
      expect(
        new RegExp(`${side}\\s*:`).test(globalsCss),
        `${side} is not defined in globals.css`,
      ).toBe(true);
    }
  });
});
