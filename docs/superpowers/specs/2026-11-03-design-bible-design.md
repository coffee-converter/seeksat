# SeekSat design bible

Date: 2026-11-03. Branch: develop (renamed from any-satellite-data-layer).

## Intent

SeekSat's UI grew screen by screen across 17 plans. Colours already run on
tokens, but type, radius, spacing, motion and the components themselves are
set case by case. Aaron wants one source of truth so that:

- the UI feels coherent and human-designed, not assembled;
- any theme, font or component change happens in one place;
- there is one library of UI components, and screens use it rather than
  restyling things locally.

The "bible" is both the source (tokens + component library in code) and a
living reference page inside SeekSat that shows all of it.

## Decisions Aaron made

- **Font: Atkinson Hyperlegible Next for everything** (text, headings and
  numbers). Picked over IBM Plex, Barlow, Manrope, Instrument Sans and Space
  Grotesk after side-by-side mockups. Reasons: unmistakable characters, a
  marked zero (Aaron likes zeros with a mark in the middle), legible on a
  phone outdoors at night and under night-vision red.
  - Numbers get their **own font token** that points at the same font for
    now. Atkinson Hyperlegible Mono was the runner-up for numbers; switching
    the numeric token to it later must be a one-line change.
  - Checked in the font files: Next has a `tnum` feature (tabular figures)
    and a marked zero, so ticking numbers line up without a mono.
- **One component library**, one source, screens pick variants.
- **Same branch:** built on `develop`, before go-live,
  following Aaron's order (review, bible, go live).
- **The bible page lives in SeekSat** at an unlisted, hard-to-guess URL,
  not indexed and not crawled.

## Goals

1. Token layer for type, spacing, radius, border, shadow and motion,
   alongside the existing colour tokens, in light, dark and night vision.
2. Atkinson Hyperlegible Next replaces the system font stacks site-wide.
3. A shared component library that every screen uses.
4. A reference page that renders every token and component live, with
   theme and night-vision switches.
5. Guard tests so new one-off values fail CI.

## Non-goals

- No visual redesign. Same Slate look, same layouts, same colours. The
  only intended visible changes are the font and the small snapping of
  sizes, radii and spacing to the scales.
- No new features or behaviour changes in components (except where two
  copies behave differently today: they converge on one).
- No CSS framework, CSS-in-JS or CSS modules. Plain global CSS with BEM
  class names stays (it is what the project uses).
- The private triangulate tool (`components/triangulate/`,
  `TriangulateApp.tsx`) is out of scope.

## Anti-goals (failure even if it "works")

- Two definitions of the same value anywhere (a token and a literal, or
  CSS and JS copies that must "keep in step").
- Screens restyling library components through descendant selectors
  (`.flat-map__zoom button { ... }`). Context may set layout (gap,
  placement), never the component's look.
- A bible page that is a hand-written description that drifts from the
  code. It must render the real tokens and the real components.
- The bible page showing up in search, the sitemap or robots.txt.
- Regressions in the always-dark chart blocks, night vision, print sheet,
  focus rings, 3:1 input boundaries or the colour contrast test.

## Audit (2026-11-03)

Files: `app/globals.css` (582 lines), `app/home.css` (1866), `app/sat.css`
(301), `app/mcp/mcp.css` (30). Colours: ~60 tokens per theme between
`theme-tokens:begin/end`; night vision is one root filter. Outside the token
block there are 72 literal colours, mostly in the two `chart-block` regions.

- **Font sizes:** ~30 distinct values. 12px ×37, 13 ×24, 11 ×19, 14 ×15,
  10 ×11, then 16, 18, 15, 9, 20, 22, 26, 28, 30, 12.5, 10.5, 7, a set of
  `min(Npx, Ncqi)` container-scaled sizes, and pt sizes for print.
- **Weights:** 400, 500, 600 (×33), 650, 700 (×16).
- **Families:** four slightly different system stacks, two different mono
  stacks, Exo 2 (wordmark, inlined base64 in `app/layout.tsx`).
- **Radii:** 12 values: 6 ×19, 8 ×18, 7 ×13, 50% ×9, 10 ×9, 4 ×7, 3, 0,
  999px, 12, 5, 2, 1.
