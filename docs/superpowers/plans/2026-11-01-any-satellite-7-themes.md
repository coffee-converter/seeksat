# Light, Dark and Auto Themes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SeekSat gets three theme modes, Auto, Light and Dark. Auto follows the system setting and is the default. The choice is remembered on the device, and pages never flash the wrong theme on load.

**Architecture:**
- **One attribute:** `<html data-theme="light|dark">` is resolved before first paint by a tiny inline script, from the saved choice and `prefers-color-scheme`.
- **Colour tokens:** every page colour is a CSS custom property defined once per theme.
- **Canvas map:** it takes a palette object chosen from the resolved theme and redraws when the theme changes.
- **Charts stay dark:** the sky chart and radio chart keep their dark look in both themes. They are night-sky instruments, and their look is protected by the spec.

**Tech Stack:** CSS custom properties, a `matchMedia` listener, Next.js 15 App Router layout, canvas 2D, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-30-any-satellite-tracker-design.md`. Anti-goal: "Losing the look of the existing polar sky chart and radio chart". This was added by Aaron on 2026-11-01: "i want to make sure we have dark light auto modes". Plans 1 to 6 are done.

## Global Constraints

- **Modes:** `auto` (default), `light`, `dark`. They are saved in localStorage under `seeksat.theme`; any other value means `auto`. Every storage access is wrapped in try/catch.
- **No flash:** the resolved theme is on `<html>` before first paint, so there is no light flash in dark mode and no dark flash in light mode. `suppressHydrationWarning` goes on `<html>` only.
- **Contrast:** body text and values meet WCAG AA, 4.5:1, against their background in both themes. Muted notes are at least 3:1.
- **Charts:** the sky chart modal, radio chart modal and pass-card polar plots look exactly as they do today, in both themes.
- **Satellite colours:** each satellite keeps its identity across themes (same hue order). Light mode may use deeper shades of the same hues so dots and tracks are readable on a light map.
- **CSP:** unchanged. The inline script is allowed by the existing `script-src 'unsafe-inline'`.
- **Copy:** plain language, no em dashes. Toggle labels are exactly `Auto`, `Light` and `Dark`.
- **Tests and commits:** `npm test`, `npx tsc --noEmit`. Conventional commit prefixes, no AI attribution lines.

## Review Focus

1. **First load in each mode** (auto with system light, auto with system dark, forced light, forced dark): no flash and no hydration warning. Pinned in Task 1 (script test and screenshot check).
2. **The system switching while the page is open in Auto:** the page and the map follow at once. In Light or Dark they don't. Pinned in Task 1 (the `resolveTheme` listener test) and Task 3.
3. **Missed hard-coded colours** that stay dark-on-light or vanish in light mode. Pinned in Task 2 by a CSS scan test.
4. **Map readability in light mode:** land against ocean, night shading, footprints, labels and satellite tracks. Pinned in Task 3 by screenshots at 1440 and 390 in both themes.
5. **Chart modals opened in light mode** stay dark and legible, with their own dark backdrop. Pinned in Task 2 (the scan test excludes the chart rules; screenshot check).

---

### Task 1: Theme mechanism and toggle

**Files:**
- Create: `lib/ui/theme.mjs`, `test/ui-theme.test.mjs`, `components/ThemeToggle.tsx`
- Modify: `app/layout.tsx`, `components/MapShell.tsx` (toggle in the top bar), `components/home/HomeApp.tsx` and `components/sat/SatApp.tsx` (if the top bar is built there)

**Interfaces:**
- `lib/ui/theme.mjs`:
  - `THEME_KEY = 'seeksat.theme'`, `MODES = ['auto', 'light', 'dark']`
  - `parseMode(raw) -> 'auto' | 'light' | 'dark'`
  - `resolveTheme(mode, systemPrefersDark) -> 'light' | 'dark'`
  - `readMode(storage = globalThis.localStorage)` / `writeMode(mode, storage)`, both non-throwing
  - `applyTheme(doc, theme)` sets `doc.documentElement.dataset.theme` and the `<meta name="theme-color">` content: `#0a0e1a` for dark, `#f5f7fb` for light
  - `THEME_SCRIPT`: a minified string of the pre-paint script, built from the same rules. It reads storage and `matchMedia('(prefers-color-scheme: dark)')`, sets `data-theme`, and catches every error, defaulting to dark.
- `app/layout.tsx`:
  - `<html lang="en" suppressHydrationWarning>`
  - `<head>` gets `<script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />` before any stylesheet link
  - `viewport.themeColor` becomes `[{ media: '(prefers-color-scheme: dark)', color: '#0a0e1a' }, { media: '(prefers-color-scheme: light)', color: '#f5f7fb' }]`
- `ThemeToggle`:
  - A three-way segmented control, `role="radiogroup"` with an `aria-label` of `"Theme"`, containing the options `Auto`, `Light` and `Dark`, sized compactly to fit the top bar on a 360 px phone. On narrow screens it may collapse to a single button that cycles through the three and shows the current mode's name.
  - On change: `writeMode`, `applyTheme`, and an event `seeksat:theme` on `window` with the resolved theme in `detail`.
  - In `auto` it listens to the `matchMedia` change and does the same.
  - It reads the mode only after mount, rendering a neutral placeholder of the same size until then.
  - It also appears in the satellite page top bar.

