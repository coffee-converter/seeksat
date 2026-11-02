# Slate Look and Night Vision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle SeekSat to the approved "Slate" look, with a clear control hierarchy and calmer layout, and add a Night vision toggle that renders the whole app in dim reds.

**Architecture:**
- **Slate** is a token and CSS pass: new values in `app/globals.css`, control styles in `app/home.css` and `app/sat.css`. No component logic changes, except class names where a control needs its tier.
- **Night vision:**
  - a second saved preference in `lib/ui/theme.mjs`, applied by the pre-paint script as `<html data-night>`;
  - a root-element CSS filter;
  - a toggle button next to `ThemeToggle`.

**Tech Stack:** Next.js 15, CSS custom properties, `node --test`, Playwright (system Chrome).

**Spec:** `docs/superpowers/specs/2026-11-02-slate-and-night-vision-design.md`. Its reference mock (the "2. Slate" and "3. Night vision" panels) is the visual target: open it and match it.

## Global Constraints

- **Contrast:** AA for body text (4.5:1), and 3:1 for large text and control boundaries, in both themes.
- **Colour tokens:**
  - Colours live in tokens; `test/theme-css.test.mjs` enforces this.
  - `SAT_PALETTES` and the map basemaps are unchanged.
- **Copy:** plain language, no em dashes.
- **Print:** unchanged.
- **Scope:** no new fonts or network origins. Never call CelesTrak.
- **Tests and commits:** `npm test` and `npx tsc --noEmit`. Conventional commits, with no AI attribution lines.

## Review Focus

1. **Every page and dialog:**
   - home;
   - satellite page;
   - live view;
   - sky and radio chart modals;
   - not-found pages;
   - the MCP/about bits.

   None of them may keep a stray old blue literal, or lose contrast, in either theme. Checked in Tasks 1 and 3.
2. **Night vision across a reload:** no white or blue flash before first paint. Pinned in Task 2 (the pre-paint script test) and checked in Task 3.
3. **Fixed-position UI under the filter:** dialogs, the live view and the full-screen map stay pinned to the viewport. Checked in Task 3.
4. **Toggle independence:** turning Night vision off restores the saved Auto/Light/Dark mode exactly. Pinned in Task 2.
5. **Phones at 360 px:** the header fits the theme control and the Night vision icon without wrapping or horizontal scroll. Checked in Task 3.

---

### Task 1: Slate tokens, control hierarchy and calmer layout

**Files:**
- Modify:
  - `app/globals.css` (tokens for both themes);
  - `app/home.css` and `app/sat.css` (controls, headings, badges, spacing);
  - any component that needs a tier class (`home-button--primary` already exists; add `--secondary` or `--quiet` where needed);
  - `lib/ui/theme.mjs` (`COLOR` theme-color values);
  - `test/theme-css.test.mjs` (contrast checks for the new tokens).

**Token values:** take them from the mock's `.slate.dark` and `.slate.light` blocks:
- `--bg`, `--panel`/card, `--line`/border, `--text`, `--muted`, `--heading`, `--brand`;
- `--well` and `--well-line` for inputs, toggles and menus;
- `--primary`, `--primary-text`, `--btn-line` and `--link`.

Map them onto the app's existing token names (`--bg`, `--panel`, `--border`, `--text`, `--muted`, `--accent`, `--input-bg`, `--input-border`, `--chip-bg`, `--tile-bg` and so on). Keep `--ok`, `--warn` and `--danger` as they are unless contrast requires otherwise.