- **Spacing:** gaps mostly 4/6/8/12 already; ~25 distinct padding pairs.
- **Motion:** 4 transitions, all different (0.12 s, 0.15 s, 0.25 s ease).
- **Shadows:** ad hoc, some with literal rgba.
- **Components:** 72 `<button>`s outside triangulate; 41 have no class and
  are styled by 35 descendant selectors. Named classes carry screen names
  but are used everywhere (`.home-button`, `.home-button--primary`,
  `.home-chip` ×19 with `--on/--quiet/--live`). `.sat-chip` for map chips.
  Two parallel modal class sets (`polar-modal-*`, `radio-modal-*`) plus the
  live view dialog. Three or four segmented/toggle implementations (theme
  toggle, Globe|Mercator radiogroup, Visual|Radio mode, `.segmented`).
  Badges four ways (QualityBadge, CloudBadge, `.sat-badge--old/--stale`,
  `.badge`). Shared React parts today: StatTile, MoreToggle, QualityBadge,
  CloudBadge.
- **Colour outside CSS:** `lib/map/palette.mjs` (satellite palettes),
  `lib/map/overlays.mjs` (map overlay colours, which the legend CSS says it
  "keeps in step" with), `lib/passes/charts.js`, `lib/og/*.mjs`.

## The design

### Tokens

All tokens live in `app/globals.css` (the existing token block, extended).
Values below are Claude's proposal; the builder may adjust a step when the
real screens show it is wrong, but must keep the step count small.

- **Fonts:** `--font-sans` (Atkinson Hyperlegible Next, then a system
  fallback), `--font-num` (same as `--font-sans` for now), `--font-brand`
  (Exo 2). Numeric UI (times, countdowns, az/el, range, frequencies,
  Doppler, NORAD ids, stat tiles) uses `--font-num` with
  `font-variant-numeric: tabular-nums`, through one utility class or the
  component that shows it.
