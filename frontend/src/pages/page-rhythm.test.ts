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
  "CreateChallenge.module.css": "app",
  "EditChallenge.module.css": "app",
  "NotFound.module.css": "app",
  "Profile/Profile.module.css": "app",
  "ChallengeDetail.module.css": "detail",
  "SharedResultPage.module.css": "detail",
  "SubmissionDetail.module.css": "detail",
};

/**
 * Pages that carry their rhythm in their own top-level sections.
 *
 * `Home` opens with a full-bleed hero — a gradient wash and two ambient blobs
 * that are meant to run to the top of the viewport — so wrapping it in a
 * `.page` shell with padding would push the artwork down and change the design.
 * Its sections are therefore self-paced, and the gutter is checked on each of
 * them rather than skipped.
 *
 * This is the third category, and it exists because the lock used to have only
 * two: classified, or ignored. `Home` was in neither, so nothing checked it —
 * which is how `.cta` ended up on an 8-unit gutter while the app was on 6.
 */
const SELF_PACED: Record<string, string[]> = {
  "Home/Home.module.css": [".hero", ".section", ".cta"],
};


function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Normalise a `padding` shorthand to `[top, side, bottom]`, or null if the
 *  value is not a shorthand this test understands. */
function normalisePadding(value: string): string[] | null {
  const parts = value.trim().split(/\s+/).map((p) => p.replace(/^var\(|\)$/g, ""));
  // `padding: X` is all four sides; `X Y` is top/bottom + sides;
  // `X Y Z` is top/side/bottom; `X Y Z W` is top/side/bottom/side.
  if (parts.length === 1) return [parts[0], parts[0], parts[0]];
  if (parts.length === 2) return [parts[0], parts[1], parts[0]];
  if (parts.length === 3) return [parts[0], parts[1], parts[2]];
  if (parts.length === 4) return [parts[0], parts[1], parts[3]];
  return null;
}

/** The body of the first rule for `selector`, or null if it has none. */
function ruleBody(css: string, selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(stripComments(css))?.[1] ?? null;
}

/** The `padding` shorthand of a page's `.page` rule, normalised to three sides. */
function shellPadding(css: string): string[] | null {
  const value = ruleBody(css, ".page")?.match(/(?:^|;)\s*padding:\s*([^;]+);/)?.[1];
  return value ? normalisePadding(value) : null;
}

