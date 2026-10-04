/**
 * The visual sweep's matrix: which routes, which states, which motion passes.
 *
 * One source of truth, read by two consumers that must agree:
 *
 *   - `sweep.visual.ts` photographs what is declared here.
 *   - `src/pages/visual-sweep.lock.test.ts` partitions the `path` column
 *     against `App.tsx`, so a route added to the app and not swept (or swept
 *     and not routed) fails `make check`.
 *
 * Both consumers import these objects rather than re-parsing this file, which
 * is deliberate. A lock that greps the sweep's source for route strings and the
 * sweep that reads its own data would be two parsers of one file, free to
 * disagree — the exact shape of failure that shipped a `<NavLink>`-wrapped
 * button in #244. Here the lock reads the *values* the sweep shoots.
 *
 * The file imports nothing (not even `@playwright/test`) on purpose: it is
 * listed in both composite TS projects — `tsconfig.e2e.json` owns it as e2e
 * source, and `tsconfig.app.json` lists it so the lock under `src/` can import
 * it. `composite: true` requires every file a project compiles to be named in
 * its `include`, which is why the app project has to name this one.
 */

/** The two themes the app ships (`src/utils/theme.ts`). */
export const SWEEP_THEMES = ["light", "dark"] as const;
export type SweepTheme = (typeof SWEEP_THEMES)[number];

/** Viewport profiles, matching the project names in `playwright.visual.config.ts`. */
export const SWEEP_VIEWPORTS = ["desktop-chromium", "pixel-7"] as const;
export type SweepViewport = (typeof SWEEP_VIEWPORTS)[number];

/** How a route must be authenticated before it renders anything. */
export type SweepAuth = "guest" | "user" | "admin";

/** Scroll offsets to photograph, as fractions of the scrollable range. */
export type ScrollFraction = 0 | 0.5 | 1;

/**
 * The offsets a route is photographed at unless it narrows them.
 *
 * Exported rather than repeated: the spec walks the matrix with it, the
 * teardown recomputes the expected frame count from it, and the lock asserts
 * the arithmetic. Three copies of `[0, 0.5, 1]` is three chances for the audit
 * to disagree with the run it is auditing — and an audit that under-counts the
 * matrix is worse than no audit, because it reports success.
 */
export const SWEEP_SCROLL_OFFSETS = [0, 0.5, 1] as const satisfies readonly ScrollFraction[];

export interface SweepRoute {
  /**
   * The `path` prop exactly as `App.tsx` writes it, including `:params` and the
   * `*` catch-all. This is the column the coverage lock partitions on, so it
   * must be character-identical to the route declaration.
   */
  path: string;
  /** A concrete URL to visit, with `:params` substituted. */
  url: string;
  /**
   * The page's `<h1>` text, which is asserted visible before any capture.
   *
   * A sweep that shoots without this produces valid-looking images of the
   * Suspense fallback, an auth redirect, or a `role="alert"` error state — the
   * blank captures are indistinguishable from correct ones, which is why the
   * rendered route is a precondition rather than a nicety.
   */
  heading: string;
  /** Which user the route needs. `guest` also works signed out. */
  auth: SweepAuth;
  /**
   * Scroll fractions to shoot. Defaults to `[0, 0.5, 1]` — top, middle and
   * bottom, the last of which is what proves the footer renders at all.
   *
   * Narrowed only where a page cannot scroll. Recording that explicitly is the
   * point: an entry here means "three identical frames is the honest answer",
   * not "we did not measure it".
   */
  scroll?: readonly ScrollFraction[];
  /**
   * A selector that must match before this route counts as settled, for pages
   * whose resting state is reached by a JS timeline rather than by its content
   * being present.
   *
   * `/` needs it: the terminal story is a ~6s chain of per-character renders, so
   * a frame shot on load lands wherever the story happened to be. The settle
   * helper only waits on CSS animations and transitions, and this story is
   * neither — it is `setTimeout` all the way down, which is the same reason the
   * story's own tests read state instead of sleeping. Without this the sweep
   * photographs a moving target and calls it "at rest".
   *
   * Matched against the terminal's own stage attribute, so this waits for the
   * story to *finish*, not merely for the panel to have faded in.
   */
  atRest?: string;
  /** Why this entry is shaped the way it is. Read by the reviewer. */
  note?: string;
}