**Control tiers** (the spec's table):
- `.home-button--primary` and the Live chip are filled with the brand blue.
- Ordinary `.home-button` and `.home-chip` get a neutral outline (`--btn-line`).
- `.home-chip--quiet` and More/Unfollow are text-only and muted.
- Pressed toggles (`aria-pressed=true`, `.home-chip--on`) and segmented groups use a well with the selected segment filled. This applies to Radio/Visual and to `ThemeToggle`.
- Selects (`.flat-map__menu`, the radio frequency select) are input-style: well background and an inset chevron.

**Calmer layout:**
- **Headings:** `.home-heading`, `.up-now__title` and the satellite-page section headings become sentence case, with no letter-spacing, at about 15 to 16 px weight 650, in `--text-heading`. Change CSS only; the source text is already sentence case where it renders uppercase via CSS.
- **Spacing:** about 20 to 24 px between sections in the panel.
- **Badges:** the quality and cloud badges lose their pill border and become a coloured word. Good gets a small dot, as in the mock.
- **Borders:** remove nested borders inside cards where a background difference already separates them.

- [ ] **Step 1: Write the failing tests** in `test/theme-css.test.mjs`:
  - **`slate tokens are neutral`:** in both themes, `--panel`, `--input-bg` and `--border` each have chroma under a small threshold, OKLCH C < 0.04, so they are no longer blue-tinted.
  - **`text contrast`:** `--text` on `--bg`, `--text` on `--panel`, and `--muted` on `--panel` are each at least 4.5:1, in both themes.
  - **`primary button contrast`:** `--primary-text` on the primary fill is at least 4.5:1.
- [ ] **Step 2: Run** `node --test test/theme-css.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the tokens and CSS.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` and `npm run build`. Expected: PASS, clean, and the build succeeds.
- [ ] **Step 5: Do the screenshot check.** Capture `/` and `/sat/25544` at 390 and 1440 px, in light and dark. Open the sky chart and the live view. Compare against the mock and fix anything off.
- [ ] **Step 6: Commit** with `style: Restyle SeekSat in the Slate look with clear control tiers`.

---

### Task 2: Night vision preference and pre-paint

**Files:**
- Modify: `lib/ui/theme.mjs`, `test/ui-theme.test.mjs` (or the existing theme test; find it).
- Create: nothing else.

**Interfaces** (all in `lib/ui/theme.mjs`):
- **`NIGHT_KEY = 'seeksat.night'`.**
- **`readNight(storage) -> boolean`:** `'1'` is true; anything else, or an error, is false.
- **`writeNight(on, storage)`:** sets `'1'` or removes the key, swallowing errors.
- **`resolveTheme(mode, systemPrefersDark, night = false)`:** `'dark'` when `night`; otherwise unchanged.
- **`applyTheme(doc, theme, night = false)`:**
  - sets `data-theme`;
  - sets or removes `data-night="1"` on `<html>`;
  - sets the theme-color meta to `#1a0505` when night.
- **`syncTheme`:** also reads `readNight`.
- **`THEME_SCRIPT`:** also reads `NIGHT_KEY`. When it is `'1'`, the theme is forced to dark and `data-night="1"` is set, before first paint.

- [ ] **Step 1: Write the failing tests:**
  - `resolveTheme('light', false, true)` gives `'dark'`.
  - `resolveTheme('light', false, false)` gives `'light'`.
  - **`readNight` and `writeNight` round-trip** on a fake storage, and a throwing storage gives false with no throw.
  - **`applyTheme(fakeDoc, 'dark', true)`** sets `dataset.night = '1'` and meta content `#1a0505`. With `night` false it removes `dataset.night`.
  - **`THEME_SCRIPT` evaluated** (`new Function`) with a fake `document`, `localStorage` (`seeksat.theme = 'light'`, `seeksat.night = '1'`) and `matchMedia`: `data-theme` becomes `'dark'` and `data-night` becomes `'1'`.
- [ ] **Step 2: Run** the theme test file. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS, clean.
- [ ] **Step 5: Commit** with `feat: Add a night vision preference that applies before first paint`.

---

### Task 3: Night vision toggle and rendering

**Files:**
- Create: `components/NightToggle.tsx`
- Modify:
  - `components/ThemeToggle.tsx`, or wherever the header renders it (place `NightToggle` beside it on home, satellite pages and anywhere else `ThemeToggle` appears);
  - `components/ThemeSync.tsx` (respect night);
  - `app/globals.css` (the night filter);
  - `components/home/FlatMap.tsx`, only if the map must read night to stay on the dark basemap. With `data-theme` forced to dark it already will.

**Interfaces:**
- **`<NightToggle />`:**
  - A button with `aria-pressed`, the visible text `Night vision`, and under 480 px an icon-only form with `aria-label="Night vision"` and a simple eye or moon SVG.
  - On click it flips `writeNight`, re-applies the theme through `applyTheme(document, resolveTheme(mode, systemDark, night), night)`, and fires the existing `seeksat:theme` event so the map swaps style.
  - It is pressed while night is on. While night is on, `ThemeToggle` shows its saved mode as usual. Turning night off restores that mode's resolved theme.
- **CSS:** `html[data-night="1"] { filter: … }`.
  - Choose the filter so that sampled pixels meet the spec target: green and blue each at most about 0.35 × red, and white text no brighter than about 70%. A good starting point is `grayscale(1) sepia(1) saturate(6) hue-rotate(-45deg) brightness(0.7)`; tune by eye and by pixel samples.
  - Also set `html[data-night="1"] { background: #0a0303; }` so overscroll is red-black.

- [ ] **Step 1: Implement** the toggle, the placement, the ThemeSync change and the CSS.
- [ ] **Step 2: Run** `npm test`, `npx tsc --noEmit` and `npm run build`. Expected: PASS, clean, and the build succeeds.
- [ ] **Step 3: Do the screenshot check** with `npx next start -p 3461` and Playwright.
  - **Turning it on:** with Night vision on, capture `/` and `/sat/25544` at 390 and 1440 px.
  - **Pixel check:** sample 200 random pixels from each screenshot, read with a PNG decoder or the `pngjs` package if present; otherwise use canvas in the page. Report the worst green/red and blue/red ratios; at most about 0.35.
  - **Reload:** reload with night saved, and confirm no non-red first frame (take a screenshot on `domcontentloaded`).
  - **Fixed UI:** open the sky chart, the live view and the full-screen map. Each stays pinned to the viewport while the page is scrolled.
  - **Turning it off:** the earlier mode (for example Light) comes back exactly.
  - **360 px header:** fits with no horizontal scroll.
- [ ] **Step 4: Commit** with `feat: Add a night vision toggle that turns the whole app dim red`.
