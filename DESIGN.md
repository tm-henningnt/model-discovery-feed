# Design

Visual system for the Model Discovery Feed site. The register is `brand` (see PRODUCT.md): the surface should read like a precise, well-typeset technical standard an engineer trusts on sight — an instrument panel, not a brochure. Color and motion are restrained; typography and structure carry the credibility.

## Theme

Light is the default (evaluators skim in daylight, reading docs and scanning data). A dark theme is supported via `prefers-color-scheme` and a manual toggle. Both are pure-neutral bases — never cream, never tinted "warm" — so the one committed brand color does the talking.

Scene sentence: *an engineer at a desk, daytime, skeptically skimming this repo to judge whether the standard is serious.*

## Color

OKLCH throughout. Strategy: **restrained** — pure-neutral surfaces + one committed emerald that carries brand identity **and** doubles as the positive/"free"/"available" status. A small semantic ramp (amber = caution, red = negative) exists only because the feed data genuinely needs status color. Deliberately avoids the sage-on-cream, AI-purple, and corporate-navy attractors.

### Light (`:root`)

```
--bg:            oklch(1 0 0);          /* pure white — no hidden warmth */
--surface:       oklch(0.976 0 0);      /* panels, cards, table header */
--surface-2:     oklch(0.955 0 0);      /* insets, code blocks */
--border:        oklch(0.905 0 0);      /* hairlines */
--border-strong: oklch(0.83 0 0);

--ink:    oklch(0.23 0.008 165);        /* body/heading — ~13:1 on bg */
--ink-2:  oklch(0.36 0.01 165);         /* secondary headings */
--muted:  oklch(0.505 0.012 165);       /* secondary text — ≥4.5:1 */
--faint:  oklch(0.63 0.01 165);         /* meta, disabled — large text only */

--brand:     oklch(0.53 0.135 158);     /* emerald — fills, marks */
--brand-ink: oklch(0.45 0.14 158);      /* emerald text/links on light — ≥4.5:1 */
--brand-bg:  oklch(0.955 0.032 158);    /* tinted badge/callout background */
--brand-border: oklch(0.88 0.05 158);

--warn:     oklch(0.72 0.15 74);  --warn-ink: oklch(0.47 0.10 66);  --warn-bg: oklch(0.955 0.055 80);
--bad:      oklch(0.55 0.19 27);  --bad-ink:  oklch(0.47 0.18 27);  --bad-bg:  oklch(0.955 0.04 27);
```

### Dark (`:root[data-theme="dark"]`, `@media (prefers-color-scheme: dark)`)

```
--bg:            oklch(0.165 0.006 165);
--surface:       oklch(0.205 0.007 165);
--surface-2:     oklch(0.245 0.008 165);
--border:        oklch(0.30 0.008 165);
--border-strong: oklch(0.40 0.01 165);

--ink:    oklch(0.95 0.005 165);
--ink-2:  oklch(0.86 0.006 165);
--muted:  oklch(0.70 0.012 165);
--faint:  oklch(0.58 0.01 165);

--brand:     oklch(0.74 0.145 160);
--brand-ink: oklch(0.82 0.13 160);
--brand-bg:  oklch(0.27 0.055 160);
--brand-border: oklch(0.38 0.07 160);

--warn: oklch(0.80 0.14 78);  --warn-ink: oklch(0.85 0.12 80);  --warn-bg: oklch(0.30 0.05 70);
--bad:  oklch(0.68 0.18 28);  --bad-ink:  oklch(0.78 0.15 28);  --bad-bg:  oklch(0.30 0.06 28);
```

### Rules

- Text on any filled emerald/amber/red surface is white (`--bg` in light). Dark ink only on the pale `*-bg` tints.
- Status → color: `available`/`free`/`free_tier` = emerald; `limited`/`degraded`/`trial`/`subscription_included` = amber; `deprecated`/`retired`/`blocked` = red; `paid`/`unknown`/`local` = neutral (border + muted).
- Never gray-on-tint body text; body copy is `--ink`.