/**
 * Every `path` in `App.tsx`, once each.
 *
 * The order is `App.tsx`'s own, so a reader diffing the two files is reading
 * the same list twice. The catch-all is last, as it is in the app.
 */
export const SWEEP_ROUTES: readonly SweepRoute[] = [
  {
    path: "/",
    url: "/",
    heading: "Generate, execute, and evaluate AI-written code — automatically",
    auth: "guest",
    atRest: '[class*="animPanel"] [class*="animStatus_"][data-stage="ready"]',
    note: "Carries the most motion surfaces in the app: Reveal stagger, .scrollReveal, ambient blobs/grid/code, useCountUp and the terminal story. Not all of them any more — the typewriter and the looping status chips were replaced by the terminal story in #352 (one chained timeline, a status tag per stage, results revealed as they resolve and a score ring), /demo gained its own Reveal stagger, ambient blobs and a cycling rail in #350, and /pricing has an animated disclosure, and the pipeline gained a sequential timeline plus a staggered step-card entrance in #353 (pipelineStepActive/connectorFlow/progressStages/stepCardIn). SWEEP_MOTION_SURFACES is the checkable version of that list. The panel also stopped being one of the hero's staggered Reveals in #352: it fades in itself now, because the story has to wait for that fade, so the entrance is a property of the panel rather than a fifth entry in the hero stagger — see `atRest` and the `home-reveal-transition` caption.",
  },
  {
    path: "/features",
    url: "/features",
    heading: "Features",
    auth: "guest",
  },
  {
    path: "/pricing",
    url: "/pricing",
    heading: "Simple, transparent pricing",
    auth: "guest",
  },
  {
    path: "/demo",
    url: "/demo",
    heading: "See how it works",
    auth: "guest",
    note: "Hosts the live demo panel, so it needs the /api fixtures even though the heading renders regardless.",
  },
  {
    path: "/about",
    url: "/about",
    heading: "About this project",
    auth: "guest",
  },
  {
    path: "/contact",
    url: "/contact",
    heading: "Get in touch",
    auth: "guest",
  },
  {
    path: "/privacy",
    url: "/privacy",
    heading: "Privacy Policy",
    auth: "guest",
  },
  {
    path: "/terms",
    url: "/terms",
    heading: "Terms of Service",
    auth: "guest",
  },
  {
    path: "/security",
    url: "/security",
    heading: "Security",
    auth: "guest",
  },
  {
    path: "/gdpr",
    url: "/gdpr",
    heading: "GDPR & Data Protection",
    auth: "guest",
  },
  {
    path: "/login",
    url: "/login",
    heading: "Welcome back",
    auth: "guest",
    note: "Redirects to /challenges when a user exists, so it is captured signed out.",
  },
  {
    path: "/register",
    url: "/register",
    heading: "Create your account",
    auth: "guest",
    note: "Also redirects to /challenges when a user exists.",
  },
  {
    path: "/auth/callback",
    url: "/auth/callback",
    heading: "Couldn’t log you in",
    auth: "guest",
    note: "The error branch is the only stable frame: the success branch <Navigate>s to /challenges before it can be photographed. The curly apostrophe is the app's, not a typo here.",
  },
  {
    path: "/challenges",
    url: "/challenges",
    heading: "Challenges",
    auth: "guest",
    note: "Replaces itself with a role=alert when /api/challenges fails, so a broken mock would show as a missing heading, not as a broken page.",
  },
  {
    path: "/challenges/:id",
    url: "/challenges/c-easy-1",
    heading: "Two Sum",
    auth: "guest",
    note: "Swept as a guest: the signed-in variant adds a visible 'compare providers' error banner, which is a fixture gap rather than a design to review.",
  },
  {
    path: "/results/:token",
    url: "/results/sweep-token",
    heading: "Two Sum",
    auth: "guest",
    note: "Public share link. mockApi has no /api/results handler, so the sweep routes one; the h1 is the shared result's challenge title.",
  },
  {
    path: "/challenges/new",
    url: "/challenges/new",
    heading: "Create a challenge",
    auth: "user",
  },
  {
    path: "/challenges/:id/edit",
    url: "/challenges/c-easy-1/edit",
    heading: "Edit challenge",
    auth: "user",
    note: "Ownership-gated: the fixtures are re-served with owner_id = the signed-in user, or the page renders 'You can only edit challenges you created.' and the h1 never appears.",
  },
  {
    path: "/submissions/:id",
    url: "/submissions/sweep-submission",
    heading: "Evaluation report",
    auth: "user",
    note: "The richest page in the app: status badge, score ring, attempt timeline, result report, code blocks and metrics.",
  },
  {
    path: "/profile",
    url: "/profile",
    heading: "tester",
    auth: "user",
    note: "The h1 is the username. Any /api failure replaces the whole dashboard with a bare alert, so the heading is also the fixture check.",
  },
  {
    path: "/admin",
    url: "/admin",
    heading: "Admin dashboard",
    auth: "admin",
  },
  {
    path: "/admin/users",
    url: "/admin/users",
    heading: "Users",
    auth: "admin",
  },
  {
    path: "/admin/challenges",
    url: "/admin/challenges",
    heading: "Challenges",
    auth: "admin",
  },
  {
    path: "/admin/submissions",
    url: "/admin/submissions",
    heading: "Submissions",
    auth: "admin",
  },
  {
    path: "*",
    url: "/no-such-page",
    heading: "404 — Page Not Found",
    auth: "guest",
    note: "The catch-all, reached at a path that exists in no route table. Em dash is U+2014.",
  },
];

