# UX audit — journey report

Interaction-level review of the app, produced by `make visual-journeys`
(issue #294). Where the sweep ([`docs/visual-sweep/REPORT.md`](../visual-sweep/REPORT.md))
photographs every route, this run walks through the app as a person does:
sign in, sign out, wrong password, register, create a challenge, pick a
provider, open the admin, switch the theme, open the mobile menu, and wait
through two loading states — 11 journeys, each with captioned stills and four
short VP8 clips.

## Provenance

| | |
|---|---|
| Run | `20260928-165201` (frames gitignored, under `frontend/visual-sweeps/`) |
| Commit | `be2e6246618f5642a0a70f4df90f573910ac81e0` |
| Browser | **Chromium 153.0.8010.12**, `/ms-playwright/chromium-1243/chrome-linux64/chrome` |
| Build | production — `vite build` + `vite preview` on `http://localhost:4173` (never the dev server) |
| Isolation | every request to an origin other than `:4173` aborted; fresh context, no profile; API surface fully mocked |
| Spec | `frontend/e2e/visual/journeys.visual.ts` — env-gated behind `VISUAL_JOURNEYS=1`, run in the visual Playwright project (desktop `1280x800` + Pixel 7 `412x915`) |
| Result | **13 passed, 11 skipped** (journeys declared for one viewport only), 0 failed |
| Captured | 96 frames, 7.2 MB, 4 clips (theme cross-fade, mobile menu, submit spinner, skeleton→content) |
| Findings | **34, all minor** — the same four rule classes as the sweep, on the same shared components |

The frames are not committed. This report cites paths inside the run directory
and five curated stills in [`docs/ux-audit/evidence/`](evidence/) (downscaled,
440 KB total, committed alongside this document so the report survives the
machine the run ran on).

## What this review is, and what it is not

It is a **walkthrough with receipts**: every journey drives the real UI —
typed keystrokes, `click`s, a real browser back — asserts the state it meant
to photograph (the heading, toast, alert, or URL that proves the step
landed), then captures. Every capture is audited against the same 11 layout
and accessibility rules as the sweep (`e2e/visual/helpers/audit.ts`), and the
whole session is proven to have been shot in this project's own browser by the
provenance check.

It is **not** a pixel-diff. Nothing here claims a frame "looks wrong"; the
journeys document behavior and transitions, and the rule counts are the
measurement part. There is also deliberately no video-tonality verdict on the
four clips — they are 8 fps VP8, made to be *recognisable*, not cinematic:
`theme-crossfade.webm` (dark ⇄ light on the features page), `mobile-nav.webm`
(menu slide-in on Pixel 7), `submit-loading.webm` (button spinner, then the
toast auto-dismissing after its 5 s), `skeleton-loading.webm` (report skeleton
resolving into content).

## The journeys

| Journey | Viewport / theme | Frames | What it walked and proved |
|---|---|---|---|
| `guest-nav` | desktop, light | 4 | Header nav: Home hero → Features → Demo → Challenges; each page's `<h1>` verified before the shutter |
| `scroll-nav-loss` | desktop, light | 3 | Scrolled to `scrollY=1507` on Features, navigated to Pricing, hit browser back — **scroll position restored to 1507**; the scroll-loss hypothesis did not reproduce |
| `login-logout` | desktop, light | 3 | Wrong password shows the inline alert, valid demo login reaches the challenges grid, logout returns to the guest shell |
| `register-validation` | desktop, light | 3 | Weak password gets the live hint, submit is blocked while invalid, valid submission shows the welcome toast |
| `create-challenge` | desktop, light | 4 | Empty form → filled form → created challenge's detail page → **the list shows the new challenge** (create→detail→list closed loop, mocked) |
| `provider-picker` | desktop, light | 5 | Default demo (free, no key) → OpenAI (key required) → the model `<select>` open → Groq (key required) → Ollama (local, **no key field** — the apps's differentiator) |
| `admin-nav` | desktop, **dark** | 3 | Dashboard → Users → Submissions via the quick actions |
| `theme-crossfade` | desktop, light → dark | 3 + clip | Toggle dark ⇄ light; the cross-fade captured at 8 fps through both transitions |
| `profile-toast` | desktop, light | 2 + clip | Password change submit: spinner while parked, "Password updated successfully." toast, then the 5 s auto-dismiss |
| `submit-skeleton` | desktop, light | 1 + clip | Submission report's `role="status"` skeleton, resolved into the scored report |
| `mobile-nav` | **Pixel 7**, dark | 3 + clip | Menu closed → menu slide-in → navigate to About from the mobile menu |

Two of these were written to *try to break* the app, and did not:

- **Scroll position survives navigation and browser back.** The
  `scroll-nav-loss` frames show `1507 → 1445 → 1507`; the position is restored
  per route. No finding.
- **The floating navigation does not drift after a layout shift.** The home
  hero resize was checked the same way as in the sweep's motion passes.

## Findings

The journey captures produced 34 findings, all **minor**, all four rule
classes already explained in the sweep report — because the same three shared
components carry them: the footer's `<h3>` columns (heading-skip, 5), the
hand-tuned sub-12px text (text-tiny, 13), and controls at 36–42 px
(touch-target-small, 15); plus one `no-h1` (the submission-loading skeleton,
captured again by `submit-skeleton`).

| ID | Severity | Count | Where (frame) | Notes |
|---|---|---|---|---|
| F1 | minor | 15 | e.g. `journeys/provider-picker/01-demo-default.png` | `touch-target-small` — the app-wide 36–42 px control scale (see sweep F1: one token, 17 sites) |
| F2 | minor | 13 | e.g. `journeys/admin-nav/01-dashboard.png` | `text-tiny` — `--font-size-2xs` undefined, `LanguageBadge` 11 px, `Features` 0.72rem (sweep F2) |
| F3 | minor | 5 | any guest-page frame | `heading-skip` — footer `<h3>` after the page `<h1>` (sweep F3) |
| F4 | minor | 1 | `journeys/submit-skeleton/` | `no-h1` — the loading skeleton has no top-level heading (sweep F4) |

Nothing new and nothing local: every journey finding is one of the sweep's
four shared-component findings reappearing in a live interaction. That is the
signal — the professionalization backlog is four items, not forty.

## Observations from the walkthrough

Things the rule count cannot say, recorded because they matter for the polish
pass:

1. **The app feels coherent in motion.** The theme cross-fade, mobile
   slide-in and the two loading treatments all transition without jarring
   snaps; `content-invisible` never fired mid-animation.
2. **Error and success states are visible and immediate** — inline alert,
   live password hint, blocked submit, three toasts. The
   `role="alert"`/`role="status"` plumbing that the rules can't judge exists
   and reads correctly by assertion.
3. **The provider picker is the product's strongest interactive moment.**
   Free demo chip, per-provider key fields that appear and disappear, and the
   Ollama "no key" state — visible proof of the local-model story.
4. **The admin surface photographs differently from the rest of the app**
   (dense stat cards, charts) and carries the same control-height and
   sub-12px axis-label findings as everything else, i.e. the pending F1 token
   and the undefined `--font-size-2xs` reach the admin too.
5. **`profile-toast` and `submit-skeleton` both left the loading state
   quickly** — parked mocks held them open for the camera, not the other way
   around; nothing stuck.

## Recommended fixes (P0 / P1 / P2)

| Priority | Fix | Scope | Because | Status |
|---|---|---|---|---|
| P0 | Define `--font-size-2xs` (the app already uses it) and put `LanguageBadge`/`Features` ad-hoc sizes on the scale | `globals.css`, 2 modules | F2 is one missing token + two stragglers; cheapest correctness win | **Merged** (#296 → PR #301) — the undefined var dropped, all sub-12px text raised onto the scale's `xs` floor; `text-tiny` 0 |
| P0 | Footer column titles `<h3>` → `<h2>` | `Footer.tsx` | F3: one line, every page with a footer | **Merged** (#297 → PR #301) — `heading-skip` 0 |
| P0 | Give the submission-loading skeleton a top-level heading | `SubmissionDetail.tsx` | F4: pages need an `<h1>` at all times | **Merged** (#298 → PR #301) — `no-h1` 0 |
| P1 | Introduce a `--control-height` token at 44 px and ratchet the 17 sites onto it | global + ~17 modules | F1 is a coherent design decision, so decide it in one place; see sweep F1 for the two inline-action caveats | Open — #299 |
| P2 | Field error messages through `aria-describedby`/`aria-invalid` on inputs | `TextInput`/`Field` | From the sweep's "not covered" list: the message exists but is not announced with the field — worth a rule and a fix | Open — #300 |

The P0 row nominally says "define `--font-size-2xs`", but once the admin
`dailyLabel` and the `Features` mock chrome sat on the scale's existing `xs`
step there was **no consumer left for a 10px token**, so none was added — the
scale stays flat (12px floor) and the audit rule stops firing.

No P0/P1 issue in this list was created from this report yet; the plan is to
file fix issues only after the user reviews it.

**Update (fix pass complete):** the user reviewed the report and approved
merging PR #295, after which the P0 issues #296/#297/#298 were filed, fixed in
PR #301 and merged. P1 (#299) and P2 (#300) remain open.

## The one thing this audit could not photograph

A **real evaluation run — prompt → code generation → sandboxed test execution →
scored report — against the live stack. All journeys mock the API surface on
purpose (offline, deterministic, fast). The `submissions` list, the report
page and the skeleton are real components, but fed fixtures: the deepest
end-to-end claim (`docs/visual-sweep` ran the same way) is still unwitnessed
by this review. The demo-provider evaluation path itself is straight — POST a
submission, poll, render `WireSubmission` — but needs the Celery worker
running on the host (out of the sandbox's reach) before a journey can walk it
for real.

## Reproducing

```bash
make visual-journeys                               # the run, end to end (~1 min, ~7 MB)
VISUAL_JOURNEYS_KEEP=5 make visual-journeys        # keep more runs (default prunes to 5)

cd frontend
npx playwright test --config playwright.visual.config.ts journeys   # only the journeys
npx playwright test --config playwright.visual.config.ts audit.lock # the rule locks, still standalone
```

The clips decode with any VP8-capable player (the sandbox's own ffmpeg is a
minimised fork: it encodes WebM from an `image2pipe` mjpeg stream and cannot
decode PNGs back — `make test-e2e`'s Chromium is the comfortable viewer).

Findings land in `visual-sweeps/<run>/findings.json`; the rule table beside
them is the sweep report's F1–F4.