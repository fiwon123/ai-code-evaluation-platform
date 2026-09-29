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

Honest list of what this report does **not** tell you. Item statuses reflect
the [V pass](#v-pass--reading-the-frames-not-just-measuring-them-319), the only
part of this report that looks at the frames rather than measuring them.

1. **Aesthetics.** *(closed by the V pass)* — the measurement still does not
   judge whether the app looks good, but the frames have now been read: all 26
   groups in both themes and both viewports, with the findings written up. Hover
   and focus states remain unseeable from a static frame.
2. **Form errors are not linked to their inputs.** *(closed by the V pass and
   #323)* — the V pass confirmed the inline error now sits directly under its
   input with a matching red border, in all four theme/viewport combinations. The
   `aria-invalid` / `aria-describedby` gap below was still unmeasured then, and
   remains so here: the V pass found two things a rule cannot see, the
   form-level banner repeating the field's message with the internal key
   prepended (V1, #320), and `Field` silently skipping the aria wiring on its
   one field with more than one child (V2, #323).
3. **Text that is legible but wrong** — *(partly closed by the V pass)*.
   Truncation by design and inconsistent alignment are still the rule's blind
   spot, but wrap quality, orphan words and prose measure have now been read and
   reported. What remains is copy editing, not layout.
4. **Anything about the 4.0px rounding of a single shadow.** Out of scope, and
   deliberately so.
5. **The scroll bands between the sweep's three sample positions** *(opened by
   the V pass)* — a page taller than three viewports has unsampled regions, and
   the `code-block-expanded` state falls in one, so the expanded state was never
   observed to differ from the collapsed one.
6. **Multi-row table behaviour** *(opened by the V pass)* — every admin table
   held at most 3 rows, so cross-row alignment and per-row action spacing were
   never tested.
7. **Motion the API cannot represent** *(opened by the M pass, #334)* — a
   transition on `::details-content` is never reported by `getAnimations()`, so
   the sweep can neither seek it nor film it. The census now *records* the blind
   spot rather than passing over it, and `/pricing` is in
   `SWEEP_MOTION_EXCEPTIONS` with the reason; what is still missing is a
   value-sampling pass of the kind `useCountUp` gets. The login form's error
   state is separately unphotographable for a stale reason — see #335.

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

## P1 fix pass (touch targets zeroed)

Run `20260928-182132` (`make visual-sweep`, branch `feat/299-control-height-token`,
squash of #299):

| Rule | After P0 `20260928-171951` | After #299 `20260928-182132` |
|---|---|---|
| `touch-target-small` | 135 | **0** |
| `text-tiny` | 0 | 0 |
| `heading-skip` | 0 | 0 |
| `no-h1` | 0 | 0 |

What happened, in three sweeps:

- **`20260928-174421`**: the first 9 sites ratcheted onto
  `--control-height` (theme toggle, menu toggle, input, button, attempt
  timeline summary, copy button, not-found action, demo chip, pagination).
  The count stayed 135 because the 4-per-frame report budget had been hiding
  the *next* elements — the header/footer brand and user-menu button, footer
  GitHub link, breadcrumbs, contact/Legal links, guide/raw-output summaries,
  profile title links, and the difficulty radios (measured raw as 13×13).
- **`20260928-181234`**: the full 34-element sweep of fixes brought 135 → 51,
  the last two being the toast close button (19×26, under the 24px AA floor —
  a MAJOR finding) and the guest "Log in" link (37×44 — padded so its box
  clears 44).
- **`20260928-182132`**: final two fixes (`.colAction` padding, dropdown-item
  min-height); **136 → 0** counted across two more sweeps.

One instrument change shipped with this pass: **labelled inputs are measured
by the union of the input and its labels.** A radio inside a styled
chip-label measures raw as ~13×13, but clicking the label activates it — the
chip is the target. The rule now takes the union box (a labelled radio's
chip is 44px), which is also what the audit's own `fix` text recommends for
radios. Unlabelled controls are measured exactly as before; the union can
only grow the box. Locked by a new fixture in `audit.lock.visual.ts`.

The uncapped probe used to find the hidden elements is gone (it was a
throwaway), but its count — 446 raw instances of 34 distinct elements across
the 25 routes — is the honest scale of the finding; the sweep reports the
same work as 135 capped findings and, now, 0.

## P2 fix pass (field errors announced)

Run `20260928-185447` (`make visual-sweep`, branch `feat/300-aria-field-errors`):

| Rule | After #299 `20260928-182132` | After #300 `20260928-185447` |
|---|---|---|
| `touch-target-small` | 0 | 0 |
| `field-error-announced` *(new)* | — | **0** |
| `text-tiny` / `heading-skip` / `no-h1` | 0 | 0 |

The P2 finding was that `Field`'s error message was orphaned: the field was
labelled (so `control-unlabelled` passed) but a screen reader announced no
error with it. The fix ships a new audit rule plus the wiring:

- **`field-error-announced` rule** — any `[aria-invalid="true"]` control
  whose `aria-describedby` does not name a visible element is reported. The
  rule is structural, so a future input that styles red without announcing
  gets caught by the next sweep.
- **`Field`** clones `aria-invalid` and `aria-describedby` onto its child
  control (pointing at the `id`-derived error message element);
  **`FieldGroup`** puts `aria-describedby` on its `role="group"` wrapper.
  The three inputs also emit `aria-invalid` from their `invalid` prop when
  used bare.
- Lock fixtures: the rule fires on an erroring input with no
  `aria-describedby`, and audits clean on one that references a real
  message; vitest cases cover `Field`, `FieldGroup` and the valid
  noise-free path.

**Correction (#323).** The wiring above was only ever correct for a *single*
child. `Field` located the control with `isValidElement(children)`, and React
hands over an **array** when a field has more than one child, so the guard was
false and the clone was skipped — no `aria-describedby`, silently, with no
test and no rule failure to show for it. Only one field in the app has more
than one child: the register password input, which carries a strength hint
beside it. The inline error still rendered and still looked correct, so the
sweep's own `login-field-errors` state (single-child fields, 0 findings) could
not see it, and the structural rule could not either — an unannounced field is
indistinguishable from an unwired one once the attributes are simply absent.

`Field` now finds the control as the first element among its children and
rebuilds `children` with that one cloned, so sibling hints keep rendering. The
one remaining silent case — an error with no element to attach to — warns in
development instead of doing nothing. Covered by a component test asserting
the wiring holds with a second child, and a page-level test on register
asserting the password control's `aria-describedby` resolves to the visible
message. The general case is still a standing limitation of the rule: it can
only prove a present `aria-describedby` is valid, never that a needed one
exists.

The sweep's `login-field-errors` state exercises the wiring on a real page:
0 `field-error-announced` findings.

## v0.21.0 evidence pass — geometry audit (#307)

Two runs feed this section:

- `make visual-sweep` → **`20260928-200411`**: **0 rule findings** — `text-tiny`,
  `heading-skip`, `no-h1`, `touch-target-small`, `field-error-announced` all
  clean across the 344-frame matrix (light + dark × desktop + Pixel 7).
- A one-off **geometry audit** (temporary `e2e/visual/geometry.visual.ts`,
  deleted after the run): `getComputedStyle` + `getBoundingClientRect` per
  route × theme × viewport on the sweep's deterministic production build, so
  every number below is a computed value, not an impression.

Dark-theme parity is confirmed: h1 and subtitle sizes are identical in both
themes on every route. The `color: transparent` computed on every `h1` is the
intentional `background-clip: text` gradient in `PageTitle` — not a defect
(locked by `hero-sweep.test.ts`).

### A — Structural inconsistency (same family, different treatment)

**A1. App-family h1 splits: 30px content vs 24px administrative.**
Measured `h1` font-size, desktop @1280 / Pixel 7 @412:

| Tier | Pages | px |
|---|---|---|
| Content | challenges, challenges/:id, results/:token, challenges/new, challenges/:id/edit, submissions/:id, * (404) | 30 / 30 |
| Administrative | profile, admin, admin/users, admin/challenges, admin/submissions | **24 / 24** |
| Auth shell | login, register, auth/callback (deliberately separate family) | 24 / 24 |
| Marketing | features, pricing, demo, about, contact, privacy/terms/security/gdpr | 44 / 32 |
| Home hero | / (hero variant, by design) | 44 / 36 |

Cause: `PageTitle size="md"` on the content pages vs `size="sm"` on Profile +
all four Admin pages. `sm` (2xl) is otherwise the auth shell's tier, so the
administrative suite renders an auth-sized title 6px below its sibling content
pages. Recommendation: content + administrative apps all use `md`.

**A2. Marketing title→subtitle gap drifts: 8px vs 16px.** Measured `h1`
margin-bottom: Features and Contact 8px; Pricing, Demo, About and all four
legal pages 16px. Same hero block, two gaps.

**A3. Marketing subtitle measure drifts: 600px vs 640px.** Features, Pricing,
Demo, About, Contact subtitles are 18px capped at 600px; the legal pages are
18px capped at 640px; challenge forms are 16px capped at 640px. The same
"subtitle under the h1" role uses three widths.

**A4. App-family subtitle tiers: 14px plain vs 16px/640px on forms.**
Challenges, Profile and Admin subtitles are 14px with no measure; Create and
Edit challenge are 16px at 640px. The forms define a second tier inside the
same family.

**A5. Structural outliers.** `/profile` renders the username as the bare h1
with no header block, eyebrow or subtitle (page-rhythm's "app" rhythm but no
header treatment at all). The catch-all 404 renders a bare h1 + EmptyState
with no header wrapper — the only app page with none. `/challenges/:id` and
`/submissions/:id` use the back-link header with no subtitle (defensible as a
detail rhythm; the header wrapper exists).

**A6. Naming drift (code-level).** The hero-subtitle role is `.subtitle`
(Features, Contact), `.pageSubtitle` (Pricing, Demo), `.tagline` (About) and
`.summary` (Legal); `page-rhythm.test.ts` probes three of them. The title
layout class is `.title` vs `.pageTitle` vs `.name`. Header wrapper is
`<header class={header}>` vs `<div class={pageHeader}>` vs bare siblings.

### B — Typography off the token scale

`docs/DESIGN_SYSTEM.md` says components reference tokens only; `Features`'
font-size literals are not among the sanctioned exceptions:

**B1. `Features.module.css` — 15 literal font-sizes** (`0.75, 0.78, 0.8, 0.85,
0.9, 0.95, 1.4, 1.6, 1.75, 2rem`). The page's `h2` renders at 22.4px —
between the scale's 1.25rem and 1.5rem steps — so the off-scale values are
visible, not hypothetical.

**B2. Off-scale literals elsewhere:** Pricing `2.5rem` (above the scale max
2.25rem) and `1.4rem`; Home `0.85/1.5/2/2.25rem`; Demo `1.5rem` + two
`0.85rem`; Contact `2rem`; `ResultReport` `22px`. Each should land on the
nearest `--font-size-*` token.

### C — Visible upgrade candidates (subjective; before/after per batch)

- **C1** Apply A1: the admin suite at 30px lifts the whole administrative
  hierarchy to the content tier.
- **C2** Give the 404 the app header treatment (back link + header wrapper)
  so the error state does not read as a blank page.
- **C3** Profile: keep the h1 as the username (identity), add the app header
  rhythm around it (subtitle line with email/joined) instead of a bare card
  title.
- **C4** Single subtitle measure on marketing (600px everywhere) — the legal
  640px reads as an accident of copy volume.
- **C5** Deliver batch 3 with frame evidence (contact sheets) so each upgrade
  is approved on what it looks like, not on the number.

### Verdict

Every rule is clean and dark parity holds; all findings here are **measured
family drift** — same role, different size/width/gap — plus off-scale
typography. Fixed in three batches: structural (A1–A6), typography scale
(B1–B2), polish (C1–C5).

## B fix pass — typography onto the scale (#311, batch 2)

Run `20260928-203451`: **0 findings**. All 27 literal font-sizes from B1/B2
mapped to the nearest `--font-size-*` token (xs 12 / sm 14 / base 16 / lg 18 /
xl 20 / 2xl 24 / 3xl 30 / 4xl 36):

| Where | Was | Now | Role |
|---|---|---|---|
| Features `.featureTitle` (h2) | 1.4rem (22.4px) | `--font-size-2xl` (24px) | content heading |
| Features `.pipelineBadge`/`.pipelineDesc` | 0.85rem | `--font-size-sm` | label/description |
| Features `.pipelineIcon` | 1.75rem | `--font-size-3xl` | icon |
| Features `.pipelineName` / `.listItem` | 0.95rem | `--font-size-base` | name / list text |
| Features `.providerRow` / `.reportScoreLabel` | 0.9rem | `--font-size-sm` | chip / label |
| Features `.providerSub`, code blocks | 0.75rem | `--font-size-xs` | fine print / code |
| Features `.reportScore` | 2rem | `--font-size-3xl` | metric display |
| Features `.reportItemStatus` | 0.78rem | `--font-size-xs` | mono chip |
| Features `.checkBadge` | 0.8rem | `--font-size-xs` | badge |
| Features `.ctaTitle` | 1.6rem | `--font-size-2xl` | section heading |
| Pricing `.tierPrice` | 2.5rem (40px, above scale max) | `--font-size-4xl` (36px) | price display |
| Pricing FAQ `+` marker | 1.4rem | `--font-size-2xl` | glyph |
| Home `.sampleTest` | 0.85rem | `--font-size-sm` | mono sample |
| Home `.pipelineIcon` | 1.5rem | `--font-size-2xl` | icon |
| Home `.statValue` | 2rem | `--font-size-3xl` | metric display |
| Home `.heroTitle` (≤768px) | 2.25rem | `--font-size-4xl` | hero |
| Demo `.stepIcon` | 1.5rem | `--font-size-2xl` | icon |
| Demo `.phaseText` / test rows | 0.85rem | `--font-size-sm` | labels |
| Contact `.handoffIcon` | 2rem | `--font-size-3xl` | icon |
| ResultReport `.ringText` | 22px | `--font-size-2xl` | ring numeral |

Measured on the live stack: Features `h2` 22.4px → 24px. `font-size: inherit`
and the component-level literals (`Logo`, `PageTitle`'s responsive clamp) are
deliberate and untouched.
## C fix pass — marketing hero spacing (#313, batch 3)

Run `20260928-204840`: **0 findings**. The two remaining measured drifts
unified:

- **Eyebrow→title gap**: Features/Pricing/Demo/About 0px → **12px**
  (`margin: var(--space-3) 0 var(--space-4)` on `.title`), matching
  Contact/Legal.
- **Hero→content gap**: Legal 32px → **48px** (`space-12`), matching the
  other five marketing pages.

Measured across features/pricing/about/contact/privacy on the live stack:
`h1` margin-top 12px, header margin-bottom 48px on every page. All marketing
heroes now share one title treatment, one eyebrow gap and one close.

---

## V pass — reading the frames, not just measuring them (#319)

Everything above is a measurement. This section is the first pass that *looked*.

It exists because the report had an honest admission in it, quoted at
["Not covered"](#not-covered--needs-a-human-or-a-rule-that-does-not-exist-yet)
item 1: *"Aesthetics. Nothing here judges whether the app looks good. Open the
contact sheets."* Nobody ever opened them — the model driving the sweep has no
vision, so the limit was structural, not a matter of effort. #315 added a
vision-capable `visual` subagent; this is the pass that uses it.

### Evidence

Run `20260928-204840` (the batch-3 gate) — **332 frames**, 26 groups x 2 themes
x 2 viewports. Reviewed via the `visual` subagent in 12 tasks, grouped so each
task held one surface: marketing, legal, auth, app, admin, and the interactive
states.

### The tooling problem came first

The obvious approach — hand the `visual` agent the existing contact sheets —
**does not work**, and it is worth recording why, because the failure is
invisible and produces confident nonsense.

The contact sheets are built for *human* triage: 320px tiles, 12 per 4x3 sheet.
At that size the tile type is below a vision model's legibility threshold, and
worse, it cannot reliably tell which tile came from which file. Measured, not
assumed:

| Attempt | Result |
|---|---|
| 1 sheet, 1 image | correct, 9/10 confidence, headline read verbatim |
| 1 sheet × 12 separate reads (one route) | **5 of 12** frames bound to the right file |
| 12 sheets, 24 reads | reviewer reported `login/scroll-0.png` returning the **demo** page, and one path returning three different images across three reads |
| 3 labelled sheets, 9 frames | **9 of 9** correct, every caption read verbatim |

A reviewer asked to read 12 unattributed frames produced findings that were
*plausible and wrong* — a real-looking paragraph of observations about a pricing
page that was in fact the demo page. Written into this report unchallenged, that
would have been three issues and a false confidence claim.

The fix is one file, `e2e/visual/helpers/review-sheets.mjs`: same tiling maths,
**640px cells instead of 320** (half the capture's native width, desktop and
Pixel 7 alike), and **22px captions burned into each cell** instead of 12px. The
sheet becomes *self-labelling* — the reviewer quotes the caption it can see
beside each finding, which turns attribution from a memory exercise into
something checkable against the pixels. That single change took attribution from
5/12 to 9/9 on a harder test.

```bash
make visual-sweep                                  # frames
cd frontend && node e2e/visual/helpers/review-sheets.mjs   # sheets, into visual-review-sheets/
```

### What the pass found

**Three defects, all confirmed in source. V1 is user-visible in production;
V3 is invisible to sighted users and to this report's own rules.**

#### V1 — the login error banner leaks an internal field key (DEFECT, confirmed) — **#320**

`states/login-field-errors` shows the form-level banner reading:

> `identifier: String should have at least 3 characters`

while the field it belongs to is labelled **"Email or username"**. The same
message is already shown inline under the input, so the banner adds only the
dev-facing key. Confirmed at the source, not inferred from pixels:

- `services/api.ts:112` builds the summary as `` `${field}: ${msg}` `` from the
  Pydantic 422 `loc` — so the raw key is composed into the string by design.
- `pages/Login.tsx:49` sets that summary via `extractError(err)`, and
  `pages/Login.tsx:104-108` renders it verbatim in the `role="alert"` banner.
- The user-facing label is `"Email or username"` (`Login.tsx:81`), so the key
  `identifier` is never a word the user has seen.

Every 422 on a form that renders a banner leaks the same way; `Register.tsx:37`
has the identical `setError(extractError(err))` call. A validation error is
shown twice — once correctly, once as a developer-facing string.

#### V2 — `/admin/submissions` has no row actions (DEFECT, confirmed) — **#321**

The admin submissions table renders 7 columns and stops at `CREATED`
(`pages/Admin/AdminSubmissions.tsx:106-112`). There is no `ACTIONS` header and
no per-row control. The sibling tables both have one —
`AdminChallenges.tsx:139` and `AdminUsers.tsx` both render an actions column
with a destructive control. So an admin can delete a challenge and delete a user
from the console, but cannot act on a submission at all, and the table's only
asymmetry is invisible rather than intentional.

#### V3 — the register password error is never announced with its field (DEFECT, confirmed) — **#323**

`states/register-field-errors` shows the password error correctly placed under
its input, with a matching red border — visually indistinguishable from the
login field, whose error *is* announced. The frames cannot tell the two apart,
but the source can:

- `components/Input/Input.tsx` located the control to wire with
  `isValidElement(children)`. React passes an **array** when a field has more
  than one child, so the guard was false and the `aria-invalid` /
  `aria-describedby` clone was skipped entirely.
- Exactly one field in the app has more than one child: the register password
  input, which carries a strength hint (`pages/Register.tsx`) beside it.

So the control rendered its inline error and its red border while pointing at
nothing — sighted users see the problem, screen reader users hear only the
label. This is the gap the `field-error-announced` rule was added to catch,
and it did not catch it: the rule proves a *present* `aria-describedby` is
valid, and cannot prove a *missing* one should be there. The sweep's own
`login-field-errors` state passes, because login's fields have single children.

Found by reading the register state against the login one, not by measuring
either — the correct answer and the buggy answer produce the same pixels.

#### Three candidates refuted by the source check

The pass is only worth the trouble if the source check is allowed to *reject*
findings. It rejected three:

| Reported | Why it is not a defect |
|---|---|
| `demo` CTA row: a third control is "bare text" while its siblings are buttons | `Demo.tsx:503-509` uses `variant="ghost"` — a deliberate tertiary tier (transparent bg, secondary ink). Intentional hierarchy, not a lost style |
| `submission-loading` is "one featureless empty rectangle" | The sweep runs `prefers-reduced-motion: reduce`, and `Skeleton.module.css` disables the shimmer under it *on purpose* (documented in the file). A paused shimmer is a flat block. Capture artefact |
| Footer year differs between viewports (© 2025 vs © 2026) | `Footer.tsx:84` renders `new Date().getFullYear()` — one value per process. A per-viewport difference is impossible within a run; the reviewer misread a glyph |

### Improvements, grouped by cause

Not defects — coherence and craft, a designer's call. Grouped because most of
them are the same few causes repeated, which is the actionable part.

**Prose measure is the single largest theme.** The legal and docs pages run
body copy at **105–122 characters per line** (privacy, terms, security, gdpr)
against a comfortable 45–75. The amber "template, not legal advice" callout is
worse: it spans the full 1200px container, so its first line is **~177
characters**, ~1.6x an already-long body line, and it starts ~280px left of the
column it introduces. One `max-width` on the callout fixes the worst instance.

**Orphan words and awkward wraps**, all IMPROVEMENT, all fixable with
`text-wrap: balance` on the affected headings: home's features subhead (line 2
is the single word "assistants."), home's hero subhead (splits "All in one
platform", then strands "platform." alone on mobile), home's middle feature card
("sandbox." alone), demo's subtitle ("now." alone), pricing's disclaimer
("implemented yet."), and the em-dash break in the terms contents rail.

**Reflowed grids leave a half-empty last row.** Features' 5-step pipeline is 5
across on desktop and reflows to 2 columns on Pixel 7, so the 5th card ("Score")
sits alone with an empty cell beside it in both themes. Same shape on home's
mobile footer (2+1 with a ~175px void beside LEGAL). Centring or spanning the
last item is the fix.

**Container gutters disagree.** Three independent reviewers measured a 24px
mismatch on the auth pages: nav/footer inset 64px vs the auth grid's 40px. The
source explains it exactly — `AuthLayout .grid` (line 23-33) sets
`max-width: var(--max-width)` *inside* a `.page` that already applies
`padding: … var(--space-6)` (line 15), while `.nav` and `.container` apply the
padding themselves. Double centring, so the auth content sits 24px inboard of
the chrome on every auth page.

**Admin table craft.** `/admin/users` gives the destructive control
("Delete") the *plain* style while the less-final "Deactivate" is solid red —
inverted against `/admin/challenges`, where "Delete" is solid red. Its `ACTIONS`
header also aligns to neither end of the action cluster, unlike every other
header on the row. `/admin/submissions`' status filter spans the full 1150px
container for a single-select. On `/challenges`, the `CREATED` column is ~310px
wider than its content while `TITLE` carries two lines.

**Density and hierarchy.** `/profile` and `/submissions/:id` are both dashboards
but use two different stat-tile systems (value-above-label, uppercase, centred,
30px accent vs label-above-value, sentence case, left, 24px muted) with nothing
tying them together. The submission score (96.7%) is the same 24px as its
siblings ("118/120", "completed", "4.2s"), so only the ring graphic makes it the
headline. The public share page shows "Score 96.7%" beside "Tests passed 118/120"
with nothing explaining that the score is composite — a first-time visitor from
a link can read one as a bug — and it ends with no in-context next action.

**States.** The login submitting state changes only the primary button; the
inputs and the GitHub button stay fully enabled-looking while the request is in
flight. `Log out` in the user dropdown has no divider or danger colour, so it
reads as another nav item. The mobile nav trigger stays `☰` while open. The
login error banner changes *kind* between themes (pale tinted pill in light,
solid red block in dark) for the same element.

### What the pass also could not determine

Worth as much as the findings — it is the honest edge of the method:

1. **Regions between the three scroll positions.** The sweep samples 0%, 50%,
   100%, so a page taller than three viewports has unsampled gaps. The pricing
   FAQ's third item, the submission "Outcome" body and the `code-block-expanded`
   state fall in them. The expanded state was therefore never observed to differ
   from the collapsed one.
2. **Anything hover-, focus- or scroll-triggered.** A static frame cannot show a
   hover-revealed row action, a focus ring, or a nav that hides on scroll. One
   reviewer found an *empty band at the top of desktop mid-scroll frames* where
   the navbar should be, and could not tell a sticky-header paint bug from a
   paused hide-on-scroll transition. Unresolved.
3. **Sub-pixel alignment at 0.5x.** Cells are half-scale, so gutters carry
   ±20px of error. The 24px auth mismatch is above that threshold; claims
   below it are not asserted.
4. **Design intent.** The pass can see that a gap is 3x its neighbours. It
   cannot know whether the gap is deliberate breathing room or an accident.

### Effect on "Not covered"

Item 1 (*aesthetics*) is now **closed** — looked at, across all 26 groups in
both themes and both viewports, with the findings written up above. Item 3
(*text that is legible but wrong*) is **partly** closed: wrap quality, orphan
words and prose measure were reviewed and reported; what remains is copy
editing, not layout.

Items 2 (form errors not linked to inputs) and 4 (the 4.0px shadow rounding)
are untouched by this pass, and the states review independently confirmed item 2
is now fixed — the inline error sits directly under its input with a matching
red border, in all four theme/viewport combinations.

New gaps this pass opened, none of which a static frame can close: hover and
focus states, the unsampled scroll bands, and multi-row table behaviour (every
admin table held at most 3 rows, so cross-row alignment was never tested).

## M pass — motion the sweep could not see (#332, #334)

The [Motion](#motion) table above covers three filmstrips, all on `/`. This pass
is about a motion surface the sweep had no way to look at, and about the defect
that was hiding in it.

### The finding

`/pricing`'s FAQ disclosure rotated its `+`/`×` glyph over 200ms while the
native `<details>` answer had **no transition at all**, so the answer snapped
open and closed instantly. The closing half is the part that reads as a bug
rather than a taste question: a row that was **already collapsed still showed a
`×`** for roughly the first 160ms, because the glyph was the only thing still
moving.

Four independent reads of the toggle clip reported it. The existing test suite
passed throughout — the DOM said the right things were present, and nothing in
jsdom can see two things moving at different speeds.

After the fix both halves animate off one custom property, `--faq-reveal`, via
`::details-content` with `interpolate-size: allow-keywords`. Measured, the two
track within **0.17 percentage points** at every sampled frame.

### Why the sweep could not have found it

This is the part worth keeping. `helpers/motion.ts` is built on one rule —
*never sample animation state by elapsed time*, seek everything instead — and it
is honest about its limits. `AnimationCensus` carries an `unseekable` list, and
`assertSeekable` refuses to let a run report success while an animation it meant
to place stayed put.

But the census is built on `document.getAnimations()`, and **that API does not
report `::details-content` transitions at all**. Not late, not unreliably —
absent. The census on `/pricing` returns `total: 0` while the page visibly
animates, and `assertSeekable` passes it. The motion pass would have reported
"nothing to see".

That is the failure `manifest.ts` already names as the worst one available:

> *A guard that passes because it looked in the wrong directory is worse than no
> guard, because it converts a crash into a false all-clear.*

Verified in Chromium 153, because the scope turned out to be much narrower than
it first looked:

| declaration                          | in `getAnimations()`?     |
|--------------------------------------|---------------------------|
| `.a::after { transition: transform }` | **yes** — `pseudo=::after` |
| `.c::details-content { transition }` | **no** — no entry at all   |

`::before`/`::after` transitions are seekable and must **not** be reported as
blind spots. An earlier draft of the detector scanned all three and its comment
"proved" the wrong thing, from a test whose pseudo transition had never been
*triggered* — an untriggered transition has no `Animation` to report, so the
experiment would have "confirmed" the claim about any pseudo-element ever.

### What changed

- `censusPseudoTransitions` reports transitions the census can see declared in
  CSS but that no `Animation` object represents. Deterministic — a computed-style
  read, no clock, nothing to flake. Measured across `/`, `/pricing`, `/features`
  and `/challenges` at two viewports: **one** blind spot found, the FAQ's
  `::details-content`, and no false positives.
- `AnimationCensus.pseudoTransitions` carries it into the manifest, so a run
  cannot look clean by omission.
- `census.lock.visual.ts` locks the behaviour in a real browser, both ways: the
  declaration is reported, **and** `/`'s element-level motion is not. Mutating
  the detector to widen its scope fails the control; mutating it to return
  nothing fails the positive.
- `SWEEP_MOTION_SURFACES` + `SWEEP_MOTION_EXCEPTIONS` replace a comment in
  `routes.ts` that had gone stale — it asserted `/` was the only page with a
  motion system, which #332 made false. Now checkable, in both directions.

### No filmstrip for `/pricing`, deliberately

A `kind: "transition"` pass would be worse than nothing here. It seeks each
animation to a fraction of its own duration; on this page the census sees **one**
animation (the glyph) and the answer's `block-size` is not in the set, so the
seek would place the glyph faithfully and leave the panel snapped. Every frame
would show an open row with an unfinished `+` — indistinguishable from the
defect this pass fixed, and this report already has one instance of a rule
filing a filmstrip frame as a blocker.

So the invariant is asserted where it can be observed: `e2e/pricing.spec.ts`
stretches the transition and compares the two halves' normalised progress, and
`/pricing` is listed in `SWEEP_MOTION_EXCEPTIONS` with that reason. The missing
piece is a pass that samples the *value* rather than seeking the animation, the
way `useCountUp` is handled.

### Also found, and not fixed here

The `login-field-errors` state failed on every run, in both themes and both
viewports, **on `dev` with a clean tree** — its proof text still expected the
Pydantic 422 body (`identifier: String should have at least 3 characters`) that
#320/#326 removed from the UI, so it matched nothing and four frames were never
captured. #335 fixes it, and adds the locks that make the class visible without
a browser: see [M pass](#m-pass--motion-the-sweep-could-not-see-332-334) and
issue #335.

### A false blocker, and what a report with nothing in it has to prove

`findings.json` was carrying 4 `text-clipped` **blockers** on `/pricing` that
were false positives introduced by #333: the visually-hidden "Included" / "Not
included" text on `ComparisonMark`, which the standard `.srOnly` pattern clips to
a 1px box on purpose. `text-clipped` saw 22px of text needing 1px and said so,
loudly, in the one place a reviewer's eye goes.

A rule that files *intentional* clipping as a blocker is the mirror image of the
false all-clear [above](#m-pass--motion-the-sweep-could-not-see-332-334), and the
cure is worse: a reader learns to dismiss blockers, and that habit outlives the
reason. #337 exempts the visually-hidden pattern, keyed on the clip
(`rect(0px, 0px, 0px, 0px)` / `inset(50%)`) rather than on size, because size is
where real clipping lives.

The interesting part is what an exemption owes in return. The two quiet fixtures
pass just as well if the rule is switched off wholesale, and a report that
silently loses a rule is indistinguishable from a clean one — which is the same
problem this section opened with. So the exemption is asserted in both
directions: `srOnly` text must stay quiet, **and** a genuinely clipped sentence
on the same page must still fire. Widening the exemption to "anything that
clips" fails that control, which is the only thing standing between a shorter
report and a weaker one.

`findings.json` is now empty: **0 findings across 344 frames**. Read that
against the caveat [above](#no-blockers-no-majors-is-evidence-about-these-11-rules-not-about-the),
though — an empty report is what a broken audit looks like too. What makes it
evidence here is that the same run carries `audit.lock.visual.ts` green, where
every rule fires on a fixture built to break it and is asserted to have fired
*about the element it was aimed at*. The rules are demonstrably alive; the app is
demonstrably clean. Those are different claims, and the harness is built so they
are checked by different tests.