/**
 * `App.tsx` paths that are deliberately not photographed, and why.
 *
 * Empty today — all 25 paths are swept — but the mechanism is the point, and it
 * is checked in both directions: an entry naming a path `App.tsx` no longer
 * declares fails the lock, so the list cannot rot into a silent exemption. A
 * future entry has to say which page it is skipping and why, in reviewable text.
 */
export const SWEEP_ROUTE_EXCEPTIONS: Readonly<Record<string, string>> = {};

/**
 * `App.tsx` renders four `<Route>` elements with no `path` — the `Layout`
 * wrapper and the `ProtectedRoute` / `AdminRoute` guards. They are not pages and
 * have no URL of their own, so they are absent from the partition by
 * construction rather than by exemption. Named here so the reason the lock sees
 * 25 paths and `App.tsx` declares 25 URLs is written down.
 */
export const SWEEP_PATHLESS_ROUTE_ELEMENTS = [
  "<Layout />",
  "<ProtectedRoute />",
  "<AdminRoute />",
] as const;

/**
 * Proof that a state is live before it is photographed.
 *
 * Exactly one of `role` or `text` is required, and the lock enforces that: a
 * state whose proof matched nothing would be captured anyway, which is how a
 * "delete dialog" screenshot ends up showing an undriven page.
 *
 * `role` + `name` resolves through the accessibility tree, so it is unaffected by
 * `text-transform` and it fails loudly on a strict-mode violation rather than
 * quietly matching the first of two elements. `text` is for copy with no role of
 * its own — a field error message, a toast body.
 */
