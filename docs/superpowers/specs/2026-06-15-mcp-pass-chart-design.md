# MCP `get_pass_chart` — Design

**Date:** 2026-06-15
**Status:** Approved-to-build (design delegated — "go with whatever makes sense")
**Branch:** `seeksat-mcp-pass-chart`, off `main`.

## Purpose

Add an MCP tool that returns a **rendered polar sky chart** (PNG) for a satellite's next pass over a location — the same annotated chart the web app shows (horizon circle, the pass arc, the moon/planets/stars in their real positions), handed back to an AI agent as an image. Almost no MCP servers return rendered visuals; an agent that replies to *"when can I see the ISS from Tokyo?"* with an actual picture of where to look is a genuine standout — and the centerpiece demo asset for sharing the project.

## Key insight: the render pipeline already exists (OG images)

The share-link OG image path already renders the real chart server-side, on Vercel's Node runtime:
- `lib/og/dom.mjs` — installs a global `document` (linkedom) so the SVG painters run off-browser.
- `lib/og/render-pass-chart.mjs` `renderPassChartSVG({ observer, win, peakMs, issEcefAt })` — paints the cropped circular chart (arc + stars + planets + moon + constellations + events) using the app's own painters, with the modal `<style>` embedded so it rasterizes standalone.
- `lib/og/rasterize.mjs` `rasterizeCard(svg)` — SVG → PNG via `@resvg/resvg-wasm` with embedded fonts.

The MCP's `makeEcefSampler(line1, line2)` (`lib/mcp/passes.mjs`) is a drop-in for the OG's `issEcefAt` (both are `(Date) → ecef|null`). So the tool is mostly assembly + one new "find the next pass window" helper, not new rendering.

## Tool

`get_pass_chart` (registered in `app/api/mcp/route.ts`), tier-gated like the other satellite tools.

**Input (zod):**
- `satellite: string` — NORAD id or name (required).
- `lat?: number`, `lon?: number`, `location?: string` — same location resolution as `find_passes` (lat+lon or a geocoded place name; required one way or the other).
- `mode?: 'visual' | 'radio'` — default `'visual'`.

**Behavior:** find the **next pass of that mode** within a 72 h scan (same window the `next_visible_pass` tool uses). If one exists, render its chart and return an **image + text** result. If none, return a **text-only** result ("No upcoming … pass …") — graceful for both image-capable and text-only clients.

**Output (MCP content blocks):**
```
{ content: [
    { type: 'image', data: <base64 PNG>, mimeType: 'image/png' },
    { type: 'text', text: <one-line summary: sat, location, rise time, peak elevation+direction, magnitude> },
] }
```
Image-capable clients (Claude) render the chart inline; the text block gives every client the key facts and context. ~720 px wide.

## Components

### 1. `lib/og/rasterize.mjs` — generalize width

Add `rasterizeSvg(svg, { width = 1200 } = {})` (the current resvg + font/wasm setup, width parameterized); refactor `rasterizeCard(svg)` to call `rasterizeSvg(svg, { width: 1200 })` so the OG path is unchanged. The chart tool calls `rasterizeSvg(chartSvg, { width: 720 })`.

### 2. `lib/mcp/passes.mjs` — `nextPassWindow`

```
export function nextPassWindow({ line1, line2, observer, startMs, windowHours = 72, minElevationDeg = 10, mode = 'visual' })
  -> { win: { startMs, endMs }, peakMs, observer } | null
```
Reuses the existing `makeEcefSampler` + `findWindowsFromPredicate` + the peak-elevation scan already in `summarizePass`. Returns the raw window + peak for the first (soonest) pass, or `null`. This is the piece `find_passes` computes internally but never exposes; factor that peak scan so `summarizePass` and `nextPassWindow` share it (no duplicate loop).

### 3. `lib/og/render-pass-chart.mjs` — thread `satName`

`renderPassChartSVG({ observer, win, peakMs, issEcefAt, satName })` — pass `satName` into `paintPolarModalStatic`'s opts (the title renderer already reads `opts.satName`, added in the satellite-label fix; it falls back to a generic title when absent, so the OG path is unaffected).

### 4. `lib/mcp/pass-chart.mjs` (new) — orchestrator

```
export async function renderPassChartPng({ entry, record, observer, mode, nowMs, scanHours = 72 })
  -> { pngBase64, summary } | { summary }
```
- `sampler = makeEcefSampler(record.line1, record.line2)`
- `pass = nextPassWindow({ line1: record.line1, line2: record.line2, observer, startMs: nowMs, windowHours: scanHours, mode })`
- No pass → `{ summary: 'No upcoming <mode> pass for <name> from <location> in the next <scanHours>h.' }`
- Else → `svg = renderPassChartSVG({ observer, win: pass.win, peakMs: pass.peakMs, issEcefAt: sampler, satName: entry.name })`; `png = await rasterizeSvg(svg, { width: 720 })`; build a one-line `summary` (sat, location, rise time ISO, peak elevation°, peak azimuth/compass direction, magnitude — reuse the same numbers `summarizePass` computes); return `{ pngBase64: png.toString('base64'), summary }`.
- Keep the heavy imports (dom/render/rasterize) inside this module so only this tool pulls them in.

