# Frontend Design System

Design tokens and conventions for the AI Code Evaluation Platform frontend.
All tokens live in [`src/styles/globals.css`](../src/styles/globals.css) as CSS
custom properties. Components reference tokens only — raw hex/rgba values are
forbidden in component styles.

## Naming conventions

| Prefix | Group | Examples |
|--------|-------|----------|
| `--color-*` | Color tokens (semantic intent, not raw hues) | `--color-primary`, `--color-danger-light`, `--color-text-muted` |
| `--color-*-hover` | Hover variants of a color | `--color-primary-hover`, `--color-danger-hover` |
| `--color-*-light` | Tinted surface variants | `--color-success-light`, `--color-warning-light` |
| `--font-*` | Font family / size tokens | `--font-sans`, `--font-mono`, `--font-size-lg` |
| `--space-*` | Spacing scale (0.25rem steps) | `--space-1` … `--space-20` |
| `--radius-*` | Border radius | `--radius-sm` … `--radius-full` |
| `--shadow-*` | Elevation shadows | `--shadow-sm`, `--shadow-md`, `--shadow-lg` |
| `--transition-*` | Motion durations | `--transition-fast`, `--transition-base` |
| `--max-width`, `--header-height` | Layout constants | — |

**Rules**

- Use semantic names, never color names: write `var(--color-danger)` not
  `var(--color-red)` or `#dc2626`.
- A token must be **defined in `globals.css`** before it is used anywhere.
  Undefined variables silently resolve to invalid/transparent values — if a
  component looks broken, check the token exists and is spelled exactly
  (`--font-size-3xl`, not `--font-3xl`; `--color-text-muted`, not `--color-muted`).
- Components may apply existing tokens but must not introduce new raw values
  inline. New colors require adding a token to both `:root` and `[data-theme="dark"]`.
- **No inline fallbacks on a color token** — write `var(--color-danger)`, never
  `var(--color-danger, #dc2626)`. Every color token exists in both palettes, so a
  fallback is dead weight; worse, it hides a typo. A fallback on a token that is
  *never defined* is worse still: it renders silently and the intended style
  never applies (this is how the admin table row hover became a no-op).
  `design-tokens.test.ts` fails on both.
- The only raw values allowed in component CSS are decorative ones that are not
  theme colors: the mock IDE chrome in `Features.module.css` and the second
  gradient stop of the admin status bar. Everything else reads a token. Inline
  SVG attributes such as `Logo`'s `stroke="#ffffff"` cannot take `var()` and are
  exempt for the same reason.

## Theming

Themes are applied via the `data-theme` attribute on `<html>`:

- `:root` / `[data-theme="light"]` — default light palette
- `[data-theme="dark"]` — dark palette

The `ThemeToggle` component manages the attribute, persists the choice under
the `theme` key in `localStorage`, and falls back to `prefers-color-scheme`.

