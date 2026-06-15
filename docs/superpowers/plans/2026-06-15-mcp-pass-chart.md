# MCP `get_pass_chart` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an MCP `get_pass_chart` tool that returns a rendered polar sky-chart PNG (image content block) of a satellite's next pass over a location, plus a text summary.

**Architecture:** Reuse the OG-image server render pipeline (`renderPassChartSVG` + `@resvg/resvg-wasm`). A new `nextPassWindow` helper exposes the next pass's raw window; a `lib/mcp/pass-chart.mjs` orchestrator renders + rasterizes; the route returns `{ image, text }` MCP content. The MCP's `makeEcefSampler` is the `issEcefAt` the renderer needs.

**Tech Stack:** Next.js route (Node runtime), `mcp-handler`, `@resvg/resvg-wasm` + `linkedom` (already deps), `node:test`.

**Spec:** `docs/superpowers/specs/2026-06-15-mcp-pass-chart-design.md`

---

## File Structure

- **Modify** `lib/og/rasterize.mjs` — add `rasterizeSvg(svg, {width})`; `rasterizeCard` delegates.
- **Modify** `lib/mcp/passes.mjs` — `nextPassWindow` + shared `peakOf` helper.
- **Modify** `lib/og/render-pass-chart.mjs` — thread `satName`.
- **Add** `lib/mcp/pass-chart.mjs` — orchestrator.
- **Modify** `lib/mcp/tools.mjs` — `getPassChartTool` (lazy-imports the orchestrator).
- **Modify** `app/api/mcp/route.ts` — register `get_pass_chart`, return image+text content.
- **Modify** `lib/mcp/discovery.mjs`, `skills/seeksat/SKILL.md` — list the new tool.
- **Tests** `test/og/rasterize.test.mjs` (append), `test/mcp-passes.test.mjs` (append), `test/mcp-pass-chart.test.mjs` (new).

---

## Task 1: `rasterizeSvg` — width-parameterized rasterize

**Files:** Modify `lib/og/rasterize.mjs`; Test append `test/og/rasterize.test.mjs`.

- [ ] **Step 1: Write the failing test**

Append to `test/og/rasterize.test.mjs` (import `rasterizeSvg` alongside the existing import from `../../lib/og/rasterize.mjs`):

```js
import { rasterizeSvg } from '../../lib/og/rasterize.mjs';

test('rasterizeSvg renders a standalone SVG to PNG bytes at the given width', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#123"/></svg>';
  const png = await rasterizeSvg(svg, { width: 64 });
  assert.ok(Buffer.isBuffer(png) && png.length > 0);
  // PNG magic bytes.
  assert.equal(png.subarray(0, 4).toString('hex'), '89504e47');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/og/rasterize.test.mjs`
Expected: FAIL — `rasterizeSvg` is not exported.

- [ ] **Step 3: Implement**

In `lib/og/rasterize.mjs`, replace the `rasterizeCard` export with:

```js
export async function rasterizeSvg(svg, { width = 1200 } = {}) {
  await ensureWasm();
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: { loadSystemFonts: false, fontBuffers: FONT_BUFFERS, defaultFontFamily: "Arimo" },
  });
  return Buffer.from(resvg.render().asPng());
}

// OG card render — unchanged behavior (1200px wide).
export async function rasterizeCard(cardSVG) {
  return rasterizeSvg(cardSVG, { width: 1200 });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/og/rasterize.test.mjs`
Expected: PASS (existing card test + the new one).

- [ ] **Step 5: Commit**

```bash
git add lib/og/rasterize.mjs test/og/rasterize.test.mjs
git commit -m "refactor(og): rasterizeSvg(svg, {width}); rasterizeCard delegates"
```

---

## Task 2: `nextPassWindow` in passes.mjs

**Files:** Modify `lib/mcp/passes.mjs`; Test append `test/mcp-passes.test.mjs`.

Context: `summarizePass` currently inlines the peak-elevation scan. Factor it into `peakOf` and add `nextPassWindow` reusing it + the existing `findWindowsFromPredicate`/`observerSeesIss`/`makeEcefSampler`.

- [ ] **Step 1: Write the failing test**