### 5. `lib/mcp/tools.mjs` — `getPassChartTool`

```
export async function getPassChartTool(input, deps, tier = 'free')
```
`requireRecord(satellite, deps, tier)` → `resolveLocation(input, deps)` → build `observer = { name: loc.displayName ?? 'Observer', latDeg: loc.latDeg, lonDeg: loc.lonDeg }` → `return renderPassChartPng({ entry, record, observer, mode: input.mode ?? 'visual', nowMs: deps.now() })`. Returns the `{ pngBase64?, summary }` data; the route turns it into MCP content blocks (mirrors how the other handlers return data and the route wraps it).

### 6. `app/api/mcp/route.ts` — register + format

Register `get_pass_chart` with the zod schema above. The callback reads the request context, logs usage (`logUsage({ tool: 'get_pass_chart', tier, keyId, satellite: args.satellite })`), calls `getPassChartTool(args, deps, tier)`, then:
```
return res.pngBase64
  ? { content: [ { type: 'image', data: res.pngBase64, mimeType: 'image/png' }, { type: 'text', text: res.summary } ] }
  : { content: [ { type: 'text', text: res.summary } ] };
```
wrapped in the existing try/catch → `asError`.

### 7. Discoverability surfaces (keep them in sync)

`lib/mcp/discovery.mjs` `TOOL_SUMMARIES` gains a 6th entry (`get_pass_chart — a rendered polar sky chart (PNG) of the next pass: where to look, with the moon, planets, and stars in place.`). That flows automatically into `/llms.txt` and the `/mcp` page. Add the same line to `skills/seeksat/SKILL.md`.

## Data flow

```
get_pass_chart(args) → route reads ctx + logs usage
  → getPassChartTool → requireRecord + resolveLocation
  → renderPassChartPng → nextPassWindow (sampler) → renderPassChartSVG(+satName) → rasterizeSvg(720)
  → { pngBase64, summary }  → route → MCP image + text content blocks
```

## Error handling

- Unknown satellite / no location → the existing `requireRecord` / `resolveLocation` throws → `asError` (clean MCP error), same as the other tools.
- No upcoming pass → text-only result (not an error — it's a valid answer).
- Premium satellite without `pro` tier → `requireRecord` throws (dormant today).
- Render/rasterize failure → caught by the route try/catch → `asError`; never returns a half-image.

## Testing

`node:test`:
- **`nextPassWindow`** (pure) — with the existing `mcp-passes` fixture TLE + a fixed `startMs`, returns a window whose `peakMs` is within `[startMs, startMs + windowHours]` (or `null` when none); a radio-mode call returns a window where the visual gate is irrelevant. Add to `test/mcp-passes.test.mjs`.
- **`rasterizeSvg`** — a tiny SVG renders to a non-empty PNG buffer whose header is the PNG magic bytes (mirrors `test/og/rasterize.test.mjs`).
- **`renderPassChartPng`** (integration, DOM installed) — with a fixture TLE + fixed `nowMs` + a known location, returns `{ pngBase64, summary }` with a non-empty base64 string and a summary containing the satellite name; and `{ summary }` only (no `pngBase64`) for a geometry with no pass. Lives under `test/` alongside the og render tests (which already exercise this pipeline in node).

Route wiring + the actual image bytes are verified by `npm run build` + a manual MCP `tools/call` curl (confirm an `image` content block with non-empty base64 + the text block).

## Out of scope (deferred)

- **Timezone-correct labels** — the chart's time labels need `observer.tz`; v1 omits it (falls back to "browser local / tz unavailable"). A lat/lon → tz lookup is a clean follow-up (the webapp already does it for observers).
- **Choosing a specific pass by time** — v1 always renders the *next* pass of the mode.
- **Embedding the chart in `find_passes`/`next_visible_pass`** — keep image rendering in its own opt-in tool so text-only calls stay cheap.
- **Resolution/format options** — fixed 720 px PNG for v1.

## Files affected

- **Add:** `lib/mcp/pass-chart.mjs`, plus tests (`test/mcp-pass-chart.test.mjs`; `nextPassWindow` cases appended to `test/mcp-passes.test.mjs`).
- **Modify:** `lib/og/rasterize.mjs` (`rasterizeSvg`), `lib/mcp/passes.mjs` (`nextPassWindow` + shared peak scan), `lib/og/render-pass-chart.mjs` (`satName`), `lib/mcp/tools.mjs` (`getPassChartTool`), `app/api/mcp/route.ts` (register + image/text content), `lib/mcp/discovery.mjs` + `skills/seeksat/SKILL.md` (tool list).