const SHELLS = Object.entries(MODULES).map(([path, css]) => ({
  // Glob keys are relative to this file: "./About/About.module.css".
  page: path.replace(/^\.\.\/pages\//, "").replace(/^\.\//, ""),
  padding: shellPadding(css),
}));

/** Pages with no `.page` padding of their own: the auth pages, whose layout
 *  is the shared `AuthLayout` and whose own `.page` is a loading placeholder. */
const HANDED_OFF = ["Login.module.css", "OAuthCallback.module.css", "Register.module.css"];

/** Whether a module is accounted for: classified, self-paced, or handed off. */
function isAccountedFor(page: string): boolean {
  return page in PAGE_GROUP || page in SELF_PACED || HANDED_OFF.includes(page);
}

describe("page shell rhythm", () => {
  it("accounts for every page shell, and nothing unaccounted for", () => {
    // A new page must be placed in a group. If it is missing here, the loop
    // below would skip it and the page would ship on whatever rhythm its author
    // typed — which is how the drift started.
    //
    // The previous version of this test filtered on `s.padding`, so a `.page`
    // rule with *no* `padding` was invisible to it — which is precisely the
    // case the comment above describes. `CreateChallenge` and `EditChallenge`
    // shipped with no gutter at all and the test stayed green. Nothing is
    // filtered now: a module is either accounted for or it fails.
    const unaccounted = SHELLS.filter((s) => !isAccountedFor(s.page));
    expect(
      unaccounted.map((s) => s.page),
      "page shell(s) with no declared rhythm — classify in PAGE_GROUP or SELF_PACED, or add to HANDED_OFF",
    ).toEqual([]);
  });

  it("checks every shell it claims to, so pages cannot fall out of the set", () => {
    // `expect(SHELLS.filter((s) => s.padding).length).toBeGreaterThan(10)` was a
    // count floor: a page whose padding stopped being readable simply left the
    // set, and the floor still passed. Coverage is now an exact partition.
    const classified = SHELLS.filter((s) => s.page in PAGE_GROUP);
    const selfPaced = SHELLS.filter((s) => s.page in SELF_PACED);
    const handedOff = SHELLS.filter((s) => HANDED_OFF.includes(s.page));
    expect(classified.length).toBe(Object.keys(PAGE_GROUP).length);
    expect(selfPaced.length).toBe(Object.keys(SELF_PACED).length);
    expect(handedOff.length).toBe(HANDED_OFF.length);
    expect(classified.length + selfPaced.length + handedOff.length).toBe(SHELLS.length);
  });

  it("gives every page a readable .page padding, not an absent one", () => {
    // The distinction the old test blurred: "no padding" is not a page that
    // opted out of the rhythm, it is a page with no rhythm.
    for (const { page, padding } of SHELLS) {
      if (!(page in PAGE_GROUP)) continue;
      expect(
        padding,
        `${page} has no readable .page padding — it will render with no gutter`,
      ).not.toBeNull();
    }
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

  it("gates the self-paced pages section by section, rather than not at all", () => {
    // `Home` is not skipped for having no `.page` shell; each of its top-level
    // sections is held to the same gutter as every other page in the app.
    // The padding is parsed with the same normaliser as `.page`, so a section
    // cannot be judged by a second, laxer set of rules.
    for (const [page, sections] of Object.entries(SELF_PACED)) {
      const css = stripComments(MODULES[`./${page}`] ?? "");
      expect(css, `${page} is in SELF_PACED but has no stylesheet`).not.toBe("");
      for (const section of sections) {
        const body = ruleBody(css, section);
        expect(body, `${page} has no \`${section}\` rule`).not.toBeNull();
        const value = body?.match(/(?:^|;)\s*padding:\s*([^;]+);/)?.[1];
        expect(value, `${page} \`${section}\` declares no padding shorthand`).toBeDefined();
        const padding = value ? normalisePadding(value) : null;
        expect(padding?.[1], `${page} \`${section}\` gutter`).toBe("--space-6");
      }
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
   * The list is empty: every marketing page now renders the hero subtitle.
   * Kept as an explicit (empty) set rather than deleted so that the guard
   * below — a page that loses its hero must fail loudly — keeps its shape.
   */
  const NO_HERO: string[] = [];

  /**
   * Marketing pages whose hero chrome comes from `PageHeader` (issue #404),
   * mapped to the component that renders their header block.
   *
   * Explicit, like `PAGE_GROUP`: the delegation is a decision, not something to
   * infer. `/legal` adopted `PageHeader` and so stopped declaring its own
   * `.subtitle`, which means its hero rule now lives in the component. The
   * delegation itself is asserted below, so this map cannot become a way to make
   * a missing rule quietly pass.
   */
  const HEADER_OWNER: Record<string, string> = {
    "Legal/Legal.module.css": "Legal/LegalShell.tsx",
  };

  /** The shared stylesheet a delegated hero is styled by. */
  const PAGE_HEADER_CSS = Object.values(
    import.meta.glob("../components/PageHeader/*.module.css", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>,
  ).join("\n");

  /**
   * Page component sources, keyed by their path under `pages/` — the same shape
   * as `MODULES`, so the two registries can be written the same way. Test files
   * are excluded: a spec that happens to render a `PageHeader` is not a page
   * that delegates its header to one.
   */
  const PAGE_SOURCES = new Map(
    Object.entries(
      import.meta.glob("../**/*.tsx", {
        query: "?raw",
        import: "default",
        eager: true,
      }) as Record<string, string>,
    )
      .filter(([key]) => !key.endsWith(".test.tsx"))
      .map(([key, source]) => [key.replace(/^(\.{1,2}\/)+/, ""), source] as const),
  );

  /**
   * The hero subtitle rule, from the page's own stylesheet or — for a page that
   * delegated its header to `PageHeader` — from the component's.
   *
   * The role used to be named `.subtitle`, `.pageSubtitle`, `.tagline` and
   * `.summary` across the marketing pages; the v0.21.0 harmonization pass
   * renamed them all to `.subtitle` (issue #307), so one name is read and a
   * page that reintroduces a variation fails.
   */
  function heroRule(page: string): { selector: string; body: string } | null {
    const own = /([^{}]*)\.subtitle\s*\{([^}]*)\}/.exec(
      stripComments(MODULES[`./${page}`] ?? ""),
    );
    if (own) return { selector: "subtitle", body: own[2] ?? "" };

    if (!HEADER_OWNER[page]) return null;
    // A delegated hero is styled by the component's marketing tone. The rule is
    // read from the component rather than skipped, so these pages keep their
    // measure and type-scale coverage instead of quietly dropping out of it.
    const shared = /\.marketing\s+\.subtitle\s*\{([^}]*)\}/.exec(PAGE_HEADER_CSS);
    return shared ? { selector: "marketing .subtitle", body: shared[1] ?? "" } : null;
  }

  it("delegates only to a component that really renders these headers", () => {
    // Guards the delegation itself. Without this, a page could earn an entry in
    // `HEADER_OWNER` by deleting its `.subtitle` rule and nothing would notice
    // that the hero it stopped styling had not been adopted by anything — which
    // is the failure this whole file exists to make loud.
    for (const [page, owner] of Object.entries(HEADER_OWNER)) {
      const source = PAGE_SOURCES.get(owner);
      expect(source, `${page} delegates its header to a missing file: ${owner}`).toBeTruthy();
      expect(
        source,
        `${owner} is named as ${page}'s header owner but does not render a PageHeader`,
      ).toMatch(/<PageHeader[\s/>]/);
    }
  });

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