- **Type scale (6 steps + hero):** 11 (small-caps labels), 12 (secondary),
  13 (body, today's base), 15 (card titles), 18 (section headings), 24
  (large readouts), plus one container-scaled hero step that replaces the
  `min(Npx, Ncqi)` variants. Atkinson sets larger than the system font at
  the same px; the builder checks the base on real screens and may move the
  whole scale up one px (13 → 14) if text looks oversized or undersized,
  keeping the ratios. Line heights as tokens (tight for readouts, 1.5 for
  body).
- **Weights:** 400, 500, 600. 650 and 700 go, except in the wordmark.
- **Spacing:** 2, 4, 6, 8, 12, 16, 24, 32.
- **Radii:** 4 (small marks, bars, badges), 6 (buttons, inputs, chips that
  are not pills), 8 (cards, tiles), 12 (modals, sheets), full (pills and
  dots).
- **Borders:** 1px with the existing `--border`, `--btn-line`,
  `--input-border` colours as named border tokens.
- **Shadows:** two elevations (popover, modal), defined per theme.
- **Motion:** fast 120 ms, base 200 ms, slow 300 ms, one standard easing;
  all transitions use them and `prefers-reduced-motion` removes them.
- **Print** keeps its own pt sizes in the print block.
- **Charts and colour in JS:** no value defined twice. Where CSS and JS
  both need a colour (the map legend swatches vs `overlays.mjs`), one side
  reads from the other. The builder picks the direction; the reference page
  shows the JS palettes (satellite palette, overlay colours, chart colours)
  by importing the same modules.

### Fonts loading

Self-hosted (Claude's call): `next/font` serving Atkinson Hyperlegible Next
from SeekSat's own origin, so no runtime request to Google, no layout jump,
offline support through the service worker, and the CSP's `font-src` stays
`'self'`. Exo 2 keeps its current inline embed. Weights 400/500/600 only,
Latin subset plus the symbols SeekSat shows (°, ·, −, →, ←).

Exports and images (Claude's call, last phase, can be cut): the chart PNG
exports and the OG cards switch to Atkinson Hyperlegible Next too, so a
shared image matches the site. This is more work than the page font: chart
PNGs are SVG rasterised in the browser, so the font is embedded in each
SVG the way Exo 2 is today; the radio chart's text-wrap estimate is tuned
to the system font and must be retuned; the MCP chart and OG cards use
resvg with a bundled Arimo, which is replaced by a bundled Atkinson file.
If `next/font/google` cannot produce the symbol subset, use
`next/font/local` with the font files in the repo (OFL licence).

### Component library

`components/ui/`, one file per component, styles in one new stylesheet
(`app/ui.css`) that reads only tokens. Screen stylesheets keep layout only.

- **Button**: variants primary, secondary (today's outline), quiet (today's
  `home-chip--quiet` look); sizes regular and small; icon-only form with a
  required `aria-label`; `aria-pressed` support for toggle buttons.
- **Chip**: the satellite chip (dot, name, hide eye, focused state).
- **Segmented**: one radiogroup control for theme (Auto/Light/Dark),
  Globe|Mercator, Visual|Radio and any other one-of-N switch.
- **Badge**: plain, warning (old), danger (stale), cloud, and the rating
  bars (QualityBadge's bars become part of it or a sibling RatingBars).
- **Modal**: one dialog shell (backdrop, title, close, focus trap, actions
  row, Escape, scroll lock) used by the sky chart, radio chart and live
  view.
- **Tile**: StatTile as is, absorbing the other tile-like blocks.
- **Panel**: card surface (today's `.panel`, pass card shell).
- **Field**: text input and select with label, hint and error.
- **Disclosure**: MoreToggle and the `<details>` uses.

Migration: every screen moves to the library; the descendant selectors that
restyle buttons are deleted; class names lose screen prefixes
(`home-button` → `btn`, etc.). Visual parity is the bar: before/after
screenshots of home, a satellite page, each modal and the print sheet, in
light, dark and night vision, at 360 px and desktop widths.

### Reference page

- Route `/design-27b284ec240e9ac9` (random slug, not secret, just unlisted).
- `robots: { index: false, follow: false }` in its metadata and an
  `X-Robots-Tag: noindex, nofollow` header. Not in the sitemap, not in
  robots.txt (listing it there would advertise it), no links to it anywhere
  on the site.
- Shows: the font and a sample paragraph; the type scale with each token's
  name and px; weights; colour tokens per theme as swatches with names and
  values; the JS palettes; spacing, radius, border, shadow and motion
  tokens as visual samples; every component in every variant and state
  (hover/focus shown statically where possible, disabled, pressed).
- Switches on the page for Auto/Light/Dark and night vision, using the real
  theme and night mechanisms (`lib/ui/theme.mjs`).
- Uses the site layout and the real components; nothing hand-drawn.

### The chart modals (Claude's call)

The sky and radio chart modals stay always dark, as decided in Plan 7. Today
their frames, buttons, frequency field, phone tiles and `<details>` sit
inside the chart block (`app/home.css`, about lines 843-1185) with their own
literal colours and descendant selectors. In this work:

- The token block gains a scoped dark copy: the dark selector becomes
  `:root, :root[data-theme='dark'], .theme-dark`, so any subtree with
  `class="theme-dark"` gets the real dark tokens in either page theme. The
  chart modals carry it and use the library's Modal, Button, Field, Tile
  and Disclosure like everywhere else.
- Their special states become component states available anywhere: a
  danger hover for Close, a "done" (teal) state for Copy after copying,
  and the tinted cross-link becomes the secondary or primary button.
- The chart-block exemption shrinks to the chart graphics only (the SVG
  plots and their literal palettes). Modal chrome is covered by the library
  and the guard tests.

The live view is a full-screen takeover, so Modal gets a full-screen
variant for it.

### Visual parity (Claude's call)

Screenshots with Playwright run from a scratch script (`npx`, not a project
dependency), against a local production build: home, a satellite page, each
modal and the print sheet, in light, dark and night vision, at 360 px and
desktop. The font changes everywhere, so these are compared by eye, not by
pixel diff. The builder reviews them after each screen's migration; Aaron
reviews once at the end on the Vercel preview.

### Guard tests

Extend `test/theme-css.test.mjs` (which already enforces colour tokens
outside the chart blocks) so that outside the token block, the chart
blocks and the print block:

- `font-family` must use a font token;
- `font-size`, `font-weight`, `border-radius`, `transition` and
  `box-shadow` must use tokens (allow `0`, `inherit`, `none`, `50%`);
- spacing in `padding`, `margin` and `gap` uses tokens (allow `0` and
  `auto`; the builder may allow a short, commented list of exceptions such
  as 1px optical nudges).

A test also checks the reference page's route sets noindex and is absent
from `app/sitemap.ts`.

## Constraints

- Next.js app on Vercel; strict CSP in `lib/site/csp.mjs` (connect-src self
  plus nominatim; fonts must be same-origin).
- Service worker (`public/sw.js`) caches per build; self-hosted fonts must
  be cacheable for offline.
- Night vision is a root CSS filter; components must not fight it (no
  `filter` on components, no colours that escape the token block).
- Chart blocks stay literal-dark by design (existing rule).
- Accessibility already in place stays: focus rings, 3:1 input edges,
  44 px tap targets on phones, focus traps in dialogs, labelled buttons.
- 1300+ tests must keep passing; `tsc` clean.

## Left to the builder

- Exact token names (follow the existing `--kebab` style).
- The direction of the CSS↔JS colour link.
- Splitting the work into plans/tasks and the order of screen migration.
- Small adjustments to scale steps after seeing real screens, documented
  in the reference page.