export interface SweepStateProof {
  role?: string;
  name?: string;
  /**
   * Exact text. Combine it with `role` to scope the proof into that element.
   *
   * The app says some things twice — a 422 renders the field's message in `Field`
   * *and* in a form-level `role="alert"` — and a string that appears twice makes
   * a bare `getByText` a strict-mode violation instead of a proof.
   *
   * The earlier answer to that was to match the copy carrying the field name
   * (`identifier: …`), on the reasoning that it was unique. #326 stopped the
   * banner from printing that internal key, so the string went to zero matches
   * and the proof became unsatisfiable — the state silently stopped being
   * photographable, on a harness whose whole premise is that it cannot silently
   * pass. Scoping by role is the replacement: it keys off structure instead of
   * copy, so a wording change does not invalidate it, and it can pin the message
   * to the live region that announced it.
   */
  text?: string;
  /**
   * Where the copy comes from, when it is not in the app's source.
   *
   * Most proofs quote app copy and can be checked against `src/`. Some quote
   * something the app renders but never *ships* — a server's validation message
   * is the case in point: Pydantic's text arrives in the 422 at runtime, so no
   * amount of source-grepping can confirm the app still renders it. Declaring
   * `server` says "this is observable only in a browser", which is the truth
   * #335 was allowed to paper over.
   *
   * Declaring it is not a way out of checking: the lock requires every proof to
   * be either present in shipped source or declared here, so a state cannot
   * quietly exempt itself.
   */
  origin?: "server";
  /** Why this proof, and not some other marker on the page. */
  note?: string;
}

/** A declared interaction state, photographed once the app is driven into it. */
export interface SweepState {
  /** Stable ID, and the capture filename. */
  id: string;
  /** The `path` of the route this state starts from. */
  route: string;
  /**
   * The driver, a key in the sweep's `DRIVERS` registry. A key rather than a
   * closure so the matrix stays data and the lock can require every key to exist.
   */
  drive: SweepDriverId;
  /** Restrict to viewports. Defaults to both. */
  viewports?: readonly SweepViewport[];
  /** Restrict to themes. Defaults to both. */
  themes?: readonly SweepTheme[];
  /**
   * Who to sign in as, overriding the route's own `auth`.
   *
   * A state can need a different identity from the page it starts on: the
   * delete dialog lives behind `isOwner`, and the challenge page is deliberately
   * swept as a guest, so the state signs in as the owner rather than the route
   * being swept as one. Without this the "Delete challenge" button is not in the
   * DOM at all, and the driver waits two minutes for a button that does not exist.
   */
  auth?: SweepAuth;
  /** Must be satisfied before the shot. Same reasoning as a route's `heading`. */
  expect: SweepStateProof;
  caption: string;
}

export type SweepDriverId =
  | "mobile-nav"
  | "user-dropdown"
  | "login-field-errors"
  | "login-submitting"
  | "delete-dialog"
  | "toast"
  | "code-expanded"
  | "skeleton"
  | "skeleton-loaded";

/**
 * The states worth photographing, and the eight the design called for.
 *
 * Every one of these is a *state*, held open deterministically: a request that
 * is parked rather than awaited, a menu that is clicked, an error the fixtures
 * return on demand. None of them is sampled by waiting and hoping — see
 * `helpers/motion.ts`, whose regression lock forbids wall-clock sampling in the
 * capture path.
 */