- [ ] **Step 1: Write the failing tests:**
  - `parseMode` handles junk, null and every valid mode.
  - `resolveTheme` covers all 6 combinations.
  - `readMode`/`writeMode` survive a throwing storage.
  - **`THEME_SCRIPT` evaluated in a fake `document`/`localStorage`/`matchMedia` sandbox** (`new Function`) sets the expected `data-theme` for:
    - saved `light` with system dark → light;
    - saved `dark` with system light → dark;
    - nothing saved with system light → light;
    - a throwing storage → dark.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS, clean.
- [ ] **Step 5: Commit** with `git commit -m "feat: Add auto, light and dark theme modes with a no-flash start"`.

---

### Task 2: Colour tokens for every page

**Files:**
- Modify: `app/globals.css`, `app/home.css`, `app/sat.css`, `app/mcp/mcp.css`
- Create: `test/theme-css.test.mjs`

**Interfaces:**
- **Tokens** are defined in `app/globals.css` under `:root[data-theme='dark']` (today's values) and `:root[data-theme='light']`, with `:root` defaulting to the dark values.
  - **Minimum set:** `--bg`, `--panel`, `--panel-2`, `--border`, `--text`, `--text-strong`, `--muted`, `--accent`, `--accent-strong`, `--danger`, `--warn`, `--ok`, `--focus-ring`, `--shadow`, `--chip-bg`, `--chip-border`, `--input-bg`, `--input-border`, and the `--map-*` set the map chrome and legend already use.
  - **Light values:** use a cool, slightly blue-grey paper look:
    - `--bg #f5f7fb`, `--panel #ffffff`, `--panel-2 #eef2f8`
    - `--border rgba(15, 30, 60, 0.12)`
    - `--text #1b2333`, `--text-strong #0b1220`, `--muted #5b6780`
    - `--accent #1f5fbf`
  - Tune the rest for AA contrast.
- Every colour in `app/home.css`, `app/sat.css`, `app/mcp/mcp.css` and `app/globals.css` uses a token. The exception is the chart block: the rules for `.polar-modal*`, `.radio-modal*`, `.radio-*`, `.pass-card__plot`, `.polar-plot*` and the PNG export frames. These keep their literal dark colours and set their own dark background, so they look identical in both themes.
- The flash (`@keyframes tick`), the LIVE dot and the badges use tokens with theme-specific values.
- **`test/theme-css.test.mjs`:**
  - Strip comments. Outside the chart block and the token definitions, there are no hex or `rgb(a)` literals except `transparent` and `currentColor`.
  - **Contrast** is computed from the token values in both themes:
    - `--text` on `--bg` and `--panel` ≥ 4.5;
    - `--muted` on `--panel` ≥ 3;
    - `--accent` on `--panel` ≥ 4.5.
  - Implement relative luminance in the test.

- [ ] **Step 1: Write the failing test.** **Step 2: Run.** Expected: FAIL, listing the literal colours.
- [ ] **Step 3: Convert** the stylesheets to tokens and add the light values.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat: Move page colours to theme tokens with a light palette"`.

---

### Task 3: Map canvas in both themes, and a screenshot check

**Files:**
- Modify: `lib/map/draw.mjs`, `lib/map/labels.mjs` (only if it holds colours), `components/home/FlatMap.tsx`, `components/sat/OrbitDiagram.tsx`, `test/map-draw.test.mjs`, `lib/map/legend.mjs` / `app/home.css` legend swatches as needed

**Interfaces:**
- `MAP_PALETTES = { dark: {...today's MAP_COLORS and label colours...}, light: {...} }` and `SAT_PALETTES = { dark: SAT_PALETTE, light: [...] }`. The light satellite colours are the same 8 hues, deepened for a light map:
  `['#d9622b', '#0f9f87', '#8b3fd9', '#b58a00', '#d6403f', '#139a63', '#6d4fd8', '#d16a12']`.
- **Light map palette:**
  - `ocean #dfe8f3`, `land #f7f4ec`, `landStroke #c9c2b0`
  - `graticule rgba(31, 95, 191, 0.14)`
  - `night rgba(20, 30, 60, 0.10)`
  - `observer #1f5fbf`
  - label colours: text `rgba(27, 35, 51, 0.75)`, regions `rgba(27, 35, 51, 0.40)`, graticule labels `rgba(27, 35, 51, 0.60)`
  - halos use the ocean colour
- `drawMap(ctx, { ..., palette = MAP_PALETTES.dark })` takes the palette, and every colour in `draw.mjs` comes from it.
- Satellite colours are picked by index from the theme's satellite palette. The chip and legend colours use the same theme palette.
- **FlatMap:** reads the resolved theme from `document.documentElement.dataset.theme` after mount and on the `seeksat:theme` event, then redraws.
- **OrbitDiagram:** its SVG colours (Earth, ellipse, labels) use CSS tokens.
- **Test:** `drawMap` with the light palette fills the ocean with `#dfe8f3`, and no stroke or fill in the light run uses a dark-palette colour.
- **Screenshot check:**
  - Run `npx next dev -p 3457`. It reads the stored snapshot, never CelesTrak; on a transient "Maximum call stack size exceeded", retry.
  - Use Playwright through the system Chrome channel with `colorScheme` set per context.
  - Capture `/` and `/sat/25544` at 1440×900 and 390×844, in light, dark and auto with system light. Also capture a sky chart modal opened in light mode.
  - View them, fix contrast or legibility problems, and repeat.
  - Report the image paths.

- [ ] **Step 1: Write the failing draw test.** **Step 2: Run.** Expected: FAIL. **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` and `npm run build`. Expected: PASS, clean, and the build succeeds. Then do the screenshot check.
- [ ] **Step 5: Commit** with `git commit -m "feat: Draw the map in light and dark palettes"`.