Every color token must have a value in **both** palettes. Neutrals follow an
inverse scheme (light text on dark surfaces). Two families are deliberately
declared **once**, outside both palette blocks, because the surface they paint
does not change with the theme: the code surfaces (`--color-code-*`) stay dark in
both themes for readability, and the site chrome (`--color-chrome-*`) is one
fixed panel for the header and footer — see [Site chrome](#site-chrome).

Text on colored/accent surfaces uses a token instead of hardcoded white, and
which one depends on how bright the surface is:

- `--color-on-accent` — for **dark** accents of arbitrary colour: the language
  badge colours (`#3776AB`, `#CC342D`, …), which are dark in both themes.
- `--color-on-solid` — for the theme's own **solid brand surfaces**: primary
  buttons, the danger button, the active pagination page, avatars and primary
  gradients. White in the light palette; dark ink in the dark palette, because
  the dark theme's surfaces are bright.

That split is not cosmetic. In the dark palette, white on `--color-primary`
(`#3b82f6`) is **3.68:1** and white on `--color-danger` (`#f87171`) is **2.77:1**,
both under the 4.5:1 that WCAG AA requires for button labels. Dark ink
(`#0b1220`) gives 5.09:1 and 6.77:1. Nor can the surfaces simply be darkened
instead: a dark blue button on a dark card is 1.92:1, failing WCAG 1.4.11 for
non-text contrast, and darkening `--color-primary` would also drag
`--gradient-title` (built from the primary tokens) down from 5.15:1 to 3.67:1
against the dark page. Flipping the text is the only option that satisfies both
criteria. `e2e/contrast.spec.ts` measures all of this in both themes.

#### Hover surfaces

`--color-surface-hover` is the state a row or list item rests in under the pointer, and it **darkens in both palettes** — the light palette steps down from `#ffffff`, the dark palette from `#131d33`. That is against the usual dark-UI instinct to lighten, and the reason is measurable: the dark palette's `--color-text-muted` (`#7c8ca6`) is only 4.92:1 on the surface, so there is 0.48 of headroom above AA for 12px text, and the obvious hover (`#1c2846`) spends it — the muted cell in each admin row (the email under the username) drops to **4.27:1**. Stepping down instead keeps both palettes behaving identically and *improves* muted contrast to 5.43:1 while hovered:

| Palette | Surface | Hover | Step | Muted text on hover |
|---------|---------|-------|------|---------------------|
| light | `#ffffff` | `#e3eaf7` | 1.21:1 | 6.27:1 |
| dark | `#131d33` | `#0d1322` | 1.10:1 | 5.43:1 |

Both hovers are also kept clear of `--color-surface-secondary` / `--color-surface-raised`, so "hovered" and "secondary" or "raised" never read as the same state. A hover only *slightly* different from its surface is worse than a missing one: it looks broken rather than absent, so the palette invariant in `design-tokens.test.ts` enforces a 1.05:1 minimum step (GitHub's light-theme row hover is 1.07:1).

#### Card surfaces

`--color-surface-card` is the one surface that is **darker than the page** in the light palette, and it exists because every other candidate was lighter. The measured problem (#351): a feature card built on `--color-bg-subtle` sits on `--color-bg` at **1.05:1**, and its inner panel — `--color-bg` again — sits on the page at **1.00:1**, i.e. the same colour, so the page read as flat grey with panels drawn on it rather than as cards. `--color-surface` is `#ffffff` and separates by less, not more.

| Palette | Page | Card | Step | Muted text on card |
|---------|------|------|------|--------------------|
| light | `#eef2f7` | `#d4deeb` | 1.21:1 | 5.57:1 |
| dark | `#0a1020` | `#141d33` | 1.13:1 | 4.91:1 |

The light step is bounded by text, not by taste: `--color-text-muted` (`#475569`) is the body copy inside these cards, so 5.57:1 leaves 1.07 of headroom over AA, and `--color-text` is 13.13:1. Every darker candidate was measured and rejected — `#cfd9e8` (1.27:1 step, 5.32:1 muted) and `#c3cfe3` (1.40:1, 4.82:1) both buy edge definition by spending legibility on the paragraph, which is the wrong thing to spend.

The dark value is unchanged from what `--color-bg-subtle` already provided, so the dark palette renders identically. That is not laziness: the dark page (`#0a1020`) is already the darkest element in the layout, so the failure mode is one-sided.

<<<<<<< HEAD
#### Site chrome

The sticky header and the footer are **one fixed dark panel in both themes**. They
are the app's only surfaces that do not follow the palette, so they get their own
tokens rather than a per-theme one — declared once in the shared `:root` block,
like the code surfaces, for the same reason.

| Token | Used for |
|-------|----------|
| `--color-chrome-bg` | Header and footer fill |
| `--color-chrome-border` | The bands' edges and the footer's column rule |
| `--color-chrome-text` | Body ink on the bands, including the footer's column headings |
| `--color-chrome-text-muted` | Meta ink on the bands (the copyright line, the user-menu caret) |

They used to read `--color-surface-inverse` and friends, which are per-theme by
contract, and that produced two different navies: the footer measured `#0f172a` in
light mode and `#131d33` in dark. The tokens themselves could not simply be
retuned, because the dark palette aliases `--color-*-inverse` to the ordinary
tokens so `Card variant="dark"` stays a no-op there.

The cost of the per-theme mistake was not only the fill. The bands painted *theme
ink* onto a theme-invariant dark panel, and in light mode that meant:

- the footer's Product / Company / Legal headings were `--color-text` (`#0f172a`)
  on a `#0f172a` fill — **1.00:1**, invisible;
- the 12px copyright was `--color-text-muted` (`#475569`) on the fill —
  **2.36:1**, under the 4.5:1 AA asks for;
- the footer's column rule was `--color-border` (`#c9d4e0`), a bright line across
  a dark panel;
- the mobile ☰ button was `--color-text` inside a `--color-border` ring —
  **1.06:1**, a menu nobody could open on a phone.

So anything drawn on a chrome surface takes a `--color-chrome-*` token, including
the small controls inside the header. `e2e/contrast.spec.ts` already measures the
footer's tagline and a header nav link in both themes;
`chrome-surface.test.ts` holds the tokens' theme-invariance, the ink contrast on
the fill, and which tokens each band's rules are allowed to name.

One honest limitation: the fill is only **1.13:1** against the dark page, so in the
dark theme the border — not the fill — is what delimits the band. That is unchanged
from what dark mode already shipped, and the light theme is not the constraint
(14.93:1 there).

=======
>>>>>>> main
### Page titles

Every page `<h1>` renders through the shared `PageTitle` component
(`src/components/PageTitle/PageTitle.tsx`) — not a per-page class. It supplies
the gradient, weight and tracking; pages pass only `size` (`sm` auth/admin
headings, `md` app pages, `lg` landing pages), an optional `variant="hero"`
(the animated home hero), and a `className` for **layout** only (margins,
max-width, centering).

The gradient comes from `--gradient-title`, which is composed from the
per-theme primary tokens rather than fixed hex values:

```css
--gradient-title: linear-gradient(90deg, var(--color-primary), var(--color-primary-hover));
```

That composition is why titles need **no light-mode override**: both palettes
resolve it to a pair of primary stops that clear WCAG AA (4.5:1) against
`--color-bg`, so the gradient is legible in either theme.
`src/styles/theme-contrast.test.ts` asserts that ratio, which means a palette
change that breaks the title fails the suite instead of shipping.
Do not "fix" a title that looks off in light mode by neutralizing the
clip (`background: none; background-clip: initial`) — that reintroduces the
per-page divergence the component exists to remove, and
`src/styles/theme-contrast.test.ts` fails on both that and on a contrast drop.

The `hero` variant sweeps a wider gradient. Its range is not a matter of taste:
because the heading is transparent text, the gradient must cover the text box
for the *whole* animation, which caps `background-position` at
`1 / (background-size - 1)`. `hero-sweep.test.ts` enforces that.

## Color tokens

**Values are not repeated in this document.** `src/styles/globals.css` is the
single source of truth for both palettes; this file records *which* token to
reach for and what it is for. Duplicating the hexes here is what let the tables
drift out of sync in the first place, so
`src/styles/design-tokens.test.ts` fails if a color token is undocumented, if a
documented token no longer exists, or if a value is copied back into a table
below.

### Accent and status

| Token | Used for |
|-------|----------|
| `--color-primary` | Primary actions, links, focus accents |
| `--color-primary-hover` | Primary button hover |
| `--color-primary-light` | Primary-tinted surfaces |
| `--color-primary-strong` | Primary text on a tinted background — the `processing` status pill |
| `--color-secondary` | Reserved — secondary text uses `--color-text-secondary`; no current use |
| `--color-success` | Positive status, pass indicators |
| `--color-success-strong` | Success text on a tinted background |
| `--color-success-light` | Success-tinted surfaces |
| `--color-warning` | Warning status |
| `--color-warning-strong` | Warning text on a tinted background |
| `--color-warning-light` | Warning-tinted surfaces |
| `--color-danger` | Errors, destructive actions |
| `--color-danger-strong` | Error text on a tinted background |
| `--color-danger-hover` | Destructive button hover |
| `--color-danger-light` | Error-tinted surfaces |
| `--color-accent-teal` | Second stat identity — pure identity, never meaning "good"; pair with a status token when the value is a score |
| `--color-accent-violet` | Third stat identity — same rule as `--color-accent-teal` |
| `--color-accent-rose` | Fourth stat identity — same rule as `--color-accent-teal` |

### Score scale

The four bands of the Home hero's score ring, red through green, at 0–25 / 25–50 /
50–75 / 75–100. They are *not* a status family: the `-strong` steps above answer
"did it pass", and these answer "where on the scale is it". Read the table in
order — the scale's meaning is the sequence, so a reader matching it against a
traffic light needs the order kept.

| Token | Used for |
|-------|----------|
| `--color-score-red` | First band of the score ring's scale — a score under 25 |
| `--color-score-orange` | Second band — 25 to under 50 |
| `--color-score-yellow` | Third band — 50 to under 75 |
| `--color-score-green` | Last band — 75 and up |

Prefer a status token for anything that means pass or fail: a pill, a badge, a
row tint. These four exist because the hero ring steps through them as the score
counts, and because stepping through the `-strong` family read as dark red →
brown → green (`--color-warning-strong` is a brown chosen for text on `#fef3c7`,
not a yellow). Like the `-strong` steps, they are lightness-tuned to clear 3:1
against the surface they are drawn on — `globals.css` carries the measured ratios
for both themes and `theme-contrast.test.ts` fails if any step drops below it.

### Surfaces and text

| Token | Used for |
|-------|----------|
| `--color-bg` | Page background |
| `--color-bg-subtle` | Subtle background accents |
| `--color-bg-gradient` | Landing hero gradient |
| `--color-surface` | Cards, panels, table rows |
| `--color-surface-secondary` | Nested surfaces |
| `--color-surface-raised` | Raised surfaces (menus, popovers) |
| `--color-surface-hover` | Resting state for a hoverable surface (table rows, list items) |
| `--color-surface-card` | Marketing feature/panel cards that must read as a card on the page |
| `--color-surface-inverse` | Dark marketing card fill (`Card variant="dark"`); aliases the ordinary surface in the dark theme |
| `--color-divider` | Dividers and separators |
| `--color-border` | Borders |
| `--color-border-inverse` | Border for dark marketing cards; aliases `--color-border` in the dark theme |
| `--color-border-hover` | Border hover states |
| `--color-input-border` | Form-control boundary — inputs, selects, textareas, radio option boxes |
| `--color-input-bg` | Form-control fill — inputs, selects, textareas. Dark in both themes |
| `--color-input-text` | Form-control value text and the select chevron's hover state |
| `--color-input-placeholder` | Form-control placeholder text and the select chevron's rest state |
| `--color-text` | Body text, headings |
| `--color-text-secondary` | Secondary text, labels |
| `--color-text-muted` | Meta text |
| `--color-text-inverse` | Body text on a dark marketing card; aliases `--color-text` in the dark theme |
| `--color-text-inverse-secondary` | Secondary text on a dark marketing card; aliases `--color-text-secondary` in the dark theme |
| `--color-focus-ring` | Focus ring color |
| `--color-on-accent` | Text on colored surfaces (button labels, active pagination, badges) |
| `--color-on-solid` | Text on solid brand surfaces (primary/danger buttons, active pagination, avatars, primary gradients) |

**`--color-border` is a container edge; `--color-input-border` is a control
edge.** They are not two weights of the same thing, which is why they are
separate tokens rather than a mistake to be tidied away. A container (a card on
a card, a divider, a table rule) is defined by the surface it sits on, so a
pale border is correct and `--color-border` clears 1.50:1 on white on purpose.
A form control has no such cue: an input on a white card is white on white, so
its border is the *only* thing that says "this is a box you can type into", and
WCAG 1.4.11 asks 3:1 for that boundary. Reusing the container border left every
field in the app at 1.50:1.

The light value clears 3:1 against **every** surface a field can be placed on —
`--color-surface` 3.56:1, `--color-bg` 3.16:1, `--color-surface-secondary`
3.31:1 — because `.input` is reused on every form and no component knows which
surface it ended up on. `--color-bg` is the one that fails first, and it fails
invisibly: `#7d90a6` looks like the better pick next to white (3.28:1) and drops
to 2.91:1 there. `input-contrast.test.ts` holds all three numbers, and holds the
modules to actually painting with the token — a compliant token that
`Input.module.css` does not reference would pass a token-level check while the
field stayed unreadable.

The dark value is deliberately equal to the dark `--color-border`, so dark mode
renders exactly as it did before #345. That leaves it at 1.54:1 — below the bar
the light palette now meets, and an open question rather than a settled one. The
measurement and the reasoning are recorded beside the token in `globals.css`.

**Form controls are dark in both themes (#387).** A light field on a bright
marketing card was the hardest place in the app to read typed text, so the
field now matches the code and prompt surfaces. `--color-input-bg`,
`--color-input-text` and `--color-input-placeholder` are dedicated tokens, not
the `--color-code-*` set, so an input and a code block can be retuned
independently. The boundary still comes from `--color-input-border`, and
`input-contrast.test.ts` still measures it against the surface the field *sits
on* rather than its own fill — the boundary separates the box from the card
behind it.

**`Card variant="dark"`** paints the dark marketing surface. Instead of
restyling children it re-points the ordinary tokens (`--color-surface`,
`--color-border`, `--color-text`, `--color-text-secondary`) for its subtree to
`--color-*-inverse`, so descendants need no dark-aware rules. In the dark theme
each inverse token aliases the corresponding ordinary token, which makes the
variant a no-op there. Auth and form card shells stay on the default surface
deliberately — a dark field on a dark card would erase the control's edge.

### Code surfaces

Dark in both themes, for readability.

| Token | Used for |
|-------|----------|
| `--color-code-bg` | Code block background |
| `--color-code-header` | Code block header bar |
| `--color-code-border` | Code block border |
| `--color-code-text` | Code text |
| `--color-code-muted` | Log gutter numbers, traceback frames |
| `--color-code-error` | `FAIL` / `ERROR` / traceback lines |
| `--color-code-warn` | `WARN` / `WARNING` lines |
| `--color-code-ok` | `PASS` / `ok` / `✓` lines |
| `--color-code-gutter` | Line-number gutter rule |
| `--color-code-comment` | Syntax: comments |
| `--color-code-string` | Syntax: strings, chars, docstrings |
| `--color-code-number` | Syntax: numeric literals |
| `--color-code-keyword` | Syntax: reserved words |
| `--color-code-type` | Syntax: type names |
| `--color-code-fn` | Syntax: function and method calls |

The syntax tokens drive the highlighter in `CodeBlock`. Like the severity
tokens they are theme-independent (the surface is dark in both palettes) and
every one clears 4.5:1 against both `--color-code-bg` values. The set is
deliberately muted rather than saturated: code is dense, and a vivid palette
turns a screen of source into stripes that cost more to read than the syntax
distinction is worth. `--color-code-fn` is `--color-code-warn` by hue, which is
fine because the two never appear in the same view — logs are classified by
severity, code by token, and a block is one or the other.

The severity tokens are **not** the page status tokens (`--color-danger`
and friends). On this dark surface light-mode `--color-danger` (#dc2626) manages
only 3.70:1 and `--color-text-muted` only 2.36:1, so reusing them would leave
light-mode logs unreadable. Because the code surface is dark in both palettes,
the severity tokens are theme-independent and defined once outside the palette
blocks. `theme-contrast.test.ts` asserts each clears 4.5:1 against both
`--color-code-bg` values.

## Typography

| Token | Value |
|-------|-------|
| `--font-sans` | system-ui stack |
| `--font-mono` | SF Mono / Fira Code stack |
| `--font-size-xs` | `0.75rem` |
| `--font-size-sm` | `0.875rem` |
| `--font-size-base` | `1rem` |
| `--font-size-lg` | `1.125rem` |
| `--font-size-xl` | `1.25rem` |
| `--font-size-2xl` | `1.5rem` |
| `--font-size-3xl` | `1.875rem` |
| `--font-size-4xl` | `2.25rem` |

Headings: `h1`–`h4` map to `4xl`–`xl`. Body copy is `--font-size-base` with
`1.6` line-height.

## Spacing

Scale: `--space-1` (0.25rem) through `--space-20` (5rem). Values not on the
scale (e.g. `0.375rem`) are exceptions and should be avoided; use `2px`-style
values only inside tokens such as borders/shadows.

## Radius, shadows, transitions

- Radii: `--radius-sm` (4px), `--radius-md` (8px, default for cards/buttons),
  `--radius-lg` (12px), `--radius-xl` (16px), `--radius-full` (pill).
- Elevation: `--shadow-card` is the default card/panel shadow and
  `--shadow-elevated` is for menus, dialogs and popovers. Both are defined per
  theme, so elevation darkens with the palette. `--shadow-sm/md/lg` are legacy
  aliases with no current use — do not reach for them in new code.
- Transitions: `--transition-fast` (150ms) for hovers, `--transition-base`
  (200ms) for theme/color changes.

## Layout

- `--max-width: 1200px` — content container width (`.container` utility).
- `--header-height: 64px` — fixed header height.

## Component conventions

- Components live in `src/components/<Name>/<Name>.tsx` with
  `<Name>.module.css`; styles use `@/src/styles/globals.css` tokens only.
- Buttons: default variant for primary, `variant="danger"` for destructive.
- Badges/status pills use the `-light` variants with the matching `-strong` text
  color (`--color-warning-strong` on `--color-warning-light`, and likewise
  `-success`/`-danger`). The base token is the *identity* color — right as a
  border, dot or accent, and as text on a plain surface — but it is not
  text-safe on its own tint: `#16a34a` on `#dcfce7` is 3.00:1 and `#dc2626` on
  `#fee2e2` is 3.95:1, both under AA. The `-strong` step keeps the hue and
  drops the lightness until the pair clears 4.5:1 on the tint it sits on.
  `theme-contrast.test.ts` holds each pair to its number, so retuning either
  step cannot quietly reintroduce the failure (issue #346).
- Focus states: use the existing transition tokens and a visible outline;
  never rely on color alone.

## Dark-mode checklist for new components

1. Verify the component reads every color from a token.
2. Check both `:root` and `[data-theme="dark"]` values for contrast.
3. Test with `ThemeToggle` and with `prefers-color-scheme: dark`.
4. If a new token is needed, add it to both palettes in `globals.css`.