export const SWEEP_STATES: readonly SweepState[] = [
  {
    id: "mobile-nav-open",
    route: "/",
    drive: "mobile-nav",
    viewports: ["pixel-7"],
    expect: {
      role: "link",
      name: "Home",
      // `Home` is the only link by that name in the app: the brand link is
      // "AI Code Eval logo" and the footer's three columns do not list it. The
      // nav list is `display:none` while closed, so a visible `Home` *is* the
      // open state — the assertion cannot pass on a closed menu.
    },
    caption: "Slide-in nav open below 768px. The toggle is display:none above the break, so this state has no desktop frame, and that is a property of the design rather than a gap in the sweep.",
  },
  {
    id: "user-dropdown-open",
    route: "/admin",
    drive: "user-dropdown",
    viewports: ["desktop-chromium"],
    expect: {
      role: "menuitem",
      name: "New challenge",
      // Unique on the page: the footer has no such link, and the menu only
      // exists once the trigger has been clicked.
    },
    caption: "The signed-in user menu. .navRight is display:none below 768px, so mobile has no frame for it either.",
  },
  {
    id: "login-field-errors",
    route: "/login",
    drive: "login-field-errors",
    expect: {
      // The alert *and* the text it announced. `role` alone would prove only that
      // something announced; the bare message alone is a strict-mode violation,
      // because `Field` renders the same string. Together they pin it to the
      // live region.
      role: "alert",
      text: "String should have at least 3 characters",
      // Pydantic's text, delivered in the 422 body at runtime. The app has no
      // copy of this string to keep in step — which is the point: it is why the
      // proof has to be observable in a browser, and why this state went stale
      // without any test noticing.
      origin: "server",
      // The real Pydantic message for the real schema: `LoginRequest.identifier`
      // is `Field(min_length=3)`. A two-character identifier satisfies the
      // input's `required` but not the server, so this is reachable rather than
      // a payload invented to make a screenshot.
      //
      // This proof used to be the text carrying the `identifier: ` prefix, on
      // the reasoning that the field's copy had no hook to scope by — a sibling
      // `<span>` with no id and an input with no `aria-invalid`. Both of those
      // were added in #323/#326, and the prefix was removed in #320/#326, so the
      // proof matched nothing and this state quietly stopped capturing. See
      // #335, and the `SweepStateProof` note for why the prefix was the wrong
      // thing to have relied on.
      note: "The alert proves the 422 surfaced as a live region; the frame also shows the field-level copy, which is now wired to its input via aria-describedby.",
    },
    caption: "A 422 rendered as a per-field message: the input outlined and marked `aria-invalid`, its message linked by `aria-describedby` so it is announced with the field, and the form-level copy in a `role=\"alert\"` live region. (The original caption recorded the aria wiring as a missing-feature finding; #323/#326 added it.)",
  },
  {
    id: "login-submitting",
    route: "/login",
    drive: "login-submitting",
    expect: {
      text: "Logging in…",
      // `Button`'s `loadingText`, with the ellipsis the app uses (U+2026).
    },
    caption: "The button loading state: spinner, aria-busy and the label swap. Held by parking the login request, so the state cannot expire between being observed and being captured.",
  },
  {
    id: "delete-dialog",
    route: "/challenges/:id",
    drive: "delete-dialog",
    auth: "user",
    // The owner actions render behind `isOwner`, and the sweep's challenges are
    // re-owned to the signed-in mock user — so this state signs in, while the
    // route itself stays swept as a guest (its note explains why).
    expect: {
      role: "heading",
      name: "Delete challenge?",
      // The dialog's own `<h2>`, distinct from the "Delete challenge" trigger
      // button that opened it.
    },
    caption: "The modal ConfirmDialog over its scrim, with focus already moved to the confirm button — the focus ring is part of the design and only a capture shows it.",
  },
  {
    id: "toast-success",
    route: "/profile",
    drive: "toast",
    expect: {
      text: "Password updated successfully.",
    },
    caption: "The shared toast surface in its success variant. Toasts dismiss themselves on a timer, so this frame is taken on the one produced by the fixture rather than after a wait for something to appear.",
  },
  {
    id: "code-block-expanded",
    route: "/submissions/:id",
    drive: "code-expanded",
    expect: {
      text: "Show less",
      // The collapsed state says "Show all"; the toggle only exists at all past
      // `DEFAULT_LINE_LIMIT` (300) log lines, so the fixture is a long run.
    },
    caption: "Both of the page's log disclosures open: the 'Show raw output' summary, then the 300-line clamp expanded to 'Show less'. Two nested disclosures, and only this state photographs the second one.",
  },
  {
    id: "submission-loading",
    route: "/submissions/:id",
    drive: "skeleton",
    expect: {
      role: "status",
      name: "Loading submission",
    },
    caption: "The loading skeleton. The request is parked rather than awaited, so this frame exists for as long as the capture needs it and cannot be missed.",
  },
  {
    id: "submission-loaded",
    route: "/submissions/:id",
    drive: "skeleton-loaded",
    expect: {
      role: "heading",
      name: "Evaluation report",
    },
    caption: "The same request released: skeleton to content, the transition every data page makes and no static shot can show.",
  },
];

