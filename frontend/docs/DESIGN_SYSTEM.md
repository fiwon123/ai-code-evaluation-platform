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
inverse scheme (light text on dark surfaces). Code surfaces
(`--color-code-*`) stay dark in both themes for readability.

Text on colored/accent surfaces uses `--color-on-accent` (e.g. button labels,
active pagination page, avatars) instead of hardcoded white.

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
| `--color-secondary` | Reserved — secondary text uses `--color-text-secondary`; no current use |
| `--color-success` | Positive status, pass indicators |
| `--color-success-light` | Success-tinted surfaces |
| `--color-warning` | Warning status |
| `--color-warning-strong` | Warning text on a tinted background |
| `--color-warning-light` | Warning-tinted surfaces |
| `--color-danger` | Errors, destructive actions |
| `--color-danger-hover` | Destructive button hover |
| `--color-danger-light` | Error-tinted surfaces |

### Surfaces and text

| Token | Used for |
|-------|----------|
| `--color-bg` | Page background |
| `--color-bg-subtle` | Subtle background accents |
| `--color-bg-gradient` | Landing hero gradient |
| `--color-surface` | Cards, panels, table rows |
| `--color-surface-secondary` | Nested surfaces |
| `--color-surface-raised` | Raised surfaces (menus, popovers) |
| `--color-divider` | Dividers and separators |
| `--color-border` | Borders |
| `--color-border-hover` | Border hover states |
| `--color-text` | Body text, headings |
| `--color-text-secondary` | Secondary text, labels |
| `--color-text-muted` | Placeholders, meta text |
| `--color-focus-ring` | Focus ring color |
| `--color-on-accent` | Text on colored surfaces (button labels, active pagination, badges) |

### Code surfaces

Dark in both themes, for readability.

| Token | Used for |
|-------|----------|
| `--color-code-bg` | Code block background |
| `--color-code-header` | Code block header bar |
| `--color-code-border` | Code block border |
| `--color-code-text` | Code text |

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
- Badges/status pills use the `-light` variants with the matching strong text
  color (e.g. `--color-warning-strong` on `--color-warning-light`).
- Focus states: use the existing transition tokens and a visible outline;
  never rely on color alone.

## Dark-mode checklist for new components

1. Verify the component reads every color from a token.
2. Check both `:root` and `[data-theme="dark"]` values for contrast.
3. Test with `ThemeToggle` and with `prefers-color-scheme: dark`.
4. If a new token is needed, add it to both palettes in `globals.css`.