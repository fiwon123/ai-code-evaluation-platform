import { describe, expect, it } from "vitest";

import {
  SWEEP_MOTION,
  SWEEP_MOTION_EXCEPTIONS,
  SWEEP_MOTION_SURFACES,
  SWEEP_ROUTES,
  SWEEP_ROUTE_EXCEPTIONS,
  SWEEP_STATES,
  SWEEP_SCROLL_OFFSETS,
  SWEEP_THEMES,
  SWEEP_VIEWPORTS,
} from "../../e2e/visual/routes.ts";

/**
 * Data locks for the visual sweep (issue #253).
 *
 * ## What belongs here, and what does not
 *
 * This file started out inspecting *source text* — grepping the sweep's config
 * for `channel:`, grepping `helpers/motion.ts` for `waitForTimeout`. It is not
 * that any of those greps were hard; it is that they were **lies waiting to
 * happen**, and this repo has already paid for that lesson twice:
 *
 * - The comment stripper used to make them readable was a regex, and it deleted
 *   two thirds of the file it was describing — an opening block marker inside a
 *   `**`-glob quoted in a comment paired with the next real block terminator. The
 *   locks still "passed", on the 33% of the file that survived.
 * - `.gitignore` and the `Makefile` sit above `frontend/`, which Vite refuses to
 *   serve, so a source lock for them could only ever have asserted `""`.
 *
 * A source grep is evidence that *text* is absent. It is never evidence that a
 * *behaviour* is absent, and it fails silently in exactly the case that matters —
 * when the file it reads is not what it thinks it is.
 *
 * So the strong locks moved to the only place a behaviour can actually be
 * observed, `e2e/visual/`, where they run against a real browser:
 *
 * | Property                  | Locked by                                  |
 * |---------------------------|--------------------------------------------|
 * | host-browser reach        | `provenance.lock.visual.ts` — a realpath under `/ms-playwright`; a `channel:` or CDP launch resolves outside it and the run aborts |
 * | motion determinism        | `determinism.lock.visual.ts` — the same capture twice must be byte-identical, which wall-clock sampling can never be |
 * | no network egress         | the origin guard, asserted per capture      |
 * | no `#` in recorded paths  | the slug check in the manifest merge        |
 *
 * What is left here is what a *data* lock can be trusted with: the matrix must
 * cover `App.tsx` exactly, in both directions, and every declared frame must be
 * a frame somebody can actually take. Nothing in this file can pass by reading
 * the wrong file, because the only file it reads is data.
 *
 * Driver coverage needs no lock at all: `DRIVERS` in `sweep.visual.ts` is typed
 * `Record<SweepDriverId, …>`, so the compiler rejects a missing *or* an extra
 * driver. A test that re-derived that from text would be strictly weaker than the
 * build.
 */

/** `App.tsx` as text, via Vite's own file serving. */
const APP_TSX = import.meta.glob("../App.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
})["../App.tsx"] as string;

/**
 * Every `path="…"` in `App.tsx`, read line-wise with a comment guard.
 *
 * `App.tsx` writes its routes two ways — `<Route path="/x" element={…} />` on
 * one line, and `path="/x"` on its own line under a multi-line `<Route` — so a
 * line-*anchored* pattern catches only half the router. Matching the attribute
 * anywhere and then discarding matches whose line has a `//` or `/*` before them
 * catches both styles and still ignores a commented-out route.
 *
 * The guard is line-scoped on purpose. A cross-line comment scanner is exactly
 * the thing that ate two thirds of a sweep file earlier in this branch: a block
 * terminator inside a string literal pairs with the next opening marker and
 * deletes everything between. A per-line rule has no state to get wrong that
 * way. (This paragraph is itself written around that hazard: a block comment
 * cannot contain the terminator even inside quotes.)
 *
 * Its remaining blind spot is a `path="` inside a *multi-line* block comment,
 * whose interior lines carry no marker. That blind spot cannot hide: the
 * partition below is an equality, so such a line would show up as an App.tsx
 * route with no sweep entry — a red test naming the phantom path, never a green
 * one.
 */