Append to `test/mcp-passes.test.mjs` (import `nextPassWindow` from `../lib/mcp/passes.mjs`; reuse that file's existing ISS `LINE1`/`LINE2` fixtures — if it has none, add the two lines shown here):

```js
import { nextPassWindow } from '../lib/mcp/passes.mjs';

const NP_LINE1 = '1 25544U 98067A   24001.50000000  .00000000  00000+0  00000+0 0  9990';
const NP_LINE2 = '2 25544  51.6400 100.0000 0003500 100.0000 260.0000 15.50000000000010';
const NP_NOW = Date.parse('2024-01-01T00:00:00Z');

test('nextPassWindow finds a radio pass over the equator within the scan', () => {
  const pass = nextPassWindow({
    line1: NP_LINE1, line2: NP_LINE2,
    observer: { latDeg: 0, lonDeg: 0 }, startMs: NP_NOW, windowHours: 72, mode: 'radio',
  });
  assert.ok(pass, 'a pass exists');
  assert.ok(pass.win.startMs >= NP_NOW && pass.win.endMs <= NP_NOW + 72 * 3_600_000);
  assert.ok(pass.peakMs >= pass.win.startMs && pass.peakMs <= pass.win.endMs);
});

test('nextPassWindow returns null where the satellite never reaches (lat 85, incl 51.6)', () => {
  const pass = nextPassWindow({
    line1: NP_LINE1, line2: NP_LINE2,
    observer: { latDeg: 85, lonDeg: 0 }, startMs: NP_NOW, windowHours: 72, mode: 'radio',
  });
  assert.equal(pass, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/mcp-passes.test.mjs`
Expected: FAIL — `nextPassWindow` not exported.

- [ ] **Step 3: Implement**

In `lib/mcp/passes.mjs`, add a `peakOf` helper above `summarizePass`, refactor `summarizePass` to use it, and add `nextPassWindow`:

```js
// Highest apparent-altitude moment within a window (the peak).
function peakOf(win, observer, sampler) {
  const STEP = 1000;
  let peakAlt = -Infinity;
  let peakMs = win.startMs;
  for (let t = win.startMs; t <= win.endMs; t += STEP) {
    const e = sampler(new Date(t));
    if (!e) continue;
    const { alt } = issAltAzDeg(observer, e);
    if (alt > peakAlt) { peakAlt = alt; peakMs = t; }
  }
  return { peakAlt, peakMs };
}
```

Change the top of `summarizePass` from its inline peak loop to:

```js
function summarizePass(win, observer, sampler, mode, minElevDeg, stdMag = -1.8) {
  const { peakAlt, peakMs } = peakOf(win, observer, sampler);
  if (peakAlt === -Infinity) return null;
  // ...the rest of summarizePass (azAt, peakEcef, quality, return {...}) unchanged...
```

(Delete the old `const STEP = 1000; let peakAlt …` loop that produced `peakAlt`/`peakMs`.)

Add after `findPasses`:

```js
// Raw window + peak of the SOONEST pass of `mode` within the scan, for
// callers that need the window itself (e.g. chart rendering) rather than
// a summarized row. Returns { win, peakMs } or null.
export function nextPassWindow({ line1, line2, observer, startMs, windowHours = 72, minElevationDeg = 10, mode = 'visual' }) {
  const obs = { id: 'observer', latDeg: observer.latDeg, lonDeg: observer.lonDeg };
  const sampler = makeEcefSampler(line1, line2);
  const endMs = startMs + windowHours * 3_600_000;
  const predicate = (ms) => {
    const e = sampler(new Date(ms));
    if (!e) return false;
    return observerSeesIss(obs, e, new Date(ms), mode, minElevationDeg);
  };
  const windows = findWindowsFromPredicate(predicate, startMs, endMs, 60_000);
  if (!windows.length) return null;
  const win = windows[0];
  const { peakAlt, peakMs } = peakOf(win, obs, sampler);
  if (peakAlt === -Infinity) return null;
  return { win, peakMs };
}
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: ALL PASS (the new `nextPassWindow` tests + existing `mcp-passes` tests still green after the `peakOf` refactor).

- [ ] **Step 5: Commit**

```bash
git add lib/mcp/passes.mjs test/mcp-passes.test.mjs
git commit -m "feat(mcp): nextPassWindow — expose the next pass's raw window"
```

---

## Task 3: thread `satName` into `renderPassChartSVG`

**Files:** Modify `lib/og/render-pass-chart.mjs`.

- [ ] **Step 1: Add the param + pass it through**

Change the signature to accept `satName` and forward it into `paintPolarModalStatic`'s opts:

```js
export function renderPassChartSVG({ observer, win, peakMs, issEcefAt, satName }) {
```

and the `paintPolarModalStatic(...)` call inside it to:

```js
  paintPolarModalStatic(svg, observer, peakMs, sunAltAtPeak,
    { modalGeom: MODAL_GEOM, tzRefMs: win.startMs, satName });
```

(`paintPolarModalStatic` already reads `opts.satName` and falls back to a generic title when absent, so the OG caller — which doesn't pass it — is unchanged.)

- [ ] **Step 2: Run the OG render tests**

Run: `node --test test/og/render-pass-chart.test.mjs`
Expected: PASS (unchanged — `satName` is optional).

- [ ] **Step 3: Commit**

```bash
git add lib/og/render-pass-chart.mjs
git commit -m "feat(og): renderPassChartSVG accepts satName for the chart title"
```

---

## Task 4: `lib/mcp/pass-chart.mjs` orchestrator

**Files:** Create `lib/mcp/pass-chart.mjs`; Test `test/mcp-pass-chart.test.mjs`.

- [ ] **Step 1: Write the failing test**

Create `test/mcp-pass-chart.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPassChartPng } from '../lib/mcp/pass-chart.mjs';

const LINE1 = '1 25544U 98067A   24001.50000000  .00000000  00000+0  00000+0 0  9990';
const LINE2 = '2 25544  51.6400 100.0000 0003500 100.0000 260.0000 15.50000000000010';
const ENTRY = { noradId: 25544, name: 'ISS (ZARYA)', standardMag: -1.8 };
const REC = { noradId: 25544, name: 'ISS (ZARYA)', line1: LINE1, line2: LINE2 };
const NOW = Date.parse('2024-01-01T00:00:00Z');

test('renders a PNG + summary for an upcoming pass', async () => {
  const observer = { name: 'Equator', latDeg: 0, lonDeg: 0 };
  const res = await renderPassChartPng({ entry: ENTRY, record: REC, observer, mode: 'radio', nowMs: NOW });
  assert.ok(typeof res.pngBase64 === 'string' && res.pngBase64.length > 100, 'non-empty base64 png');
  assert.match(res.summary, /ISS/);
});

test('returns text-only when there is no pass (lat 85, incl 51.6)', async () => {
  const observer = { name: 'Arctic', latDeg: 85, lonDeg: 0 };
  const res = await renderPassChartPng({ entry: ENTRY, record: REC, observer, mode: 'radio', nowMs: NOW });
  assert.equal(res.pngBase64, undefined);
  assert.match(res.summary, /No upcoming/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/mcp-pass-chart.test.mjs`
Expected: FAIL — cannot find module `../lib/mcp/pass-chart.mjs`.

- [ ] **Step 3: Implement `lib/mcp/pass-chart.mjs`**

```js
// lib/mcp/pass-chart.mjs — render the next pass's polar sky chart to a PNG
// for the get_pass_chart MCP tool. Reuses the OG-image render pipeline
// (renderPassChartSVG + resvg). Importing render-pass-chart installs the
// linkedom DOM the painters need.
import { nextPassWindow } from './passes.mjs';
import { makeEcefSampler } from './ecef-sampler.mjs';
import { renderPassChartSVG } from '../og/render-pass-chart.mjs';
import { rasterizeSvg } from '../og/rasterize.mjs';
import { issAltAzDeg } from '../pass-finder/visibility.js';
import { peakMagnitudeInWindow } from '../pass-finder/scoring.js';

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compassOf = (azDeg) => COMPASS[Math.round((((azDeg % 360) + 360) % 360) / 45) % 8];

// observer: { name?, latDeg, lonDeg }. Returns { pngBase64, summary } when
// a pass exists, else { summary } (text-only).
export async function renderPassChartPng({ entry, record, observer, mode = 'visual', nowMs, scanHours = 72 }) {
  const loc = observer.name || `${observer.latDeg.toFixed(2)}, ${observer.lonDeg.toFixed(2)}`;
  const pass = nextPassWindow({
    line1: record.line1, line2: record.line2, observer,
    startMs: nowMs, windowHours: scanHours, mode,
  });
  if (!pass) {
    return { summary: `No upcoming ${mode} pass for ${entry.name} from ${loc} in the next ${scanHours}h.` };
  }
  const sampler = makeEcefSampler(record.line1, record.line2);
  const svg = renderPassChartSVG({
    observer, win: pass.win, peakMs: pass.peakMs, issEcefAt: sampler, satName: entry.name,
  });
  const png = await rasterizeSvg(svg, { width: 720 });

  const peakEcef = sampler(new Date(pass.peakMs));
  const peak = peakEcef ? issAltAzDeg(observer, peakEcef) : { alt: null, az: null };
  const mag = peakMagnitudeInWindow(pass.win, [observer], sampler, entry.standardMag);
  const summary =
    `${entry.name} over ${loc}: rises ${new Date(pass.win.startMs).toISOString()}, ` +
    `peaks ${peak.alt == null ? '?' : peak.alt.toFixed(0)}° to the ${peak.az == null ? '?' : compassOf(peak.az)}` +
    `${mag == null ? '' : `, ~mag ${mag.toFixed(1)}`}. The chart shows where to look.`;
  return { pngBase64: png.toString('base64'), summary };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/mcp-pass-chart.test.mjs`
Expected: PASS (2 tests). This exercises the full DOM + resvg-wasm render in node, same as the `test/og/*` render tests.

- [ ] **Step 5: Commit**

```bash
git add lib/mcp/pass-chart.mjs test/mcp-pass-chart.test.mjs
git commit -m "feat(mcp): pass-chart orchestrator — next pass -> PNG + summary"
```

---

## Task 5: `getPassChartTool` + route registration

**Files:** Modify `lib/mcp/tools.mjs`, `app/api/mcp/route.ts`.

- [ ] **Step 1: Add `getPassChartTool` to `lib/mcp/tools.mjs`**

Append (lazy-import keeps the heavy render pipeline out of the module graph for the other tools/tests):

```js
export async function getPassChartTool(input, deps, tier = 'free') {
  const { entry, record } = await requireRecord(input.satellite, deps, tier);
  const loc = await resolveLocation(input, deps);
  const observer = { name: loc.displayName ?? 'Observer', latDeg: loc.latDeg, lonDeg: loc.lonDeg };
  const { renderPassChartPng } = await import('./pass-chart.mjs');
  return renderPassChartPng({ entry, record, observer, mode: input.mode ?? 'visual', nowMs: deps.now() });
}
```

- [ ] **Step 2: Register the tool in `app/api/mcp/route.ts`**

Add `getPassChartTool` to the import from `@/lib/mcp/tools.mjs`. Then add a sixth `server.tool(...)` after `get_pass_weather`:

```ts
    server.tool(
      'get_pass_chart',
      'Render a polar sky chart (PNG) of a satellite\'s next pass over a location — where to look, with the moon, planets, and stars in their real positions. mode "visual" (default) or "radio".',
      {
        satellite: z.string().describe('NORAD id or name, e.g. "iss" or 25544'),
        lat: z.number().min(-90).max(90).optional(),
        lon: z.number().min(-180).max(180).optional(),
        location: z.string().optional().describe('place name, geocoded if lat/lon omitted'),
        mode: z.enum(['visual', 'radio']).optional(),
      },
      async (args) => {
        const { tier, keyId } = getRequestContext();
        logUsage({ tool: 'get_pass_chart', tier, keyId, satellite: args.satellite });
        try {
          const res = await getPassChartTool(args, deps, tier);
          return res.pngBase64
            ? { content: [
                { type: 'image' as const, data: res.pngBase64, mimeType: 'image/png' },
                { type: 'text' as const, text: res.summary },
              ] }
            : { content: [{ type: 'text' as const, text: res.summary }] };
        } catch (e) { return asError(e); }
      },
    );
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: clean; `/api/mcp` builds. (If the SDK's tool return type rejects the image block, widen via the same shape the SDK exports — but `{ type: 'image', data, mimeType }` is the standard content type and should typecheck.)

- [ ] **Step 4: Commit**

```bash
git add lib/mcp/tools.mjs app/api/mcp/route.ts
git commit -m "feat(mcp): get_pass_chart tool returns an image + text content block"
```

---

## Task 6: list the tool on the discoverability surfaces

**Files:** Modify `lib/mcp/discovery.mjs`, `skills/seeksat/SKILL.md`.

- [ ] **Step 1: Add to `TOOL_SUMMARIES` in `lib/mcp/discovery.mjs`**

Append a sixth entry to the `TOOL_SUMMARIES` array:

```js
  { name: 'get_pass_chart', summary: 'A rendered polar sky chart (PNG) of the next pass — where to look, with the moon, planets, and stars in place.' },
```

- [ ] **Step 2: Add the same line to `skills/seeksat/SKILL.md`**

Under the `## Tools` list, add:

```markdown
- `get_pass_chart` — a rendered polar sky chart (PNG) of the next pass: where to look, with the moon, planets, and stars in place.
```

- [ ] **Step 3: Update the discovery test (it asserts the exact tool list)**

`test/mcp-discovery.test.mjs` has a test that `deepEqual`s `TOOL_SUMMARIES.map(t => t.name)` to the five original names — adding a sixth breaks it. Update that expected array to include the new tool, and the test title:

```js
test('TOOL_SUMMARIES lists the six tools in order', () => {
  assert.deepEqual(
    TOOL_SUMMARIES.map((t) => t.name),
    ['list_satellites', 'find_passes', 'get_position', 'next_visible_pass', 'get_pass_weather', 'get_pass_chart'],
  );
  for (const t of TOOL_SUMMARIES) assert.ok(t.summary.length > 0, `${t.name} has a summary`);
});
```

- [ ] **Step 4: Verify + build**

Run: `node --test test/mcp-discovery.test.mjs` → PASS.
Run: `npm run build` → `/llms.txt` + `/mcp` still build (they render the list from `TOOL_SUMMARIES`).

- [ ] **Step 5: Commit**

```bash
git add lib/mcp/discovery.mjs skills/seeksat/SKILL.md test/mcp-discovery.test.mjs
git commit -m "docs(mcp): list get_pass_chart on llms.txt / mcp page / SKILL.md"
```

---

## Task 7: Full verification + manual smoke

**Files:** none (verification only).

- [ ] **Step 1: Full suite + typecheck + build**

Run: `npm test && npm run typecheck && npm run build`
Expected: all green (new `rasterizeSvg`, `nextPassWindow`, `pass-chart` tests included).

- [ ] **Step 2: Manual MCP smoke (after deploy, against a seeded satellite)**

Call the tool and confirm an `image` block comes back. Against production (ISS is seeded):

```bash
curl -s -X POST https://seeksat.com/api/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_pass_chart","arguments":{"satellite":"ISS","location":"Tokyo","mode":"radio"}}}' \
  | sed 's/^data: //;/^event:/d;/^$/d' \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); cs=d["result"]["content"]; print([c["type"] for c in cs]); print("png bytes:", len(cs[0]["data"]) if cs[0]["type"]=="image" else "n/a")'
```
Expected: `['image', 'text']` and a multi-KB base64 length. (Locally, Edge Config is unset so the record is missing — verify locally via the `node:test` integration test instead, which uses a fixture TLE.)

- [ ] **Step 3: Final commit (only if manual fixups were needed)**

```bash
git add -A
git commit -m "chore(mcp): get_pass_chart verification fixups"
```

---

## Notes for the implementer

- **Reuse, don't re-render.** The chart SVG comes from the existing `renderPassChartSVG`; only `rasterizeSvg`'s width is new. Don't reimplement any painter.
- **Lazy import** `pass-chart.mjs` inside `getPassChartTool` so the resvg-wasm/linkedom pipeline isn't pulled into the module graph for the other five tools or their tests.
- **No React/route harness** — the route + the actual image bytes are verified by build + the manual curl; the pure/render logic is covered by `node:test` (the integration test runs the real DOM+resvg in node, mirroring `test/og/*`).
- **tz is out of scope** — the chart's time labels fall back to "browser local / tz unavailable" since the MCP observer has no `tz`. Fine for v1.
- **Determinism in tests:** fixed `nowMs` + fixture TLE + `mode: 'radio'` (no sun gate) guarantees a pass over the equator; `lat: 85` guarantees none for a 51.6°-inclination ISS.