## Typography

Two families, contrasting axes (grotesque sans + monospace data), never two similar sans.

- **Sans — Archivo** (`next/font/google`, weights 400/500/600/700/800): all UI, headings, prose. Sturdy, mechanical grotesque; reads precise/institutional without costume. Big headings use 700–800 with tight tracking.
- **Mono — JetBrains Mono** (400/500/600): model IDs, endpoints, JSON/code, numeric table cells, kbd. Justified — it carries real monospace data (`openrouter:qwen/qwen3-coder:free`), not decoration.

Scale (fluid, ≥1.25 ratio):

```
--step-fluid-display: clamp(2.4rem, 1.5rem + 3.4vw, 3.75rem);  /* hero — under 6rem ceiling */
--step-3: clamp(1.6rem, 1.3rem + 1.1vw, 2.15rem);
--step-2: 1.5rem;  --step-1: 1.22rem;  --step-0: 1rem;  --step-sm: 0.875rem;  --step-xs: 0.78rem;
```

- Display/H1 letter-spacing −0.02 to −0.03em (never below −0.04em). `text-wrap: balance` on h1–h3; `text-wrap: pretty` on prose.
- Body line-height 1.6; prose measure capped at ~72ch. Dark mode adds +0.05 line-height.

## Layout

- Max content width ~1120px (`--w-page`); prose column ~72ch; explorer uses full page width.
- Document-like, left-aligned masthead rather than a centered hero-over-three-cards. Asymmetry and ruled structure over decoration.
- Spacing scale (rem): 0.25 / 0.5 / 0.75 / 1 / 1.5 / 2 / 3 / 4 / 6, applied with `clamp()` for section rhythm. Vary generous section gaps against tight groupings.
- Radii small and precise: `--r-1: 4px`, `--r-2: 7px`, `--r-3: 11px`. Status chips are the only pills.
- Prefer hairline `--border` separators over shadows. Elevation reserved for the explorer detail panel and dropdowns: soft, low shadow only.
- z-index scale: dropdown 100 · sticky-header 200 · drawer-backdrop 300 · drawer 310 · toast 400.

## Components

- **Header**: sticky, hairline bottom border, `--bg`/blur-free solid. Wordmark (emerald square mark + "Model Discovery Feed"), nav (Overview / Explore / Docs), theme toggle, GitHub link. `schema_version 1.0.0` chip.
- **Buttons**: primary = filled emerald, white text; secondary = `--ink` outline on `--bg`; ghost = text. 1px borders, `--r-2`, focus-visible ring in `--brand`.
- **Status chip**: small mono-uppercase pill using the semantic ramp `*-bg` + `*-ink`.
- **Data table** (explorer): dense rows, sticky header on `--surface`, hairline row separators, mono for IDs/numbers, right-aligned numerics. Row hover tint; click opens detail.
- **Filter controls**: labeled checkboxes/toggles/selects grouped in a left rail (desktop) / collapsible sheet (mobile). Active filters shown as removable chips above results.
- **Specimen/code panel**: `--surface-2` inset, mono, subtle window chrome, copy affordance.
- **Prose** (`.prose`): docs rendering — headings in Archivo, code/pre in JetBrains Mono on `--surface-2`, GFM tables with hairline borders, emerald links.

## Motion

- Ease-out only (`cubic-bezier(0.22, 1, 0.36, 1)`), 150–420ms. No bounce/elastic.
- One orchestrated first-load on the landing masthead: short staggered fade + 8px rise. Explorer/docs are utilitarian — hover/focus transitions and drawer slide only, no scroll-reveal reflex.
- Every animation has a `@media (prefers-reduced-motion: reduce)` path: instant/opacity-only. Content is visible by default; reveals only enhance.

## Accessibility

No formal target, held to sensible baselines: body ≥4.5:1, large text ≥3:1, visible focus rings, full keyboard operation (menus, drawer, table rows), semantic landmarks, and status never conveyed by color alone (chip carries a text label too).
