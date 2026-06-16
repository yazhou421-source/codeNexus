# Renderer Theme Color System

Theme colors are centralized in layered CSS variable files. Edit the earliest layer that matches the kind of change you need.

## Layers

1. `theme-seeds.css`
   - Edit this file for brand, accent, background, surface, text, border source, and state seed colors.
   - Theme palettes live here under selectors such as `:root[data-theme="light"]`, `:root[data-theme="dark"]`, and `:root[data-theme="tech"]`.
   - Raw `rgb(...)` values belong here.

2. `tokens.css`
   - Derives global semantic tokens such as `--bg`, `--surface-1`, `--text`, `--border`, `--accent`, `--success`, `--warning`, and `--danger`.
   - Keep this layer generic. It should describe shared meaning, not a specific component.

3. `component-tokens.css`
   - Derives UI-specific tokens such as `--topbar-bg`, `--sidebar-bg`, `--center-bg`, `--composer-bg`, `--chat-pane-bg`, `--button-bg`, and `--card-bg`.
   - Put component color decisions here instead of in React components or layout CSS.

4. `app-themes.css`
   - Thin mount layer for applying token values to global regions.
   - Avoid adding new color definitions here unless they are theme mounting rules.

## Theme Registry

Renderer theme ids, labels, tone metadata, and cycling order live in `src/renderer/stores/theme.store.ts`:

- Add a new theme id to `AppThemeName`.
- Add a matching entry to `APP_THEME_DEFINITIONS`.
- Add seed values in `theme-seeds.css` under `:root[data-theme="<id>"]`.
- Prefer `tone: "light" | "dark"` for broad component behavior instead of writing one-off selectors for every theme.

## Token Contract

- Seed tokens define raw palette values only.
- Global semantic tokens define meaning shared across the product, such as `--accent`, `--surface-1`, `--fg-danger`.
- Component tokens define decisions for a UI region, such as `--composer-bg`, `--topbar-bg`, and `--chat-pane-bg`.
- React components should use semantic or component tokens, not raw color utilities such as hard-coded purple/white values.

## Tailwind

Use semantic Tailwind aliases from `tailwind.config.cjs` when utility classes need theme colors:

- `ui-bg`
- `ui-surface`
- `ui-surface-2`
- `ui-muted`
- `ui-border`
- `ui-accent`
- `ui-success`
- `ui-warning`
- `ui-danger`

## Raw Color Rule

Avoid raw `#hex`, `rgb(...)`, and `rgba(...)` values outside seed files. Use CSS variables, `color-mix(...)`, or `rgb(from var(...) ...)` instead.

Documented exceptions should be algorithmic, third-party-like, or test-only code. Add an automated guard before relying on this rule for CI enforcement.
