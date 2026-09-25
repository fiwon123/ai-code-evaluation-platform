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

That composition is why titles need **no light-mode override**: light resolves
to `#1d4ed8 → #1e40af` (5.9:1 and 7.8:1 on `--color-bg`) and dark to
`#3b82f6 → #60a5fa` (5.2:1 and 7.5:1), so the gradient is legible in both
themes. Do not "fix" a title that looks off in light mode by neutralizing the
clip (`background: none; background-clip: initial`) — that reintroduces the
per-page divergence the component exists to remove, and
`src/styles/theme-contrast.test.ts` fails on both that and on a contrast drop.

## Color tokens

### Semantic palette (both themes)

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--color-primary` | `#2563eb` | `#3b82f6` | Primary actions, links |
| `--color-primary-hover` | `#1d4ed8` | `#60a5fa` | Primary button hover |
| `--color-primary-light` | `#dbeafe` | `#1e3a5f` | Primary-tinted surfaces |
| `--color-secondary` | `#64748b` | `#94a3b8` | Secondary text/actions |
| `--color-success` | `#16a34a` | `#22c55e` | Positive status |
| `--color-success-light` | `#dcfce7` | `#14532d` | Success-tinted surfaces |
| `--color-warning` | `#f59e0b` | `#f59e0b` | Warning status |
| `--color-warning-strong` | `#b45309` | `#fbbf24` | Warning text on tinted bg |
| `--color-warning-light` | `#fef3c7` | `#78350f` | Warning-tinted surfaces |
| `--color-danger` | `#dc2626` | `#f87171` | Errors, destructive actions |
| `--color-danger-hover` | `#b91c1c` | `#fca5a5` | Destructive button hover |
| `--color-danger-light` | `#fee2e2` | `#7f1d1d` | Error-tinted surfaces |

### Neutrals

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--color-bg` | `#f1f5f9` | `#0b1220` | Page background |
| `--color-bg-subtle` | `#eff6ff` | `#111c34` | Subtle background accents |
| `--color-bg-gradient` | blue→slate | slate→dark | Landing hero gradient |
| `--color-surface` | `#ffffff` | `#111a2e` | Cards, panels |
| `--color-surface-secondary` | `#f8fafc` | `#0e1626` | Nested surfaces |
| `--color-border` | `#e2e8f0` | `#24324a` | Borders, dividers |
| `--color-border-hover` | `#cbd5e1` | `#38506f` | Border hover states |
| `--color-text` | `#0f172a` | `#e2e8f0` | Body text |
| `--color-text-secondary` | `#475569` | `#94a3b8` | Secondary text |
| `--color-text-muted` | `#94a3b8` | `#64748b` | Placeholders, meta |
| `--color-header` | white 80% | dark 85% | Sticky header background |
| `--color-on-accent` | `#ffffff` | `#ffffff` | Text on colored surfaces |
| `--color-code-bg/header/border/text` | dark slate family | — | Code blocks (dark in both themes) |

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
- Shadows: `--shadow-sm/md/lg` for elevation; cards default to `--shadow-sm`.
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