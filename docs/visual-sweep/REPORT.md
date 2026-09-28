# Visual sweep report

Review of the run `20260927-154941`, produced by `make visual-sweep` (issue #253).

## Provenance

| | |
|---|---|
| Run | `20260927-154941` (frames gitignored, under `frontend/visual-sweeps/`) |
| Commit | `0ffd7bc14d7ec0e10b5c7bc8d2641095f724bed5` |
| Browser | **Chromium 153.0.8010.12**, `/ms-playwright/chromium-1243/chrome-linux64/chrome` |
| Build | production — `vite build` + `vite preview` on `http://localhost:4173` (never the dev server) |
| Isolation | every request to an origin other than `:4173` aborted; fresh context, no profile |
| Matrix | 25 routes + 9 states + 3 motion passes, 2 themes (light/dark) x 2 viewports (desktop 1280x800, Pixel 7 412x915) |
| Captured | **344 frames**, 64.0 MB, 104 captioned contact sheets |
| Result | 205 passed, 35 skipped (states declared for one viewport only), 0 failed |
| Animation health | **0 stuck reveals, 0 frames captured mid-animation** |
| Findings | **203, all minor** — 4 rule classes, 37 pages |

The frames are not committed (70 MB per run). This report cites paths inside that
run directory; re-run the sweep to regenerate them.

## What this review is, and what it is not

It is a **measurement**: 11 layout and accessibility rules evaluated against the
same rendered page, in the same browser, at the instant each frame was shot
(`e2e/visual/helpers/audit.ts`). Every number below is a computed value or a
`getBoundingClientRect`, not an impression.

It is **not** a design review. Spacing rhythm, visual hierarchy, balance, brand
character, and "does this look like the product" are a human's job, and no rule
here pretends to have done it. The 104 contact sheets exist so that a person can
do that part:

```bash
cd frontend/visual-sweeps/20260927-154941/contact-sheet
# one captioned 4x3 sheet per route, theme and viewport
```

Two consequences worth stating plainly:

- **"No blockers, no majors" is evidence about these 11 rules, not about the
  design.** The rules are proven to fire on defects — `e2e/visual/audit.lock.visual.ts`
  builds a page for each one and asserts the rule fires *about the element it was
  aimed at*, plus four pages that must produce nothing at all. But a rule that
  never fires on the app is indistinguishable, from the report alone, from a rule
  that cannot fire.
- **A finding is a measurement, not a verdict.** F1 below is 135 instances of a
  deliberate design decision (`width: 36px` is written in the CSS). It is filed
  because the rule has something to say about touch comfort, not because the
  designer was wrong.

## Findings

Severity is the rule's own verdict; the ordering after the table is mine.

| ID | Severity | Rule | Pages | Viewport | Theme | Evidence | Diagnosis | Suggested fix |
|---|---|---|---|---|---|---|---|---|
| **F1** | minor (135) | `touch-target-small` | 37 of 37 | 68 desktop / 67 Pixel 7 | both | `dark/desktop-chromium/*/scroll-0.png`, `light/pixel-7/home/scroll-0.png` | **17 distinct elements, 135 instances — one scale, not 135 bugs.** The app's interactive heights run 25-42px; not one control in the sweep reaches the 44px AAA target, and every one clears the 24px WCAG 2.5.8 **AA** floor. Element table below. | Introduce a `--control-height` token at 44px rather than adjusting 17 sites. Two caveats for the decision, not the fix: the theme toggle is a fixed `36px` square in the header (`ThemeToggle.module.css:6-7`), so 44px changes the header's vertical rhythm; and the three smallest items (Copy, the "Browse challenges" action, the demo chip) are inline actions, where a 44px *box* would break the line it sits in — those want padding that extends the hit area without growing the visual box. |
| **F2** | minor (38) | `text-tiny` | 10 | both | both | `dark/desktop-chromium/admin/scroll-0.png`, `dark/desktop-chromium/admin-challenges/scroll-0.png` | Three *different* mechanisms produce sub-12px text, and none of them is the type scale. (a) `Admin.module.css:319` — `var(--font-size-2xs, 0.625rem)`; **`--font-size-2xs` is never defined in `globals.css`**, so this 10px chart axis label renders from its fallback. (b) `LanguageBadge.module.css:26` — `calc(var(--font-size-xs) - 1px)` = 11px, a step below the scale's smallest step (12px), on 7 pages. (c) `Features.module.css:323` — a bare `0.72rem` (11.52px), not a token at all. | Define `--font-size-2xs` in the scale — the app is *using* it, so the intended step exists in the design and only in the stylesheet. Then either raise `--font-size-xs` to 13px or add a real 11px step, and move (c) onto a token. (b) is a two-letter language code in bold on a colour chip; 11px is defensible there, and the honest outcome may be "leave it, and say so in the scale". |
| **F3** | minor (26) | `heading-skip` | 9 | both | both | `dark/desktop-chromium/admin-challenges/scroll-0.png`, `dark/desktop-chromium/login/scroll-0.png` | One shared component, nine pages: the page's `<h1>` is followed by the **footer's** `<h3>` (`Footer.tsx:43,56,69` — "Product", "Company", "Legal"). No `<h2>` sits between them, so the document outline jumps a level on every page that has a footer. | Change the footer's column titles to `<h2>`. One line, one component, nine pages — the highest-leverage finding in this report. |
| **F4** | minor (4) | `no-h1` | 1 (`state:submission-loading`) | both | both | `light/desktop-chromium/states/submission-loading.png` | `SubmissionDetail.tsx:141-147` returns a bare `<div role="status">` containing two skeletons while loading, so the page has **no top-level heading at all** during the fetch. The only visible heading is the footer's `<h3>`. | Render the page title outside the `loading` branch, or give the skeleton an `<h1>`. The container already announces itself with `role="status"`, so the fix is cheap. |

### F1 in detail — 135 instances, 17 elements

| Instances | Size | Viewport | Element |
|---|---|---|---|
| 67 | 36x36 | desktop | header theme toggle (`data-testid="theme-toggle"`), on 35 of 37 pages |
| 22 | 42x39 | Pixel 7 | mobile menu toggle |
| 6 | 364x42 | Pixel 7 | secondary button, e.g. "Log in" |
| 6 | 330x39 | Pixel 7 | login identifier input |
| 4 | 314x39 | Pixel 7 | current-password input |
| 4 | 364x40 | desktop + Pixel 7 | admin submissions status `<select>` |
| 4 | 362x38 | Pixel 7 | `<summary>` "Code, tests and raw logs" |
| 4 | 40x25 | Pixel 7 | code-block **Copy** button — the smallest interactive element in the app |
| 2 each | 330x39 / 364x39 / 314x39 | Pixel 7 | username, email, title, and the three search inputs |
| 2 | 143x42 | Pixel 7 | primary button (challenge edit) |
| 2 | 131x26 | Pixel 7 | "Browse challenges" action link |
| 2 | 119x27 | Pixel 7 | demo provider chip |

If you fix three things, fix **F3** (one line, nine pages), then **F2a** (define
the token the app already uses), then **F4**. F1 is a coherent design decision
with a layout consequence: decide the scale deliberately, do not patch 17 sites.

## Systemic observations

1. **The type scale stops at `xs` = 12px, and everything de-emphasised is
   hand-tuned below it.** F2's three mechanisms are the symptom of a real gap in
   the scale. Adding `--font-size-2xs` and a `--font-size-3xs`, then using them,
   would collapse three ad-hoc rules into the one place they belong.
2. **Control heights are 38-42px app-wide, not 44px.** Not one control in the
   sweep reaches 44px. This is a coherent choice, not an accident — but it is a
   choice, and it is currently expressed in about a dozen CSS rules rather than in
   a token.
3. **One footer, nine pages, one heading-level bug.** F3 is the clearest argument
   for measuring across pages: no single page review of `/login` would have found
   it, because the offending `<h3>` is 4,000px below the fold and belongs to
   another component.
4. **Every sub-44px target except the theme toggle is on Pixel 7.** The toggle
   (36x36, 67 instances) is desktop-only — the mobile header hides it — while
   everything else (68 instances across 15 elements) is mobile-only: inputs, menu
   toggles and inline actions that exist at that width and not this one. The split
   is the point. The same CSS gives a mouse a comfortable target and a thumb a
   cramped one, and **no single viewport shows both halves** — which is why
   sweeping both was worth the wall-clock.
5. **Nothing here is dark-mode-specific.** Every finding appears in both themes at
   equal counts. The dark override is in good shape; the audit rules that would
   catch a broken dark override (`page-overflow-x`, `text-clipped`, `no-h1`,
   `control-unlabelled`, `image-no-alt`) are all clean.

## Clean

No page is free of findings, and that is a fact about one header control: the
36x36 theme toggle (F1) is on all 37 pages. Excluding the app-wide control-height
finding, these pages have nothing of their own:

- `state:mobile-nav-open` — the only page whose findings are all the mobile menu
  toggle (42x39, F1).

Pages with findings limited to F1 and nothing else: every remaining page. In
other words, **the app's per-page layout and accessibility surface is clean apart
from three shared-component issues (F2, F3) and one loading state (F4).**

Clean at the rule level, across all 344 frames — no instances at all:

| Rule | Result |
|---|---|
| `page-overflow-x` | 0 — no page scrolls horizontally at 412px or 1280px |
| `element-overflow-x` | 0 |
| `text-clipped` | 0 — nothing cut off by a clipping or scrollable ancestor |
| `content-invisible` | 0 in the at-rest frames — no reveal left at opacity 0 |
| `control-unlabelled` | 0 — every input, select and textarea has a name |
| `image-no-alt` | 0 |
| `focus-ring-absent` | 0 — every tab stop changes its computed outline, shadow, border, background or colour on `:focus-visible` |

## Motion

Three filmstrips, 12 frames, motion enabled (the at-rest passes use
`prefers-reduced-motion: reduce`, because Home's hero types a prompt and cycles a
status chip on timers that never finish — two photographs of the "same" state
differ by which chip was lit).

| Pass | Frames | Seeked | What the measurement shows |
|---|---|---|---|
| `home-reveal-transition` | 3 | 26 animations | Every finite transition in the tree is seekable and lands where it is asked to; a 50% frame is 50% of the transition regardless of machine load. |
| `home-ambient` | 4 | 26 animations | The infinite ambient loops (`.codeGrid`, `.codeFragment`, hero blobs) are paused at declared phases rather than sampled at whatever moment the shutter opened. |
| `home-scroll-reveal` | 5 | n/a — position-driven | The CSS `animation-timeline: view()` reveal is a pure function of scroll offset, so these frames are reproducible by construction; nothing needs seeking. |

Health across the whole run: **0 stuck reveals** (no `Reveal` block failed to
become visible at any scroll offset) and **0 frames captured with animations
still running** — so no frame in the contact sheets is a picture of a moment
rather than evidence about the design.

The `content-invisible` rule is intentionally suspended on motion frames: a
filmstrip of a reveal mid-transition is *supposed* to show content at opacity 0,
and that opacity is the subject of the frame. The at-rest pass covers the same
pages with the rule on, so nothing is lost. (This exclusion was found the honest
way: the rule first reported a filmstrip frame as a blocker.)

## Not covered — needs a human, or a rule that does not exist yet

Honest list of what this report does **not** tell you:

1. **Aesthetics.** Nothing here judges whether the app looks good. Open the
   contact sheets.
2. **Form errors are not linked to their inputs.** Found by hand while building
   the `login-field-errors` state: `TextInput` sets no `aria-invalid`, and
   `Field`'s error message is not associated with the input by
   `aria-describedby`. The field *is* labelled, so `control-unlabelled` passes —
   the rule cannot see this, and no rule here covers "the error message is
   announced with the field". Worth a rule, and worth a fix.
3. **Text that is legible but wrong** — truncation by design, awkward wrapping,
   inconsistent alignment. A measurement can find text that overflows; it cannot
   find text that reads badly.
4. **Anything about the 4.0px rounding of a single shadow.** Out of scope, and
   deliberately so.

## Reproducing

```bash
make visual-sweep                                  # the run, end to end (~5 min, 70 MB)
VISUAL_SWEEP_KEEP=4 make visual-sweep              # keep more runs (default prunes to 3)

cd frontend
npx playwright test --config playwright.visual.config.ts audit.lock        # 46 tests
npx playwright test --config playwright.visual.config.ts determinism.lock  # 6
npx playwright test --config playwright.visual.config.ts provenance.lock  # 16
npx vitest run src/pages/visual-sweep.lock.test.ts                          # 16
```

Findings land in `visual-sweeps/<run>/findings.json` — one entry per defect, with
the frames it was seen in, and the rule table beside them so the file is readable
without this document.

## Related: the journey audit

The interaction-level complement to this sweep lives in
[`docs/ux-audit/REPORT.md`](../ux-audit/REPORT.md) (run `20260928-165201`,
`make visual-journeys`): 11 walkthroughs — login/logout, registration,
create-challenge, provider-picker, admin, theme cross-fade, mobile menu, two
loading states — with captioned stills and four VP8 clips. Its 34 minor
findings are the same four rule classes above, on the same three shared
components: nothing new, which is the point of the report.

## P0 fix pass (three audit rules zeroed)

Run `20260928-171951` (`make visual-sweep`, commit on
`fix/296-p0-audit-fixes`):

| Rule | Baseline `20260928-162223` | After P0 fixes `20260928-171951` |
|---|---|---|
| `touch-target-small` | 135 | 135 (untouched — P1 token work in #299) |
| `text-tiny` | 38 | **0** (#296) |
| `heading-skip` | 26 | **0** (#297 — footer `<h3>`→`<h2>` and challenge cards `<h3>`→`<h2>`) |
| `no-h1` | 4 | **0** (#298 — submission-loading skeleton now has an `<h1>`) |

The `text-tiny` fix lands everything sub-12px onto the scale's `xs` step
(12px): admin `dailyLabel`, `LanguageBadge` symbol, `Features` `reportMeta`,
and the Features mock chrome that trips the rule whenever that section renders.
The `--font-size-2xs` token the audit proposed turned out to have **no
consumer left** once those sat on `xs`, so it was not added (see
`docs/ux-audit/REPORT.md`). `touch-target-small` is deliberately untouched
here — that finding is the `--control-height` design decision (issue #299).
