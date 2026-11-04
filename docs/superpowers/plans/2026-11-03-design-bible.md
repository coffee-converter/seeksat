# Design Bible Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One source of truth for SeekSat's type, scales, colours and UI components, with Atkinson Hyperlegible Next site-wide and a live reference page at an unlisted URL.

**Architecture:** Tokens stay in the `theme-tokens` block of `app/globals.css`, extended with theme-independent scales and a `.theme-dark` scope. Map colours that CSS and JS both need are generated from the JS map modules into an inline `<style>` at render time. A `components/ui/` library (styles in `app/ui.css`, class builders in `lib/ui/classes.mjs`) replaces per-screen buttons, toggles, badges, modals, fields and disclosures. Guard tests in `test/theme-css.test.mjs` and `test/ui-library.test.mjs` fail on new one-off values and on screens restyling components.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript plus `.mjs` pure modules, plain global CSS (BEM), `next/font`, node:test, MapLibre.

**Spec:** `docs/superpowers/specs/2026-11-03-design-bible-design.md`

## Global Constraints

- Branch `develop`. Conventional commit prefixes (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`).
- Font: Atkinson Hyperlegible Next for all text and numbers; `--font-num` points at it; Exo 2 stays for the wordmark only.
- Weights 400, 500, 600 only (wordmark excepted).
- Type scale px: 11, 12, 13, 15, 18, 24, plus one container-scaled hero step. Base 13 (may move the whole scale +1 px after Task 4's screenshots; ratios kept).
- Spacing px: 2, 4, 6, 8, 12, 16, 24, 32. Radii: 4, 6, 8, 12, full. Motion: 120 ms, 200 ms, 300 ms, one easing; none under `prefers-reduced-motion`.
- No visual redesign: same Slate colours, layouts and behaviour. Only the font and small snaps to the scales change.
- Plain global CSS with BEM. No CSS framework, CSS-in-JS or CSS modules. No new runtime dependencies.
- Triangulate (`components/triangulate/`, `components/TriangulateApp.tsx`) is out of scope.
- Fonts are same-origin (CSP `font-src 'self' data:` in `lib/site/csp.mjs` stays as is).
- Chart modals stay always dark; only the chart graphics keep literal colours.
- Reference page: `/design-27b284ec240e9ac9`, `robots: { index: false, follow: false }`, `X-Robots-Tag: noindex, nofollow`, not in `app/sitemap.ts`, not in `app/robots.ts`, not linked from anywhere.
- Accessibility stays: focus rings (`--focus-ring`), 3:1 input edges, 44 px tap targets on phones, focus traps in dialogs, labelled icon buttons.
- `npm test` and `npx tsc --noEmit` pass at the end of every task.

## Review Focus

1. Night vision: every new component and the reference page must be covered by the root filter; nothing sets its own `filter` or a colour outside the tokens. Expect a dim red UI with no green or blue leaks.
2. Chart modals in light theme: after moving to the library they must still render dark (the `.theme-dark` scope), including buttons, the frequency select and phone tiles. Expect identical darkness in light and dark page themes.
3. Print sheet: Atkinson and the new scales must not break the print block's pt sizes or page breaks. Expect the same one-sheet layout.
4. Ticking numbers (countdowns, live az/el, the Doppler-corrected frequency): with a proportional font they jitter unless `tabular-nums` is applied. Expect no horizontal wobble while a countdown runs.
5. Keyboard on the new Segmented and Modal: arrow keys move within a radiogroup, Escape closes a modal and focus returns to the opener. Expect the same keyboard behaviour as today's best implementation.

Tests pinning these are in Tasks 2 (`.theme-dark`), 4 (`num` class on the ticking readouts), 6 (Segmented keys), 7 (Modal tone) and 8 (no `filter` outside the night rule). The print sheet is checked by the Task 9 and Task 13 screenshots against baseline.

---

### Task 1: Baseline screenshots and move triangulate CSS out of globals

The screenshot rig is used by every later migration task. Triangulate's legacy rules (lines ~198-590 of `app/globals.css`: `#cesium-container`, `.panel*`, `#panel-*`, `#attempt-*`, `#tle-section`, `.obs-card*`, `.obs-row`, `.field*`, `.footnote`, `.result-block`, `#camera-controls`, `#sim-time`, `#imagery-*`, `.picker-label`, `.timestamp-row`, `.hint`, `.opt-row`, `#obs-list`, `.color-swatch`) would otherwise fail every guard.

**Files:**
- Create: `.superpowers/shots/package.json`, `.superpowers/shots/screens.mjs` (gitignored, local only)
- Create: `components/triangulate/triangulate.css`
- Modify: `app/globals.css`, `components/TriangulateApp.tsx` (import the new CSS)
- Test: `test/theme-css.test.mjs`

**Interfaces:**
- Produces: `node .superpowers/shots/screens.mjs <outDir> [baseUrl]` writes PNGs named `<page>-<theme>-<width>.png` for pages `home`, `sat`, `sky-chart`, `radio-chart`, `live`, `print`, themes `light`, `dark`, `night`, widths `360`, `1280`.

- [ ] **Step 1: Build the screenshot rig.** `.superpowers/shots/package.json` with `playwright` as its only dependency; `npm i && npx playwright install chromium` in that folder. `screens.mjs` seeds `localStorage['seeksat.home.v1']` (shape from `lib/home/prefs.mjs` `loadPrefs`: a location near 41.88, -87.63, following `[25544, 33591, 57166]`), sets `seeksat.theme` / `seeksat.night` per theme (keys from `lib/ui/theme.mjs`), opens `/` and `/sat/25544`, opens the sky chart, radio chart and live view from the first pass card, and emulates print media for the print shot.
- [ ] **Step 2: Capture the baseline.** `npm run build && npm start`, then `node .superpowers/shots/screens.mjs .superpowers/shots/baseline`. Expected: 36 PNGs. Look through them once to confirm each page loaded with data.
- [ ] **Step 3: Write the failing test** in `test/theme-css.test.mjs`:

```js
test('globals.css carries no triangulate rules', () => {
  const css = read('app/globals.css');
  for (const sel of ['#cesium-container', '#panel-observations', '#attempt-picker', '#tle-section', '.obs-card', '#camera-controls', '#imagery-select', '.result-block']) {
    assert.ok(!css.includes(sel), `${sel} moved to components/triangulate/triangulate.css`);
  }
});
```

- [ ] **Step 4: Run** `node --test test/theme-css.test.mjs`. Expected: FAIL naming `#cesium-container`.
- [ ] **Step 5: Move the rules.** Before moving each selector, grep `components/` and `app/` outside triangulate; a selector used by a shipped component (`.panel` in `MapShell.tsx` and `MoreToggle.tsx`, `.field` in `RadioChartModalView.tsx`, `.polar-plot` in the pass cards) stays in globals for now and is replaced by the library in Tasks 6-9. The polar-plot chart-block region stays in globals.
- [ ] **Step 6: Run** `npm test && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 7: Commit** `refactor: Move triangulate styles out of globals.css`.

### Task 2: Scale tokens and the `.theme-dark` scope

**Files:**
- Modify: `app/globals.css` (token block)
- Test: `test/theme-css.test.mjs`

**Interfaces:**
- Produces (all in a theme-independent `:root { }` block inside `theme-tokens`):
  - `--font-sans`, `--font-num`, `--font-brand`
  - `--fs-xs: 11px; --fs-sm: 12px; --fs-md: 13px; --fs-lg: 15px; --fs-xl: 18px; --fs-2xl: 24px; --fs-hero: min(40px, 9cqi);`
  - `--fw-regular: 400; --fw-medium: 500; --fw-semibold: 600;`
  - `--lh-tight: 1.2; --lh-body: 1.5;`
  - `--sp-2 … --sp-32` (2, 4, 6, 8, 12, 16, 24, 32 px)
  - `--radius-sm: 4px; --radius-md: 6px; --radius-lg: 8px; --radius-xl: 12px; --radius-full: 999px;`
  - `--line-subtle: 1px solid var(--border); --line-control: 1px solid var(--btn-line); --line-input: 1px solid var(--input-border);`
  - `--dur-fast: 120ms; --dur-base: 200ms; --dur-slow: 300ms; --ease: cubic-bezier(0.2, 0, 0, 1);`
- Produces (per theme): `--shadow-popover`, `--shadow-modal` (from today's `0 6px 20px var(--shadow-soft)` and `0 10px 28px var(--shadow)`).
- Produces: dark selector becomes `:root, :root[data-theme='dark'], .theme-dark` and also sets `color-scheme: dark` and `color: var(--text)` for `.theme-dark` subtrees.
- `@media (prefers-reduced-motion: reduce)` sets the three `--dur-*` to `0ms`.

- [ ] **Step 1: Write the failing tests:**

```js
test('scale tokens exist with the spec values', () => {
  const block = regions(read('app/globals.css'), TOKENS_BEGIN, TOKENS_END).join('\n');
  const want = { '--fs-xs': '11px', '--fs-sm': '12px', '--fs-md': '13px', '--fs-lg': '15px', '--fs-xl': '18px', '--fs-2xl': '24px',
    '--fw-regular': '400', '--fw-medium': '500', '--fw-semibold': '600',
    '--sp-2': '2px', '--sp-4': '4px', '--sp-6': '6px', '--sp-8': '8px', '--sp-12': '12px', '--sp-16': '16px', '--sp-24': '24px', '--sp-32': '32px',
    '--radius-sm': '4px', '--radius-md': '6px', '--radius-lg': '8px', '--radius-xl': '12px', '--radius-full': '999px',
    '--dur-fast': '120ms', '--dur-base': '200ms', '--dur-slow': '300ms' };
  for (const [k, v] of Object.entries(want)) assert.match(block, new RegExp(`${k}:\\s*${v};`), k);
  for (const k of ['--font-sans', '--font-num', '--font-brand', '--fs-hero', '--lh-tight', '--lh-body', '--ease', '--line-subtle', '--line-control', '--line-input']) assert.ok(block.includes(`${k}:`), k);
  assert.match(block, /prefers-reduced-motion:\s*reduce[\s\S]*--dur-fast:\s*0ms/);
});

test('.theme-dark gets the dark tokens in any page theme', () => {
  const block = stripComments(regions(read('app/globals.css'), TOKENS_BEGIN, TOKENS_END).join('\n'));
  assert.match(block, /:root,\s*:root\[data-theme='dark'\],\s*\.theme-dark\s*\{/);
  assert.ok(THEMES.dark['--shadow-modal'] && THEMES.light['--shadow-modal']);
});
```

- [ ] **Step 2: Run** `node --test test/theme-css.test.mjs`. Expected: FAIL on `--fs-xs`.
- [ ] **Step 3: Add the tokens.** `--font-sans` is `var(--font-atkinson), system-ui, -apple-system, 'Segoe UI', sans-serif` (the variable arrives in Task 3; until then the fallback renders). `--font-num: var(--font-sans)`. `--font-brand: 'Exo 2', system-ui, sans-serif`. Check `parseTokens` still separates light and dark (the new selector list still matches `data-theme='dark'`).
- [ ] **Step 4: Run** `npm test`. Expected: PASS, contrast tests unchanged.
- [ ] **Step 5: Commit** `feat: Add type, spacing, radius, motion and shadow tokens`.

### Task 3: Atkinson Hyperlegible Next, self-hosted

**Files:**
- Modify: `app/layout.tsx`, `app/globals.css` (`html, body` rule), `app/home.css`, `app/sat.css`, `app/mcp/mcp.css` (every `font-family`)
- Test: `test/theme-css.test.mjs`, `test/csp.test.mjs`

**Interfaces:**
- Produces: `<html className={atkinson.variable}>` where `atkinson = Atkinson_Hyperlegible_Next({ subsets: ["latin", "latin-ext"], weight: ["400", "500", "600"], variable: "--font-atkinson", display: "swap" })` from `next/font/google`.
- Produces: CSS class `.num { font-family: var(--font-num); font-variant-numeric: tabular-nums; }` in `app/globals.css` outside the token block.

- [ ] **Step 1: Write the failing tests:**

```js
test('font-family uses font tokens only (outside tokens, chart graphics and print)', () => {
  const found = FILES.flatMap((f) => declsIn(f, 'font-family').filter((d) => !/^(var\(--font-[\w-]+\)|inherit)$/.test(d.value)));
  assert.deepEqual(found.map((d) => d.where), []);
});
test('the root layout loads Atkinson Hyperlegible Next through next/font', () => {
  const src = read('app/layout.tsx');
  assert.match(src, /Atkinson_Hyperlegible_Next\s*\(/);
  assert.match(src, /variable:\s*"--font-atkinson"/);
  assert.doesNotMatch(src, /fonts\.googleapis\.com/);
});
```

Add the shared helper `declsIn(file, property) -> Array<{ where: string, value: string }>` next to `literalsIn`, built the same way (blank tokens, chart blocks, `@media print` blocks and comments; match declarations of `property`). Tasks 4, 5 and 8 reuse it.

- [ ] **Step 2: Run.** Expected: FAIL listing the system and mono stacks.
- [ ] **Step 3: Wire the font** in `app/layout.tsx` and set `html, body { font-family: var(--font-sans); }`. Replace every stack: sans stacks → `var(--font-sans)`, mono stacks → `var(--font-num)`, `'Exo 2', …` → `var(--font-brand)`.
- [ ] **Step 4: Check the glyphs.** In the built site, devtools "Rendered fonts" on text containing `°`, `·`, `−` (U+2212), `→`, `←` shows Atkinson Hyperlegible Next. If any falls back, switch to `next/font/local` with the variable TTF from `github.com/google/fonts/ofl/atkinsonhyperlegiblenext` in `app/fonts/` (OFL), keeping the same `variable`.
- [ ] **Step 5: Run** `npm test && npx tsc --noEmit`. Expected: PASS (`test/csp.test.mjs` unchanged: no new font origin).
- [ ] **Step 6: Commit** `feat: Use Atkinson Hyperlegible Next site-wide`.

### Task 4: Type scale and weights everywhere

**Files:**
- Modify: `app/globals.css`, `app/home.css`, `app/sat.css`, `app/mcp/mcp.css`, numeric components (`components/sat/StatTile.tsx`, `components/LiveClock.tsx`, `components/live/LiveView.tsx`, `components/live/LiveDial.tsx`, `components/home/NextUpList.tsx`, `components/home/NextStrip.tsx`, `components/home/UpNow.tsx`, `components/sat/LiveNumbers.tsx`, `components/sat/Downlinks.tsx`, `components/sat/ElementsTable.tsx`)
- Test: `test/theme-css.test.mjs`

**Interfaces:**
- Consumes: `--fs-*`, `--fw-*`, `--lh-*` (Task 2), `.num` (Task 3).

Mapping (round to nearest step; ties go down): 7, 9, 10, 10.5, 11 → `--fs-xs`; 12, 12.5 → `--fs-sm`; 13, 14 → `--fs-md`; 15, 16 → `--fs-lg`; 18, 20 → `--fs-xl`; 22, 24, 26, 28, 30 → `--fs-2xl`; every `min(Npx, Ncqi)` → `--fs-hero` except the wide stat tile and other `min(≤24px, …)` → `--fs-2xl`; `em` sizes stay (relative to a token). 650 and 700 → `--fw-semibold`; 500 → `--fw-medium`; 400 → `--fw-regular`. The wordmark rule keeps its literal weight with a `/* brand */` comment the guard allows.

- [ ] **Step 1: Write the failing test:**

```js
test('font-size and font-weight use tokens', () => {
  const ok = (v) => /^var\(--f[sw]-[\w-]+\)$/.test(v) || /^[\d.]+em$/.test(v) || v === 'inherit';
  const found = FILES.flatMap((f) => [...declsIn(f, 'font-size'), ...declsIn(f, 'font-weight')].filter((d) => !ok(d.value) && !d.brand));
  assert.deepEqual(found.map((d) => `${d.where}  ${d.value}`), []);
});
```

`declsIn` sets `brand: true` on a declaration whose line carries `/* brand */`.

Also add:

```js
test('ticking readouts use the numeric class', () => {
  for (const f of ['components/ui/StatTile.tsx', 'components/sat/StatTile.tsx', 'components/LiveClock.tsx', 'components/live/LiveView.tsx', 'components/home/NextUpList.tsx', 'components/home/UpNow.tsx']) {
    if (existsSync(new URL(`../${f}`, import.meta.url))) assert.match(read(f), /\bnum\b/, f);
  }
});
```

- [ ] **Step 2: Run.** Expected: FAIL with ~180 entries.
- [ ] **Step 3: Snap every value** per the mapping. Every element that shows a ticking or aligned number gets `className` `num` (or its rule composes `font-family: var(--font-num); font-variant-numeric: tabular-nums`).
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Screenshots.** `node .superpowers/shots/screens.mjs .superpowers/shots/t4`; compare with baseline. Decide the base: if body text reads clearly larger than before, keep 13; if Atkinson at 13 reads smaller or cramped on the 360 px shots, shift every `--fs-*` up 1 px and note it in Task 10's reference page.
- [ ] **Step 6: Commit** `refactor: Snap font sizes and weights to the type scale`.

### Task 5: Radius, shadow, motion and border tokens everywhere

**Files:**
- Modify: `app/globals.css`, `app/home.css`, `app/sat.css`, `app/mcp/mcp.css`
- Test: `test/theme-css.test.mjs`

Mapping: radius 1, 2, 3, 4, 5 → `--radius-sm`; 6, 7 → `--radius-md`; 8, 10 → `--radius-lg`; 12 → `--radius-xl`; 999px → `--radius-full`; `50%` and `0` stay; composite values (`0 8px 8px 0`) use tokens per corner. Transitions use `var(--dur-fast|base|slow) var(--ease)`: 0.12 s and 0.15 s → fast, 0.25 s → base. Shadows: drop shadows → `--shadow-popover` or `--shadow-modal`; inset outlines and rings (`inset 3px 0 0 var(--map-accent)`, `0 0 0 2px …`) stay as written since they are outlines, not elevation.

- [ ] **Step 1: Write the failing test:**

```js
test('radius, transition and drop shadow use tokens', () => {
  const radiusOk = (v) => v.split(/\s+/).every((p) => /^var\(--radius-[\w-]+\)$/.test(p) || p === '0' || p === '50%');
  const transOk = (v) => v === 'none' || v.split(',').every((p) => /var\(--dur-\w+\)/.test(p) && /var\(--ease\)/.test(p));
  const shadowOk = (v) => v === 'none' || /^var\(--shadow-(popover|modal)\)$/.test(v) || /^(inset |0 0 0 )/.test(v);
  const found = FILES.flatMap((f) => [
    ...declsIn(f, 'border-radius').filter((d) => !radiusOk(d.value)),
    ...declsIn(f, 'transition').filter((d) => !transOk(d.value)),
    ...declsIn(f, 'box-shadow').filter((d) => !shadowOk(d.value.replace(/\s*!important$/, ''))),
  ]);
  assert.deepEqual(found.map((d) => `${d.where}  ${d.value}`), []);
});
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Snap the values.** Borders written as `1px solid var(--border|--btn-line|--input-border)` become `var(--line-subtle|--line-control|--line-input)`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `refactor: Snap radius, shadow, motion and borders to tokens`.

### Task 6: UI library part 1: Button, Segmented, Badge, RatingBars

**Files:**
- Create: `lib/ui/classes.mjs`, `components/ui/Button.tsx`, `components/ui/Segmented.tsx`, `components/ui/Badge.tsx`, `components/ui/RatingBars.tsx`, `app/ui.css`
- Modify: `app/layout.tsx` (import `./ui.css` after `./globals.css`)
- Test: `test/ui-classes.test.mjs`

**Interfaces:**
- Produces in `lib/ui/classes.mjs`:
  - `cx(...parts: Array<string | false | null | undefined>): string`
  - `buttonClass({ variant = 'secondary', size = 'md', iconOnly = false, tone = 'default', done = false } = {}): string` → e.g. `"btn btn--primary btn--sm btn--icon btn--danger btn--done"` (only the modifiers that apply; `btn--secondary` and `btn--md` are omitted as defaults).
  - `badgeClass(tone = 'neutral'): string` → `"badge"` or `"badge badge--warn|danger|ok"`.
  - `segmentedNext(values: string[], current: string, key: string): string` → the value arrow keys move to (`ArrowRight`/`ArrowDown` next, `ArrowLeft`/`ArrowUp` previous, wrapping; `Home`/`End`; other keys return `current`). Disabled values are passed already filtered.
- Produces components:
  - `Button` (forwardRef `HTMLButtonElement`): `{ variant?: "primary" | "secondary" | "quiet"; size?: "md" | "sm"; tone?: "default" | "danger"; done?: boolean; pressed?: boolean } & ButtonHTMLAttributes`, `type` defaults to `"button"`, `pressed` sets `aria-pressed`. Icon-only form: `iconOnly: true` requires `aria-label` (TS union).
  - `Segmented<T extends string>`: `{ label: string; options: { value: T; label: string; disabled?: boolean }[]; value: T; onChange: (v: T) => void; size?: "md" | "sm" }`; renders `role="radiogroup"` with `role="radio"` buttons, roving tabindex, keys via `segmentedNext`.
  - `Badge`: `{ tone?: "neutral" | "warn" | "danger" | "ok"; title?: string; children }`.
  - `RatingBars`: `{ bars: 1 | 2 | 3 | 4 | 5; label: string }` (the `qbars` markup and `--q1..--q5` colours, moved from QualityBadge).
- `app/ui.css`: `.btn*`, `.segmented*`, `.badge*`, `.qbars*` rules, values from tokens only, `:focus-visible` uses `--focus-ring`, `.btn--done` uses `--teal`, `.btn--danger:hover` uses `--danger`. Visual target: today's `.home-button`, `.home-chip`, `.home-chip--on`, `.home-button--primary`, `.home-chip--quiet`, `.theme-toggle__group`, `.sat-badge--old/--stale`.

- [ ] **Step 1: Write the failing tests** in `test/ui-classes.test.mjs`:

```js
test('buttonClass defaults and modifiers', () => {
  assert.equal(buttonClass(), 'btn');
  assert.equal(buttonClass({ variant: 'primary', size: 'sm' }), 'btn btn--primary btn--sm');
  assert.equal(buttonClass({ variant: 'quiet', iconOnly: true, tone: 'danger', done: true }), 'btn btn--quiet btn--icon btn--danger btn--done');
});
test('badgeClass', () => {
  assert.equal(badgeClass(), 'badge');
  assert.equal(badgeClass('warn'), 'badge badge--warn');
});
test('segmentedNext moves with arrows, wraps, and jumps with Home and End', () => {
  const v = ['auto', 'light', 'dark'];
  assert.equal(segmentedNext(v, 'auto', 'ArrowRight'), 'light');
  assert.equal(segmentedNext(v, 'dark', 'ArrowRight'), 'auto');
  assert.equal(segmentedNext(v, 'auto', 'ArrowLeft'), 'dark');
  assert.equal(segmentedNext(v, 'light', 'Home'), 'auto');
  assert.equal(segmentedNext(v, 'light', 'End'), 'dark');
  assert.equal(segmentedNext(v, 'light', 'a'), 'light');
});
test('cx drops falsy parts', () => assert.equal(cx('a', false, null, 'b', undefined, ''), 'a b'));
```

- [ ] **Step 2: Run** `node --test test/ui-classes.test.mjs`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `lib/ui/classes.mjs`, the four components and `app/ui.css`.
- [ ] **Step 4: Run** `npm test && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: Add Button, Segmented, Badge and RatingBars to the UI library`.

### Task 7: UI library part 2: Modal, Field, Surface, Disclosure, StatTile, Chip

**Files:**
- Create: `components/ui/Modal.tsx`, `components/ui/Field.tsx`, `components/ui/Surface.tsx`, `components/ui/Disclosure.tsx`, `components/ui/Chip.tsx`
- Move: `components/passes/useFocusTrap.ts` → `components/ui/useFocusTrap.ts`; `components/sat/StatTile.tsx` → `components/ui/StatTile.tsx` (same API; update imports); `components/passes/MoreToggle.tsx` becomes `Disclosure`'s button form (update importers)
- Modify: `app/ui.css`, `lib/ui/classes.mjs`
- Test: `test/ui-classes.test.mjs`

**Interfaces:**
- Produces in `lib/ui/classes.mjs`: `modalClass({ size = 'dialog', tone = 'page' } = {}): string` → `"modal"`, plus `" modal--full"` for `size: 'full'` and `" theme-dark"` for `tone: 'dark'`.
- Produces components:
  - `Modal`: `{ open: boolean; onClose: () => void; title: string; size?: "dialog" | "full"; tone?: "page" | "dark"; actions?: ReactNode; labelledBy?: string; children }`. Renders backdrop + `role="dialog" aria-modal="true"`, title, a Close `Button` (`tone="danger"`, icon-only, `aria-label="Close"`), `useFocusTrap`, Escape closes, body scroll lock while open, focus returns to the opener.
  - `Field`: `{ label: string; hint?: string; error?: string; children: ReactElement }` (wires `id`, `aria-describedby`, `aria-invalid` onto the child input or select; control styling class `field__control`).
  - `Surface`: `{ as?: "div" | "section" | "article"; padded?: boolean; className?: string; children }` → class `surface` (the card look; name avoids triangulate's `.panel`).
  - `Disclosure`: `{ id: string; open: boolean; onToggle: () => void; label: string; children }` (MoreToggle's API and words "More"/"Less") and `Details`: `{ summary: ReactNode; defaultOpen?: boolean; children }` for the `<details>` uses.
  - `Chip`: `{ color: string; label: string; focused?: boolean; hidden?: boolean; onSelect: () => void; onToggleHidden?: () => void }` (markup and behaviour from `components/home/SatChips.tsx`'s chip).

- [ ] **Step 1: Write the failing tests:**

```js
test('modalClass', () => {
  assert.equal(modalClass(), 'modal');
  assert.equal(modalClass({ size: 'full', tone: 'dark' }), 'modal modal--full theme-dark');
});
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the components and their rules in `app/ui.css`. Visual targets: `.polar-modal-*`/`.radio-modal-*` frames for `Modal`, the live view takeover for `modal--full`, `.field` from globals for `Field`, `.sat-chip*` for `Chip`, `.stat-tile*` (move its rules from `app/sat.css` to `app/ui.css`).
- [ ] **Step 4: Run** `npm test && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: Add Modal, Field, Surface, Disclosure and Chip; move StatTile into the UI library`.

### Task 8: Migrate the screens and spacing

Move every screen to the library and snap spacing. Do it file group by file group, with a screenshot comparison after each group.

**Files:**
- Modify, group A (home): `components/home/HomeApp.tsx`, `HomeControls.tsx`, `NextUpList.tsx`, `FocusBar.tsx`, `LocationPrompt.tsx`, `SearchBar.tsx`, `SatChips.tsx`, `UpNow.tsx`, `Timeline.tsx`, `NextStrip.tsx`, `AboutSection.tsx`, `FlatMap.tsx` (zoom row, presets → `Segmented` is not right for presets since they are actions: use `Button size="sm"`; the Globe|Mercator radiogroup → `Segmented`), `components/AlertBell.tsx`, `components/ThemeToggle.tsx` (→ `Segmented`), `components/NightToggle.tsx`, `components/passes/QualityBadge.tsx` (→ `RatingBars` + `Badge`), `components/passes/CloudBadge.tsx` (→ `Badge`), `components/MapShell.tsx`
- Modify, group B (satellite page): `components/sat/SatApp.tsx`, `PassSection.tsx`, `ExtraObservers.tsx`, `NextPassLine.tsx`, `RawElements.tsx`, `ShareButton.tsx`, `LiveNumbers.tsx`, `Downlinks.tsx`, `HowWeCompute.tsx`
- Modify: `app/home.css`, `app/sat.css`, `app/globals.css` (delete rules the library replaces; keep layout only)
- Test: `test/ui-library.test.mjs` (new), `test/theme-css.test.mjs`

**Interfaces:**
- Consumes: everything from Tasks 6-7.

- [ ] **Step 1: Write the failing tests.** `test/ui-library.test.mjs`:

```js
// Source scan of components/ and app/ (excluding components/ui, components/triangulate, TriangulateApp.tsx).
test('no screen renders a raw <button>, <select> or <input> outside the library', () => {
  assert.deepEqual(rawControls(), [], 'use components/ui');
});
test('no old component class names remain', () => {
  const old = /\b(home-button|home-chip|sat-badge|theme-toggle__opt|segmented|more-toggle)\b/;
  assert.deepEqual(filesMatching(old), []);
});
test('screen stylesheets do not style controls by tag', () => {
  // home.css, sat.css, globals.css outside tokens, chart graphics and print:
  // no selector ending in button, input, select, summary or [role=radio].
  assert.deepEqual(tagSelectors(), []);
});
```

Also: no `filter:` declaration in `app/ui.css`, `app/home.css` or `app/sat.css`, and in `app/globals.css` only inside the night-vision rules (Review Focus 1).

Define `rawControls`, `filesMatching`, `tagSelectors` in this test file as plain source scans (`readdirSync` recursion plus regexes), in the style of `test/bundle-split.test.mjs`. `rawControls()` allows `<input type="checkbox">`/`type="range"` only inside `components/ui` and an explicit commented allowlist (empty to start). Add to `test/theme-css.test.mjs`:

```js
test('padding, margin and gap use spacing tokens', () => {
  const ok = (v) => v.split(/\s+/).every((p) => /^var\(--sp-\d+\)$/.test(p) || /^-?var\(--sp-\d+\)$/.test(p) || ['0', 'auto'].includes(p) || /^calc\(.*var\(--sp-/.test(p) || /env\(safe-area/.test(p));
  const found = FILES.flatMap((f) => ['padding', 'margin', 'gap', 'row-gap', 'column-gap', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right']
    .flatMap((p) => declsIn(f, p)).filter((d) => !ok(d.value) && !d.nudge));
  assert.deepEqual(found.map((d) => `${d.where}  ${d.value}`), []);
});
```

`declsIn` sets `nudge: true` on lines carrying `/* nudge */` (1 px optical corrections only).

- [ ] **Step 2: Run** `npm test`. Expected: FAIL in both files.
- [ ] **Step 3: Migrate group A**, deleting the replaced CSS and snapping spacing in the rules that stay (mapping: 1 → nudge or 2, 3 → 4, 5 → 4 or 6 by eye, 7 → 6 or 8, 10 → 8 or 12, 14 → 12 or 16, 18/20 → 16 or 24). Take screenshots to `.superpowers/shots/t8a` and compare with baseline; fix differences beyond the font and scale snaps.
- [ ] **Step 4: Migrate group B** the same way; screenshots to `.superpowers/shots/t8b`.
- [ ] **Step 5: Run** `npm test && npx tsc --noEmit`. Expected: PASS except the chart modal and live view files, which Task 9 handles. Keep them in a temporary allowlist in `test/ui-library.test.mjs` with a comment pointing at Task 9.
- [ ] **Step 6: Commit** after each group: `refactor: Move the home screen onto the UI library`, `refactor: Move the satellite page onto the UI library`.

### Task 9: Chart modals and live view on the library; shrink the chart block

**Files:**
- Modify: `components/passes/SkyChartModalView.tsx`, `components/passes/RadioChartModalView.tsx`, `components/passes/PassChartModals.tsx`, `components/live/LiveView.tsx`, `app/home.css` (chart block), `app/globals.css` (polar-plot chart block)
- Test: `test/theme-css.test.mjs`, `test/ui-library.test.mjs`

**Interfaces:**
- Consumes: `Modal` with `tone="dark"` (sky, radio) and `size="full"` (live view), `Button` with `tone="danger"` (Close) and `done` (Copy after copying), `Field`, `StatTile`, `Details`.

- [ ] **Step 1: Write the failing test** (replace the chart-block test's selector list):

```js
test('the chart block holds only chart graphics', () => {
  const chart = [...regions(read('app/home.css'), CHART_BEGIN, CHART_END), ...regions(read('app/globals.css'), CHART_BEGIN, CHART_END)].join('\n');
  for (const sel of ['.polar-modal-svg', '.radio-modal-svg', '.pass-card__plot .polar-plot', '.polar-plot .horizon']) assert.ok(chart.includes(sel), sel);
  assert.doesNotMatch(chart, /\b(button|select|input|summary)\b|-backdrop|-actions|-close|-content\s*\{/, 'modal chrome lives in the library');
});
test('chart modals render dark through the library', () => {
  for (const f of ['components/passes/SkyChartModalView.tsx', 'components/passes/RadioChartModalView.tsx']) assert.match(read(f), /tone="dark"/, f);
  assert.match(read('components/live/LiveView.tsx'), /size="full"/);
});
```

Remove the Task 8 temporary allowlist entries for these files.

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Migrate** the three views; the chart SVG and canvas drawing code and its literal palette stay untouched. Delete the chrome rules from the chart block. Leave the print block alone (Review Focus 3).
- [ ] **Step 4: Run** `npm test && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Screenshots** to `.superpowers/shots/t9`, all three themes; the chart modals must look dark in light theme and red in night vision; the print shot must match baseline apart from the font.
- [ ] **Step 6: Commit** `refactor: Chart modals and live view use the UI library`.

### Task 10: Map colours from one source

**Files:**
- Create: `lib/ui/map-tokens.mjs`
- Modify: `app/layout.tsx` (inline `<style>`), `app/globals.css` (remove the duplicated `--map-*` values), `lib/map/overlays.mjs` (export the colour table it already holds)
- Test: `test/map-tokens.test.mjs`, `test/theme-css.test.mjs` (`parseTokens` merges `mapCssVars`)

**Interfaces:**
- Produces: `mapCssVars(theme: 'dark' | 'light'): Record<string, string>` returning `--map-ocean`, `--map-land` (from `basemapColors(theme)`), `--map-night`, the observer colour as `--map-observer`, and any other `--map-*` whose value `lib/map/*.mjs` also holds; `mapTokenCss(): string` → `:root,:root[data-theme='dark'],.theme-dark{…}:root[data-theme='light']{…}` for the layout's inline `<style>`.
- Where today's CSS and JS disagree (`--map-night` light is `rgba(20, 30, 60, 0.1)` in CSS and `0.07` in JS), the JS value wins: it is what the map draws.

- [ ] **Step 1: Write the failing tests:**

```js
test('map colours in CSS come from the map modules', () => {
  for (const t of ['dark', 'light']) {
    assert.equal(mapCssVars(t)['--map-ocean'], basemapColors(t).water);
    assert.equal(mapCssVars(t)['--map-night'], overlayColors(t).night);
  }
  const block = regions(read('app/globals.css'), TOKENS_BEGIN, TOKENS_END).join('\n');
  for (const k of Object.keys(mapCssVars('dark'))) assert.ok(!new RegExp(`${k}:`).test(block), `${k} is defined only in lib/ui/map-tokens.mjs`);
});
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement**, inject `mapTokenCss()` in `app/layout.tsx` next to the Exo 2 `<style>`, update `parseTokens` in the theme test to merge `mapCssVars` so the contrast tests still see every token.
- [ ] **Step 4: Run** `npm test && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `refactor: Generate map colour tokens from the map modules`.

### Task 11: Reference page

**Files:**
- Create: `app/design-27b284ec240e9ac9/page.tsx`, `app/design-27b284ec240e9ac9/DesignBible.tsx` (client), `app/design-27b284ec240e9ac9/bible.css`
- Modify: `next.config.*` (header `X-Robots-Tag: noindex, nofollow` for `/design-27b284ec240e9ac9`)
- Test: `test/design-page.test.mjs`

**Interfaces:**
- Consumes: the token block (parsed at build time from `app/globals.css` with the same region markers, so the page lists real names and values), `mapCssVars`, `SAT_PALETTES` (`lib/map/palette.mjs`), the chart palette constants from `lib/passes/charts.js`, every `components/ui` component, `lib/ui/theme.mjs` for the theme and night switches.

Sections, in order: Font (sample paragraph, digits `0123456789 0O 1lI`, the three weights); Type scale (each `--fs-*` with name, px, sample); Colour (every token per theme as swatches with name and value; the JS palettes); Spacing; Radius; Borders; Shadows; Motion (a hover sample per duration); Components (each in every variant and state: Button primary/secondary/quiet × md/sm × default/disabled/pressed/danger/done, icon-only; Segmented; Badge tones; RatingBars 1-5; Chip normal/focused/hidden; StatTile md/lg; Field with hint and error; Surface; Disclosure; Details; a Modal opened by a button in both tones and the full size). Top bar: `Segmented` for Auto/Light/Dark and a night vision toggle wired to the real mechanisms. If Task 4 moved the scale by 1 px, say so in the Type section.

- [ ] **Step 1: Write the failing tests:**

```js
test('the design page is unlisted and noindex', async () => {
  const page = read('app/design-27b284ec240e9ac9/page.tsx');
  assert.match(page, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false/);
  assert.doesNotMatch(read('app/sitemap.ts'), /design-/);
  assert.doesNotMatch(read('app/robots.ts'), /design-/);
  assert.match(read(nextConfigPath()), /design-27b284ec240e9ac9[\s\S]*X-Robots-Tag[\s\S]*noindex, nofollow/);
  assert.deepEqual(filesLinkingTo('/design-27b284ec240e9ac9').filter((f) => !f.startsWith('app/design-')), []);
});
test('the design page renders tokens from globals.css, not a copy', () => {
  assert.match(read('app/design-27b284ec240e9ac9/page.tsx'), /theme-tokens:begin/);
});
```

Define `nextConfigPath()` and `filesLinkingTo(href)` in this test file as source scans. Check `middleware.ts`'s matcher does not catch the route (it matches `/`, `/classic`, `/sat/*` today).

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the page.
- [ ] **Step 4: Run** `npm test && npx tsc --noEmit && npm run build`. Expected: PASS; the build lists the route.
- [ ] **Step 5: Commit** `feat: Add the design bible reference page`.

### Task 12: Exports and share images in Atkinson (cuttable)

Skip this task if Aaron says so at the end-of-plan review; nothing else depends on it.

**Files:**
- Modify: `lib/passes/charts.js` and the chart export path (SVG → PNG in the browser), `lib/og/build-card.mjs`, `lib/og/sat-card.mjs`, the MCP chart (`lib/mcp/pass-chart.mjs`), the resvg font loading that bundles Arimo today
- Create: subset Atkinson files for embedding (base64 in SVG, like the existing Exo 2 embed) and for resvg
- Test: existing `test/og/*` and chart tests, plus one asserting the exported SVG embeds `Atkinson Hyperlegible Next`

- [ ] **Step 1: Write the failing test:** the chart export SVG string contains `@font-face` with `font-family: 'Atkinson Hyperlegible Next'`, and the OG SVG's text uses it.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement**; retune the radio chart's text-wrap width estimate for Atkinson's wider glyphs (check the longest labels in a 360 px export).
- [ ] **Step 4: Run** `npm test && npx tsc --noEmit`. Expected: PASS. Generate one OG card and one radio PNG and look at them.
- [ ] **Step 5: Commit** `feat: Chart exports and share cards use Atkinson Hyperlegible Next`.

### Task 13: Final screenshots and handoff

- [ ] **Step 1:** `npm run build && npm start`; `node .superpowers/shots/screens.mjs .superpowers/shots/final`. Compare every shot with baseline; list any differences beyond the font and the scale snaps and fix them.
- [ ] **Step 2:** `npm test && npx tsc --noEmit`. Report the actual counts.
- [ ] **Step 3:** Push `develop`. Tell Aaron the preview URL and the reference page path for his review.
