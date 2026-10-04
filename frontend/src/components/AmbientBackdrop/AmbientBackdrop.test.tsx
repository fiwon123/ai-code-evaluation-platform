import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import AmbientBackdrop from "./AmbientBackdrop.tsx";
import styles from "./AmbientBackdrop.module.css";

/**
 * Data locks for the shared ambient wash (issue #402).
 *
 * ## What this file asserts, and what it deliberately does not
 *
 * The component's own contract is a rendering contract — two variants, one of
 * them a redesign nobody asked for — so that part is asserted by rendering it.
 *
 * The host contract (`position: relative` + `isolation: isolate` +
 * `overflow: hidden` on the element that contains the backdrop) is a
 * *stylesheet* contract, and it is checked here as one. That is not the source
 * grep this repo distrusts: a grep is weak evidence that a behaviour is absent,
 * and this is not a claim about behaviour. The claim is the narrower, literal
 * one — "this rule declares these three properties" — and no browser observation
 * could state it more precisely.
 *
 * The behavioural half is not left resting on the text check. `z-index: -1`
 * painting behind a host's own background, a blur bleeding past a header, and a
 * backdrop that fills nothing are all things the declaration above does not
 * guarantee: any later rule can undo them, and a caller can put the backdrop
 * somewhere the declaration never applied. Those are observed, in computed
 * style, in `e2e/ambient-wash.spec.ts`, on every route and in both themes.
 *
 * So the two files fail differently, which is the point: this one fails at
 * author time, on the line that was forgotten; that one fails on the page that
 * rendered wrong.
 */

/** Every stylesheet that mounts the wash, and the rule that hosts it. */
const HOST_SHELLS = [
  "components/AuthLayout/AuthLayout.module.css",
  "pages/About/About.module.css",
  "pages/Admin/Admin.module.css",
  "pages/ChallengeDetail.module.css",
  "pages/Challenges.module.css",
  "pages/Contact/Contact.module.css",
  "pages/CreateChallenge.module.css",
  "pages/Demo/Demo.module.css",
  "pages/EditChallenge.module.css",
  "pages/Features/Features.module.css",
  "pages/Legal/Legal.module.css",
  "pages/NotFound.module.css",
  "pages/Pricing/Pricing.module.css",
  "pages/Profile/Profile.module.css",
  "pages/SharedResultPage.module.css",
  "pages/SubmissionDetail.module.css",
] as const;

/**
 * Vite's own file serving, as raw text.
 *
 * The keys come back minimised and relative to *this* file (`../AuthLayout/…`,
 * `../../pages/About/…`), so they are resolved against `import.meta.url` and
 * re-keyed by their path under `src/`. Hand-writing the key for a path — the
 * obvious first cut — silently misses files, because the minimisation is not
 * uniform: a sibling directory is one `../`, anything else is two.
 */
const HERE = import.meta.url;
/** `…/frontend/src/` — the root the re-keyed paths below are relative to. */
const SRC_DIR = new URL("../../", HERE);

function underSrc(path: string): string {
  const at = path.indexOf("/src/");
  return at === -1 ? path : path.slice(at + "/src/".length);
}

function indexBySourcePath(
  modules: Record<string, string>,
): Map<string, string> {
  return new Map(
    Object.entries(modules).map(([key, text]) => [
      underSrc(new URL(key, HERE).pathname),
      text,
    ]),
  );
}

const CSS = indexBySourcePath(
  // `*.css`, not `*.module.css`: `styles/ambient.css` holds the keyframes and
  // the reduced-motion rule the wash composes, and is not a module.
  import.meta.glob("../../**/*.css", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>,
);

const TSX = indexBySourcePath(
  import.meta.glob("../../**/*.tsx", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>,
);

/** `body` of every rule in a stylesheet, paired with its selector. */
function rules(source: string): { selector: string; body: string }[] {
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: (match[1] ?? "").trim().split("\n").pop()!.trim(),
    body: match[2] ?? "",
  }));
}

/**
 * Strip CSS comments so a declaration named in prose is not counted as one.
 *
 * Both this docblock's own subject and the reason it is spelled out in words:
 * a block terminator inside a comment ends that comment, whatever the author
 * intended. Written as a regex rather than inline for the same reason.
 */