/** How a motion pass samples its frames. */
export type SweepMotionKind =
  /** Position-driven: frames at fixed scroll offsets. */
  | "scroll"
  /** Time-driven finite: frames at fixed Web Animations progress. */
  | "transition"
  /** Infinite ambient: frames at fixed iteration phase. */
  | "ambient";

export interface SweepMotion {
  id: string;
  /** The `path` of the route this pass runs on. */
  route: string;
  kind: SweepMotionKind;
  /**
   * The samples, in the units of `kind`: scroll fractions of the scrollable
   * range, or progress/phase in `0..1`. Sampled by construction, never by
   * elapsed time.
   */
  samples: readonly number[];
  viewports?: readonly SweepViewport[];
  /** Themes to run. Defaults to `["dark"]` for motion: the ambient layer and the
   *  reveals are the surfaces under review and one theme is enough to see them. */
  themes?: readonly SweepTheme[];
  caption: string;
}

/**
 * Pages that animate something, whether or not the sweep can film it.
 *
 * The list exists because the previous version of this file asserted in a
 * comment that motion was a `/` speciality — "Home is the only page with a
 * motion system on it" — and that claim quietly went stale. `/pricing`'s FAQ
 * disclosure has animated since #332, and because the comment said the matrix
 * was small *by fact*, the next person to add a motion surface had no reason to
 * revisit it. A claim in a comment cannot be checked; a row in a table can.
 *
 * Each page is either covered by a `SWEEP_MOTION` pass or listed in
 * `SWEEP_MOTION_EXCEPTIONS` with its reason, and
 * `src/pages/visual-sweep.lock.test.ts` checks both directions — so a new
 * motion surface without either a pass or a written exception fails the build.
 */
<<<<<<< HEAD
/**
 * Every route that hosts the shared header ambient wash, and why.
 *
 * Before #402 only `/demo` carried it. `AmbientBackdrop` now paints it on every
 * other header too, so "Home is the only page with a motion system on it" — the
 * claim this array exists to make checkable — stopped being true, and would have
 * done so silently, because a route that gains motion is not a test failure
 * anywhere. That is the gap `films every page that animates, or says in writing
 * why it does not` in `visual-sweep.lock.test.ts` closes.
 *
 * Derived from `SWEEP_ROUTES` rather than retyped, so adding a route to the
 * matrix cannot skip the declaration: the new entry is there before anyone
 * remembers this file exists. `/auth/callback` counts — it renders no header of
 * its own but still mounts `AuthLayout`, so the auth backdrop drifts behind it.
 * Home is excluded because its ambient layer is a different thing with its own
 * passes above.
 */
const AMBIENT_WASH_ROUTES = SWEEP_ROUTES.map((route) => route.path).filter(
  (path) => path !== "/",
);

const AMBIENT_WASH_WHY =
  "The header ambient wash (#402): the shared `AmbientBackdrop`'s `auroraDrift`, which is the only motion on this page.";