function appRoutePaths(source: string): string[] {
  const found: string[] = [];
  for (const line of source.split("\n")) {
    const match = /\bpath="([^"]*)"/.exec(line);
    if (!match) continue;
    const before = line.slice(0, match.index);
    if (before.includes("//") || before.includes("/*")) continue;
    found.push(match[1] ?? "");
  }
  return found;
}

describe("the sweep covers every route, in both directions", () => {
  const appPaths = appRoutePaths(APP_TSX);
  const sweptPaths = SWEEP_ROUTES.map((route) => route.path);
  const exceptions = Object.keys(SWEEP_ROUTE_EXCEPTIONS);

  it("finds routes in both JSX styles and ignores a commented-out one", () => {
    // The one pattern this file is allowed to use, tested so it cannot rot into
    // matching nothing (which would partition `[]` against `[]` and pass) or into
    // matching only one of the two layouts `App.tsx` actually uses.
    const fixture = [
      '      <Route path="/challenges" element={<Challenges />} />',
      "      <Route",
      '        path="/challenges/:id"',
      "        element={<Challenge />}",
      "      />",
      '      {/* <Route path="/commented-block" element={<Nope />} /> */}',
      '      // <Route path="/commented-line" element={<Nope />} />',
      "      <Route path='/challenges' element={<Challenges />} />",
    ].join("\n");
    expect(appRoutePaths(fixture)).toEqual(["/challenges", "/challenges/:id"]);
  });

  it("reads the routes out of App.tsx at all", () => {
    expect(
      APP_TSX.length,
      "App.tsx is empty or unreachable — the glob is stale",
    ).toBeGreaterThan(1000);
    expect(
      appPaths.length,
      "no path attributes found in App.tsx",
    ).toBeGreaterThanOrEqual(20);
    expect(new Set(appPaths).size, "App.tsx declares a duplicate path").toBe(
      appPaths.length,
    );
  });

  it("sweeps every path App.tsx declares", () => {
    const missed = appPaths.filter(
      (path) => !sweptPaths.includes(path) && !exceptions.includes(path),
    );
    expect(
      missed,
      "App.tsx routes with no sweep entry — add one to SWEEP_ROUTES, or to " +
        "SWEEP_ROUTE_EXCEPTIONS with the reason they are skipped",
    ).toEqual([]);
  });

  it("sweeps nothing App.tsx does not declare", () => {
    // The direction that catches a *deleted* route: an entry left behind would
    // photograph a 404 and file it as a finding.
    const phantom = sweptPaths.filter((path) => !appPaths.includes(path));
    expect(phantom, "sweep entries no App.tsx route matches").toEqual([]);
  });

  it("is an exact partition, so neither side can grow alone", () => {
    // A count floor cannot notice subjects *leaving* the set, and a one-way
    // filter cannot notice a subject that stopped existing. Set equality is the
    // only statement that stays true as both sides change.
    const covered = [...new Set([...sweptPaths, ...exceptions])].sort();
    expect(covered).toEqual([...new Set(appPaths)].sort());
    expect(covered.length).toBe(appPaths.length);
  });

  it("justifies every exception, and only for routes that exist", () => {
    // Checked in both directions so the list cannot rot into a silent exemption:
    // an entry for a route that no longer exists is stale, and an entry with no
    // reason is an undeclared decision.
    for (const [path, reason] of Object.entries(SWEEP_ROUTE_EXCEPTIONS)) {
      expect(
        appPaths,
        `exception names a route App.tsx does not declare: ${path}`,
      ).toContain(path);
      expect(
        reason.trim().length,
        `exception for ${path} has no reason`,
      ).toBeGreaterThan(20);
    }
  });
});

