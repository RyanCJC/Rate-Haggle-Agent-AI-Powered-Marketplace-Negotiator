# Haggle Frontend Design System

## Scope

Desktop-first. The primary target is **desktop-light** (1440x900, light colour scheme),
covered by automated Playwright tests. A dark theme and a stacked mobile layout exist in
the codebase but are **not covered by automated tests** — they are verified manually only.

## Principles ("paper and ink")

- Warm, editorial, trustworthy; a well-made receipt or ledger, not a SaaS dashboard.
- Neutrals do 90% of the work; colour is used sparingly and always paired with icon/text.
- Prices as heroes: tabular numerals, quiet "RM" prefix, monospace for prices/IDs/trace.
- Hairline borders instead of shadows; elevation only for things that float.
- Intentional asymmetry, strong hierarchy, specific human microcopy.
- Visible focus rings, 120–200ms ease-out motion, respects `prefers-reduced-motion`.
- No purple-blue gradients, glow, glassmorphism, centered hero, emoji icons, vague
  marketing copy, shadows and big radii on everything, decoration without meaning.

## Design tokens (`src/design/tokens.css`)

### Colour (light theme, `:root`)

| Token | Value | Usage |
|-------|-------|-------|
| `--color-paper` | `#F7F4EE` | Page background |
| `--color-surface` | `#FFFFFF` | Card/surface background |
| `--color-surface-2` | `#FBF9F5` | Secondary surface |
| `--color-line` | `#E6E0D4` | Hairline borders |
| `--color-ink` | `#14213D` | Body text |
| `--color-text` | `#14213D` | Body text (alias) |
| `--color-muted` | `#5B6475` | Secondary text |
| `--color-primary` | `#2B3A8C` | Agent / links / focus rings |
| `--color-agent-tint` | `#E4E7FB` | Agent bubble background |
| `--color-gold` | `#E8A317` | Money accent (deal price) |
| `--color-seller-tint` | `#F0E6D2` | Seller bubble background |
| `--color-success` | `#0E8A5F` | Success (icon/badge fill) |
| `--color-success-text` | `#0B7957` | Success text on surface |
| `--color-warning-bg` | `#FFF1DC` | Warning background |
| `--color-warning-text` | `#8A4B06` | Warning text |
| `--color-danger` | `#C8361B` | Danger / errors |

### Dark theme (`[data-theme="dark"]` and `[data-theme="system"]` with
`prefers-color-scheme: dark`)

| Token | Value |
|-------|-------|
| `--color-paper` | `#0E1220` |
| `--color-surface` | `#151A2C` |
| `--color-surface-2` | `#1B2138` |
| `--color-line` | `#2A3150` |
| `--color-ink` | `#ECEFF8` |
| `--color-text` | `#ECEFF8` |
| `--color-muted` | `#9AA3B8` |
| `--color-primary` | `#8E9BFF` |
| `--color-agent-tint` | `#232A55` |
| `--color-gold` | `#F5B93A` |
| `--color-seller-tint` | `#2A2620` |
| `--color-success` | `#3DD6A0` |
| `--color-success-text` | `#3DD6A0` |
| `--color-warning-bg` | `#2A2316` |
| `--color-warning-text` | `#D9A44E` |
| `--color-danger` | `#FF7A63` |

### Type scale

| Token | Value |
|-------|-------|
| `--font-sans` | `"Inter Variable", Inter, system-ui, sans-serif` |
| `--font-mono` | `"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace` |
| `--text-xs` / `--text-xs-lh` | `0.75rem` / `1.15` |
| `--text-sm` / `--text-sm-lh` | `0.875rem` / `1.4` |
| `--text-base` / `--text-base-lh` | `1rem` / `1.55` |
| `--text-lg` / `--text-lg-lh` | `1.125rem` / `1.5` |
| `--text-xl` / `--text-xl-lh` | `1.25rem` / `1.45` |
| `--text-2xl` / `--text-2xl-lh` | `1.5rem` / `1.4` |

### Spacing (4px scale)

`--space-1` 4px, `--space-2` 8px, `--space-3` 12px, `--space-4` 16px,
`--space-5` 20px, `--space-6` 24px, `--space-8` 32px.

### Radius

`--radius-sm` 6px, `--radius` 10px, `--radius-lg` 14px, `--radius-full` 9999px.

### Elevation

`--elev-1` / `--elev-2`: `1px solid var(--color-line)` — hairline borders only.

### Motion

`--motion-fast` 120ms, `--motion-base` 200ms, `--ease-out` cubic-bezier(0.25, 1, 0.5, 1).
Disabled under `prefers-reduced-motion: reduce`.

## Component inventory (`src/ui/`)

| Component | Variants | Notes |
|-----------|----------|-------|
| `Button` | primary, secondary, ghost, danger; sizes sm/md; loading state | forwardRef, `pressed` state for theme toggle |
| `Badge` | default, success, warning, danger, neutral | Pill-shaped, hairline border |
| `Card` | padding: none/sm/md/lg | Surface background, hairline border |
| `Tabs` | — | Accessible: arrow-key navigation, roving tabindex, `aria-selected` |
| `Skeleton` | — | Shimmer animation, disabled under reduced motion |
| `Icon` | lucide-react names | Wrapper with fixed sizing |
| `Logo` | — | Inline SVG speech bubble + coin dot; also the favicon |

Fonts: `@fontsource-variable/inter` and `@fontsource-variable/jetbrains-mono` (self-hosted,
no external font requests).

## Theme

System / Light / Dark toggle stored in `localStorage` (key `haggle-theme`, try/catch).
`prefers-color-scheme` respected when set to "system".

## Accessibility rules

- **Contrast**: text pairs ≥ 4.5:1, borders/focus rings ≥ 3:1 on light theme (verified by
  `src/test/contrast.test.ts`). Guard: `tokens.css` must not contain `color-mix(` or
  alpha-defined text colours.
- **Focus**: visible focus rings on all interactive elements (`--color-primary`).
- **Motion**: draw-in animation on PriceLadder only; disabled under
  `prefers-reduced-motion`.
- **ARIA**: `aria-live="polite"` for new messages, `role="img"` with generated aria-label
  on PriceLadder, visually-hidden data table, `aria-label` on all panels.

## How to run

```
npm run lint    # ESLint (typescript-eslint, react-hooks, jsx-a11y)
npm test        # vitest (unit tests)
npm run build   # tsc --noEmit + vite build
npm run e2e     # Playwright (desktop-light, 1440x900, light scheme)
```

Backend (`HAGGLE_LLM` must not be "live"):
```
ruff check .
pytest backend/tests -q --ignore=backend/tests/test_db.py   # expect 285 passed
```

## Trace model

`src/lib/traceModel.ts` converts raw trace entries into a grouped timeline model
(turns → steps → terminal). Pure function, unit-tested against `run-deal.json`,
`run-deal-finished.json`, and `run-rejected.json`.

## Price ladder

`src/lib/series.ts` builds offer/ask series from trace entries (execute + ingest nodes),
not from `our_offers`/`seller_prices`. `PriceLadder` renders a hand-written SVG with
direct labels, draw-in animation, and a visually-hidden data table.