const AMBIENT_WASH_EXCUSION =
  "No filmstrip, and the reason is that the frames would be redundant rather than missing. The wash is one shared component painting the same two keyframes on every host, so a strip here is the `/demo` strip again with only the host height changed. The height is the part worth checking, and it is asserted where it can be measured instead of eyeballed: `e2e/ambient-wash.spec.ts` checks on every route, in both themes, that the running animation is named `auroraDrift`, that the wash is clipped to its host and fills it, that its visible area clears a floor, and that any text it reaches keeps 4.5:1; `e2e/ambient-motion.spec.ts` covers the reduced-motion cut. #402.";

=======
>>>>>>> main
export const SWEEP_MOTION_SURFACES: readonly { route: string; why: string }[] = [
  {
    route: "/",
    why: "Reveal staggers, the `.scrollReveal` view() reveals, the ambient layer, `useCountUp` and the pipeline timeline — all element-level, all seekable, all filmed. The pipeline (#353) is five cards sharing one `pipelineStepActive` keyframe with a per-step delay, four `connectorFlow` arrows and a stepped `progressBar`; all infinite, so the ambient filmstrip lands on the cycle at four phases and catches a different step lit in each. The step cards' `stepCardIn` entrance is finite and belongs to the transition pass's remit, though it fires on the `stepsGrid` `data-entered` gate rather than on a `Reveal` transition. The terminal story's own beats are NOT seekable and are not filmed as a filmstrip: they are a chained setTimeout driven by state, so there is no timeline to place a frame on. The seekable parts of it are filmed with the rest — the ring's `ringFill` and the status dot's pulse are both element-level CSS animations — and the JS-driven number and row reveals are asserted in e2e/terminal-story.spec.ts, which watches the DOM rather than the clock.",
  },
  {
    route: "/demo",
    why: "The `Reveal` stagger on the walkthrough steps and the header's ambient blobs, plus the `STEP_CYCLE_MS` rail that advances the highlighted step.",
  },
  {
    route: "/pricing",
    why: "The FAQ disclosure. Its glyph is element-level and seekable; its answer animates through `::details-content`, which no `Animation` object represents.",
  },
<<<<<<< HEAD
  ...AMBIENT_WASH_ROUTES.filter(
    (route) => route !== "/demo" && route !== "/pricing",
  ).map((route) => ({ route, why: AMBIENT_WASH_WHY })),
=======
>>>>>>> main
];

/**
 * Motion surfaces with no filmstrip, and why there isn't one.
 *
 * Not an oversight and not a to-do. `/pricing` is listed here because the
 * honest pass for it does not exist yet, and a plausible-looking one would be
 * worse than none:
 *
 * A `kind: "transition"` pass seeks each animation to a fraction of its own
 * duration. On this page the census sees **one** animation — the glyph's
 * `transform` — and the answer's `block-size` is not in the set at all, so the
 * seek would place the glyph faithfully and leave the panel snapped. Every frame
 * of that filmstrip would show an open row with an unfinished `+`, which reads
 * as the exact desync #332 fixed. A reviewer could not tell it from a defect,
 * and the report's own history already has one instance of a rule filing a
 * filmstrip frame as a blocker.
 *
 * So the invariant is asserted where it can actually be observed — in
 * `e2e/pricing.spec.ts`, which stretches the transition and compares the two
 * halves' normalised progress against each other — and the blind spot is
 * recorded in the manifest by `censusPseudoTransitions` so no run implies it was
 * covered. A pass that samples the *value* rather than seeking the animation, the
 * way `useCountUp` is handled, is the missing piece.
 */
export const SWEEP_MOTION_EXCEPTIONS: Readonly<Record<string, string>> = {
<<<<<<< HEAD
  // `/demo` is absent because it has a pass; `/pricing` keeps its own reason
  // below because its blind spot is a different kind of thing.
  ...Object.fromEntries(
    AMBIENT_WASH_ROUTES.filter(
      (route) => route !== "/demo" && route !== "/pricing",
    ).map((route) => [route, AMBIENT_WASH_EXCUSION]),
  ),
=======
>>>>>>> main
  "/pricing":
    "The FAQ answer animates via ::details-content, which getAnimations() never reports, so a seek-based filmstrip would place the glyph and leave the panel snapped — a sheet that looks like the #332 desync. Asserted numerically in e2e/pricing.spec.ts; the blind spot is recorded in the manifest by censusPseudoTransitions. #334.",
};