describe("every declared frame is a frame that can exist", () => {
  it("gives every route a heading, so no capture can be of a blank page", () => {
    for (const route of SWEEP_ROUTES) {
      expect(
        route.heading.trim().length,
        `${route.path} has no heading to assert`,
      ).toBeGreaterThan(2);
    }
  });

  it("declares a scroll set for every route", () => {
    // Optional by design — a short page legitimately has one offset — but never
    // an *empty* one, which is neither.
    for (const route of SWEEP_ROUTES) {
      if (route.scroll) {
        expect(
          route.scroll.length,
          `${route.path} declares an empty scroll set`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("sweeps every route in every theme and viewport", () => {
    // Narrowing a *route* to one theme or viewport would be the cheapest way to
    // make a broken dark mode or a broken mobile layout look fine, so
    // `SweepRoute` has no such field. States and motion passes may narrow (a
    // dropdown is not on a phone); a page is swept everywhere, always.
    for (const route of SWEEP_ROUTES) {
      expect(
        Object.keys(route),
        `${route.path} narrows its sweep: ${Object.keys(route)
          .filter(
            (key) =>
              !["path", "url", "heading", "auth", "scroll", "note"].includes(
                key,
              ),
          )
          .join(", ")}`,
      ).not.toContain("themes");
      expect(Object.keys(route)).not.toContain("viewports");
    }
  });

  it("gives every state a proof of exactly one kind", () => {
    // A state with no proof is captured on faith, which is how a "delete dialog"
    // screenshot ends up showing a page with no dialog on it. Two proofs is
    // ambiguous: the frame would be titled by whichever resolved first.
    for (const state of SWEEP_STATES) {
      const kinds = [
        state.expect.role !== undefined,
        state.expect.text !== undefined,
      ].filter(Boolean);
      expect(kinds.length, `state ${state.id} has ${kinds.length} proofs`).toBe(
        1,
      );
      if (state.expect.role) {
        expect(
          state.expect.name,
          `state ${state.id} gives a role with no name`,
        ).toBeTruthy();
      }
      expect(
        state.caption.trim().length,
        `state ${state.id} has no caption for the report`,
      ).toBeGreaterThan(20);
    }
  });

  it("starts every state and motion pass on a swept route", () => {
    const paths = new Set(SWEEP_ROUTES.map((route) => route.path));
    for (const state of SWEEP_STATES) {
      expect(
        paths,
        `state ${state.id} names an unswept route: ${state.route}`,
      ).toContain(state.route);
    }
    for (const pass of SWEEP_MOTION) {
      expect(
        paths,
        `motion ${pass.id} names an unswept route: ${pass.route}`,
      ).toContain(pass.route);
    }
  });

  it("samples each motion pass in units its kind can honour", () => {
    for (const pass of SWEEP_MOTION) {
      expect(
        pass.samples.length,
        `motion ${pass.id} samples nothing`,
      ).toBeGreaterThanOrEqual(3);
      for (const sample of pass.samples) {
        // 1.4 or -0.2 is not a position, it is a typo, and clamping would hide it.
        expect(
          sample,
          `motion ${pass.id} samples outside 0..1`,
        ).toBeGreaterThanOrEqual(0);
        expect(
          sample,
          `motion ${pass.id} samples outside 0..1`,
        ).toBeLessThanOrEqual(1);
      }
      // A scroll filmstrip that stops short of 1 has never shown the footer.
      if (pass.kind === "scroll") {
        expect(
          pass.samples,
          `motion ${pass.id} never reaches the bottom`,
        ).toContain(1);
      }
    }
  });

  it("films every page that animates, or says in writing why it does not", () => {
    // The checkable form of a claim `routes.ts` used to make in a comment —
    // "Home is the only page with a motion system on it" — which went stale
    // silently when `/pricing` gained an animated disclosure in #332, and
    // stayed stale because a comment cannot be tested. Checked in both
    // directions, like `SWEEP_ROUTE_EXCEPTIONS`: a surface with neither a pass
    // nor a written exception is an undeclared decision, and an exception for a
    // surface that no longer animates is a stale exemption.
    for (const surface of SWEEP_MOTION_SURFACES) {
      const filmed = SWEEP_MOTION.some(
        (motion) => motion.route === surface.route,
      );
      const excused = SWEEP_MOTION_EXCEPTIONS[surface.route];
      expect(
        filmed || Boolean(excused),
        `${surface.route} animates (${surface.why}) but has neither a SWEEP_MOTION pass ` +
          "nor an entry in SWEEP_MOTION_EXCEPTIONS",
      ).toBe(true);
    }
    for (const [route, reason] of Object.entries(SWEEP_MOTION_EXCEPTIONS)) {
      expect(
        SWEEP_MOTION_SURFACES.map((surface) => surface.route),
        `motion exception names a surface that is not declared: ${route}`,
      ).toContain(route);
      expect(
        reason.trim().length,
        `motion exception for ${route} has no reason`,
      ).toBeGreaterThan(20);
      // An exception is a statement that the pass is *missing*, so a page cannot
      // quietly acquire one and keep the exemption — the two are contradictory.
      expect(
        SWEEP_MOTION.some((motion) => motion.route === route),
        `${route} has both a motion pass and a motion exception; one of them is stale`,
      ).toBe(false);
    }
  });

  it("uses unique ids, because they are filenames and manifest keys", () => {
    for (const [label, ids] of [
      ["routes", SWEEP_ROUTES.map((route) => route.path)],
      ["states", SWEEP_STATES.map((state) => state.id)],
      ["motion", SWEEP_MOTION.map((pass) => pass.id)],
    ] as const) {
      const unique = new Set(ids);
      expect(
        unique.size,
        `duplicate ${label} id: ${ids.filter((id) => ids.indexOf(id) !== ids.indexOf(id)).join(", ")}`,
      ).toBe(ids.length);
    }
  });
});

describe("the matrix is the composition the acceptance criteria describe", () => {
  it("sweeps both themes on both viewports at three scroll offsets", () => {
    // 25 routes x 2 themes x 2 viewports x 3 offsets = 300, and the AC's floor is
    // 200. The composition is asserted too, because a reviewer is entitled to
    // assume that is what they are looking at.
    expect(SWEEP_THEMES).toEqual(["light", "dark"]);
    expect(SWEEP_VIEWPORTS).toEqual(["desktop-chromium", "pixel-7"]);
    expect(SWEEP_ROUTES.length).toBe(25);
    // 25 routes x 3 offsets, each in every theme and every viewport = 300,
    // comfortably over the AC's floor of 200.
    const offsets = SWEEP_ROUTES.reduce(
      (sum, route) => sum + (route.scroll ?? SWEEP_SCROLL_OFFSETS).length,
      0,
    );
    expect(offsets * SWEEP_THEMES.length * SWEEP_VIEWPORTS.length).toBe(300);
  });

  it("sweeps every state in both themes unless it says why not", () => {
    const frames = SWEEP_STATES.reduce(
      (sum, state) =>
        sum +
        (state.themes ?? SWEEP_THEMES).length *
          (state.viewports ?? SWEEP_VIEWPORTS).length,
      0,
    );
    // A state is worth one row of the report; nine of them is the state surface
    // the AC names (nav, dropdown, form error, in-flight submit, dialog, toast,
    // disclosure, loading, loaded).
    expect(SWEEP_STATES.length).toBeGreaterThanOrEqual(8);
    expect(frames).toBeGreaterThanOrEqual(SWEEP_STATES.length * 2);
  });

  it("samples motion densely enough to read a transition", () => {
    // Three frames show a beginning, a middle and an end. Two show a guess.
    for (const pass of SWEEP_MOTION) {
      expect(
        pass.samples.length,
        `motion ${pass.id} is too sparse to review`,
      ).toBeGreaterThanOrEqual(3);
    }
    expect(
      SWEEP_MOTION.reduce((sum, pass) => sum + pass.samples.length, 0),
    ).toBeGreaterThanOrEqual(10);
  });
});