function declarations(body: string): string {
  return body.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("the ambient backdrop", () => {
  it("paints the two-blob wash by default, and stays out of the a11y tree", () => {
    const { container } = render(<AmbientBackdrop />);
    const backdrop = container.querySelector<HTMLElement>("[aria-hidden='true']")!;
    expect(backdrop, "the backdrop must be hidden from assistive tech").toBeTruthy();
    // Decoration that a screen reader announces, or that swallows a click meant
    // for the header behind it, is a bug in the decoration itself.
    expect(backdrop.className).toContain(styles.wash!);
    expect(backdrop.className).not.toContain(styles.auth!);
    expect(backdrop.children).toHaveLength(2);
    expect(backdrop.querySelector(`.${styles.blobPrimary}`)).toBeTruthy();
    expect(backdrop.querySelector(`.${styles.blobAccent}`)).toBeTruthy();
    // Every blob carries the shared drift; that is the whole reason they are spans
    // in one component rather than divs in seventeen stylesheets.
    for (const blob of backdrop.children) {
      expect(blob.className).toContain(styles.drift!);
    }
  });

  it("keeps AuthLayout's three blobs as a variant rather than replacing them", () => {
    // #402's scope was "every page except Home". The sign-in shell's teal/violet
    // pair predates it and is not a header wash; swapping it for two blobs would
    // be a redesign. A test that renders the default here would let that happen
    // silently.
    const { container } = render(<AmbientBackdrop variant="auth" />);
    const backdrop = container.querySelector<HTMLElement>("[aria-hidden='true']")!;
    expect(backdrop.className).toContain(styles.auth!);
    expect(backdrop.children).toHaveLength(3);
    expect(backdrop.querySelector(`.${styles.blobTeal}`)).toBeTruthy();
    expect(backdrop.querySelector(`.${styles.blobViolet}`)).toBeTruthy();
    // The wash's bottom-right blob is the thing being kept out, so assert it is
    // out rather than merely unmentioned above.
    expect(backdrop.querySelector(`.${styles.blobAccent}`)).toBeNull();
  });

  it("composes the drift from the shared stylesheet instead of re-declaring it", () => {
    // The trap this guards is the reason the wash became a component: a local
    // `animation: auroraDrift` inside a CSS-modules rule is rewritten to a
    // scoped name that matches no keyframes, the animation silently never runs,
    // and every test in the repo stays green because none of them looked.
    // Matched on the *source* selector, not `styles.drift`: vitest compiles CSS
    // modules, so at runtime that is a hash that appears nowhere in the file.
    const drift = rules(CSS.get("components/AmbientBackdrop/AmbientBackdrop.module.css") ?? "")
      .find((rule) => rule.selector === ".drift");
    expect(drift, "the drift class must exist in the shared module").toBeTruthy();
    expect(declarations(drift!.body)).toMatch(
      /composes:\s*ambientDrift\s+from\s+"\.\.\/\.\.\/styles\/ambient\.css"/,
    );
    // …and the keyframes it composes have to be the ones the reduced-motion rule
    // switches off, or the two files disagree about what "no motion" means.
    const ambient = CSS.get("styles/ambient.css") ?? "";
    expect(ambient).toMatch(/@keyframes\s+auroraDrift/);
    expect(ambient).toMatch(/prefers-reduced-motion:\s*reduce/);
  });

  it("gives every shell that mounts it the full host contract", () => {
    for (const path of HOST_SHELLS) {
      const source = CSS.get(path);
      expect(source, `${path} is listed as a host shell but does not exist`).toBeTruthy();
      const hosts = rules(source!)
        .filter((rule) => /isolation:\s*isolate/.test(declarations(rule.body)));
      expect(
        hosts.length,
        `${path} mounts the wash but no rule establishes a stacking context for it`,
      ).toBeGreaterThan(0);
      for (const host of hosts) {
        const body = declarations(host.body);
        const label = `${path} ${host.selector}`;
        // `isolation` alone hides the blobs behind the page background; the blur
        // without `overflow` paints over the page below the header.
        expect(body, `${label} must anchor the absolute backdrop`).toMatch(
          /position:\s*relative/,
        );
        expect(body, `${label} must clip the 80px blur to the header`).toMatch(
          /overflow:\s*hidden/,
        );
      }
    }
  });

  it("lists every stylesheet that mounts the wash, so a new page cannot skip the contract", () => {
    // Bookkeeping, not behaviour: this cannot tell whether a page renders right.
    // What it does stop is the failure mode of a hand-kept list — a seventeenth
    // page adopting the wash with nobody adding it here, where the trio is only
    // ever checked on the sixteen that were remembered.
    const mounts = [...TSX.entries()]
      .filter(
        ([path, source]) =>
          !path.endsWith(".test.tsx") && /<AmbientBackdrop[\s/>]/.test(source),
      )
      .flatMap(([path, source]) => {
        // From the import, not from the filename: the four admin pages live in one
        // directory and share `Admin.module.css`, so a same-named module would find
        // three of them missing and quietly shrink the list instead of failing.
        return [...source.matchAll(/from\s+"(\.{1,2}\/[^"]*\.module\.css)"/g)].map(
          (match) =>
            underSrc(new URL(match[1]!, new URL(path, SRC_DIR)).pathname),
        );
      })
      // `AmbientBackdrop` is not a caller of itself, and Home keeps its own
      // ambient layer by design, so neither is a shell.
      .filter((path) => !path.includes("components/AmbientBackdrop/"))
      .filter((path) => !path.includes("pages/Home/"))
      // Deduplicated: the four admin components resolve to the one stylesheet
      // they share, and the host contract is a property of the stylesheet, not of
      // each component that happens to mount the wash into it.
      .filter((path, index, all) => all.indexOf(path) === index)
      .sort();

    expect(mounts, "a page mounts the wash but is not covered by the host-contract check").toEqual(
      [...HOST_SHELLS].sort(),
    );
  });
});
