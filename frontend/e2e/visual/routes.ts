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
    note: "Carries every motion surface in the app: Reveal stagger, .scrollReveal, ambient blobs/grid/code, useCountUp and the typewriter.",
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
   * Exact text, and it has to be unambiguous.
   *
   * The app says some things twice — a 422 renders the field's message in `Field`
   * *and* a form-level alert — and a string that appears twice makes
   * `getByText` a strict-mode violation instead of a proof. When a state needs to
   * show a repeated string, the proof is the one that carries the field name, and
   * `note` says why that is the reachable one.
   */
  text?: string;
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
      text: "identifier: String should have at least 3 characters",
      // The real Pydantic message for the real schema: `LoginRequest.identifier`
      // is `Field(min_length=3)`. A two-character identifier satisfies the
      // input's `required` but not the server, so this is reachable rather than
      // a payload invented to make a screenshot.
      //
      // The `identifier: ` prefix is what makes this proof reachable. The bare
      // message is on the page twice — in `Field` and in this alert — so
      // `getByText` on the message alone is a strict-mode violation. The field's
      // own copy has no hook to scope by: a sibling `<span>` with no id, no role,
      // and an input with neither `aria-invalid` nor `aria-describedby`. That
      // absence is the finding, and it is why the proof is the alert.
      note: "The alert proves the 422 was mapped to a field; the frame also shows the field-level copy, which no locator can reach on its own.",
    },
    caption: "A 422 rendered as a per-field message, with the input outlined as invalid. Note for the report: the field error is not programmatically linked to the input — no aria-invalid, no aria-describedby — so a screen reader announces neither the invalid state nor the message.",
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
export const SWEEP_MOTION_SURFACES: readonly { route: string; why: string }[] = [
  {
    route: "/",
    why: "Reveal staggers, the `.scrollReveal` view() reveals, the ambient layer and `useCountUp` — all element-level, all seekable, all filmed.",
  },
  {
    route: "/pricing",
    why: "The FAQ disclosure. Its glyph is element-level and seekable; its answer animates through `::details-content`, which no `Animation` object represents.",
  },
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
    caption: "Transition filmstrip over the hero's four staggered Reveals, seeked with the Web Animations API. Seeking includes each element's transition-delay, so a delayed reveal is caught mid-flight instead of being reported as still-hidden.",
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
    caption: "Ambient filmstrip: the blueprint grid, the drifting code fragments and the hero colour blobs at four fixed phases. These never finish, so every static shot pauses them at phase 0 rather than catching them wherever the machine happened to be.",
  },
];