/**
 * The motion passes.
 *
 * `/` is the only page whose motion the sweep can place on a timeline, so the
 * matrix is small by fact — but "small by fact" is a claim that expires, and it
 * did: see `SWEEP_MOTION_SURFACES` above, which is the checkable version of it.
 */
export const SWEEP_MOTION: readonly SweepMotion[] = [
  {
    id: "home-scroll-reveal",
    route: "/",
    kind: "scroll",
    // The bottom frame is the reveal payoff: sections that are invisible at
    // offset 0 have crossed `cover 26%` by the end of the page.
    samples: [0, 0.25, 0.5, 0.75, 1],
    viewports: ["desktop-chromium"],
    caption: "Scroll filmstrip. .scrollReveal is a CSS scroll-driven animation (animation-range: entry 0% cover 26%, fill: both), so each frame is a pure function of scroll offset — no timers involved, and the same offsets always yield the same pixels.",
  },
  {
    id: "home-reveal-transition",
    route: "/",
    kind: "transition",
    // `Reveal` is IntersectionObserver -> a CSS transition with an optional
    // delayMs stagger, so it IS in getAnimations(): 0/50/100% of the
    // transition itself, delay included, is what shows whether the stagger
    // reads as a cascade or as a jump.
    samples: [0, 0.5, 1],
    viewports: ["desktop-chromium"],
    caption: "Transition filmstrip over the hero's staggered Reveals, seeked with the Web Animations API. Seeking includes each element's transition-delay, so a delayed reveal is caught mid-flight instead of being reported as still-hidden. The terminal panel is not in this filmstrip: it stopped being a hero Reveal in #352 and now runs its own entrance, which the story waits out before its first frame — that coupling is covered by the story tests, not here.",
  },
  {
    id: "home-ambient",
    route: "/",
    kind: "ambient",
    // Infinite loops (gridPan 30s, floatCode, the hero blobs) paused at a fixed
    // phase. Four phases is enough to see drift and short enough to keep the
    // run inside its disk budget.
    samples: [0, 0.25, 0.5, 0.75],
    viewports: ["desktop-chromium"],
    caption: "Ambient filmstrip: the blueprint grid, the drifting code fragments, the hero colour blobs and the five-step pipeline timeline at four fixed phases — the pipeline is a 10s cycle, so those phases land on steps 1, 2, 3 and 4 in turn (#353). These never finish, so every static shot pauses them at phase 0 rather than catching them wherever the machine happened to be.",
  },
  {
    id: "demo-reveal-transition",
    route: "/demo",
    kind: "transition",
    // The same `Reveal` component Home films, here on the four walkthrough
    // steps with a 90ms stagger, plus the header's entrance.
    samples: [0, 0.5, 1],
    viewports: ["desktop-chromium"],
    caption: "Transition filmstrip over the walkthrough's four staggered Reveals, seeked with the Web Animations API. Seeking includes each element's transition-delay, so a delayed step is caught mid-flight instead of being reported as still-hidden.",
  },
  {
    id: "demo-ambient",
    route: "/demo",
    kind: "ambient",
    // Two `auroraDrift` blobs on the shared keyframe. Both are `infinite`, so
    // the static at-rest captures pause them at phase 0 rather than catching
    // them wherever the machine happened to be.
    samples: [0, 0.25, 0.5, 0.75],
    viewports: ["desktop-chromium"],
    caption: "Ambient filmstrip: the two drifting colour blobs behind the demo header, at four fixed phases. Home's blueprint grid and code fragments are not repeated here — they are the same shared primitives, filmed once on `/`.",
  },
];
