# Dynamic per-pass OG images — design

**Date:** 2026-05-30
**Status:** Approved (pending spec review)

## Summary

When someone shares a SeekSat pass link (`/?s=<blob>`), the Open Graph /
Twitter preview image should show the **actual polar sky chart for that
pass**, rendered by the app's own chart painters — not the generic static
card. A Node route handler renders the chart on demand from the shared
state blob, composes it into the centered card design, rasterizes to PNG,
and serves it with CDN caching. The same rendering code also generates the
static `public/og.png`, replacing the current Python/`rsvg`/`fonttools`
build (the **static-build unification**).

## Goals

- Shared links light up with the real pass chart in social previews.
- Works for **every** `?s=` link (including hand-edited URLs) — no reliance
  on a prior "share" event or stored artifact.
- Pixel-faithful to the live fullscreen modal: reuse the existing painters
  (`paintPolarModalStatic` / arc / stars / constellations / sun-moon /
  events), exactly as the current static `og.png` already does.
- One rendering pipeline shared by the serverless route and the static
  build.

## Non-goals

- Multi-station composite visuals (globe with multiple pins). For
  multi-station links we render the **first** station's chart. (Revisit
  later if desired.)
- Re-implementing the chart in Satori/`next-og` (can't run our class-based
  `<style>` SVG; would diverge from the real renderer).
- Per-user analytics / signed share URLs / persistence of shares.

## Behavior

Given a request to `/?s=<blob>`:

1. `generateMetadata({ searchParams })` in `app/page.tsx` detects `s` and
   sets `og:image` + `twitter:image` to `/api/og?s=<blob>` (absolute via
   the existing `metadataBase`). No `s` → keep the static `/og.png`.
2. The crawler fetches `/api/og?s=<blob>`. The route:
   - Decodes the blob with the existing `decodeStateBlob`.
   - Picks the **first** station; resolves its IANA timezone.
   - Pass time: use the blob's `t` if present; otherwise compute the
     station's **next visible (dark-sky) pass**.
   - Renders the cropped circular chart via the shared module, composes
     the card, rasterizes to PNG (1200×630), returns it.
3. **Any failure** (malformed blob, no station, no pass found, TLE fetch
   failure) → `302` redirect to `/og.png`, so the link always has a valid
   preview image.

## Architecture

New shared modules under `lib/og/`, consumed by both entry points:

```
lib/og/
  render-pass-chart.mjs   # observer + pass + TLE + DOM -> cropped chart SVG
  build-card.mjs          # chart SVG + wordmark -> 1200x630 card SVG
  rasterize.mjs           # card SVG -> PNG buffer (resvg-js + bundled fonts)
  pass-select.mjs         # blob -> {observer, passTimeMs} (+ next-pass scan)
  tle.mjs                 # fetch ISS TLE with a short in-process TTL cache
  fonts/                  # committed TTFs: Exo2-Regular/SemiBold (subset),
                          #                 Arimo-Regular/Bold
app/api/og/route.ts       # Node runtime entry: ?s= -> PNG (or 302)
scripts/build-og-image.mjs # static entry: default location -> public/og.png
app/page.tsx              # + generateMetadata
```

Removed by the unification: `scripts/build-og-image.py`,
`scripts/render-real-chart.mjs` (logic folded into `lib/og/`), the
`/tmp/fontvenv` + `rsvg-convert` + `fonttools` + `jsdom`-only-for-build
dependencies. (`jsdom` stays — now a runtime dep for the route.)

### Module interfaces

- `renderPassChartSVG({ observer, passTimeMs, tle, dom }) -> string`
  Pure given its inputs. `dom` supplies `document` / `XMLSerializer`
  (jsdom in both contexts). `tle` is `{ line1, line2 }`. Runs the modal
  painter sequence (minus legend), strips the header/watermark/`.bg`, crops
  the viewBox to the disc, returns the chart SVG string. `passTimeMs`
  may be `null` → caller resolves the next pass first via `pass-select`.

- `buildCardSVG({ chartSVG }) -> string`
  Nests the chart centered, adds the Exo 2 wordmark + tagline + URL via
  `font-family` (fonts loaded by the rasterizer). Returns the 1200×630
  card SVG.

- `rasterizeCard(cardSVG) -> Buffer`
  `@resvg/resvg-js` with `font: { loadSystemFonts: false, fontBuffers:
  [...bundled TTFs] }`, fitTo width 1200. Returns PNG bytes.

- `selectPassFromBlob(decoded) -> { observer, passTimeMs }`
  Validates/clamps the first station (lat ∈ [-90,90], lon ∈ [-180,180],
  name length ≤ 40), returns `t` or the result of the next-visible-pass
  scan (the existing "scan N days for best visible pass" logic).

- `getIssTle() -> { line1, line2, name }`
  Module-scope TTL cache (~30 min). Same source order as
  `lib/pass-finder/tle.js`.

### Rendering & fonts

- **DOM:** jsdom provides `document`/`XMLSerializer`/`location` for the
  painters. (A ~150-line custom shim is a future bundle-size optimization;
  not in scope.)
- **Rasterizer:** `@resvg/resvg-js` — loads font buffers explicitly,
  solving "no system fonts in serverless." Renders the chart's class-based
  `<style>` CSS.
- **Fonts (bundled TTFs, committed):**
  - **Arimo** Regular/Bold for chart labels + tagline — metric-compatible
    with Arial/Helvetica, so it matches what the current `rsvg`-built
    `og.png` already produces (and the app's `-apple-system` fallback look)
    "basically identically." Apache-2.0, embeddable.
  - **Exo 2** Regular(400)/SemiBold(600), subset, for the wordmark — the
    same faces the app embeds. Generated to TTF by extending
    `scripts/build-exo2-embed.py` (it already downloads the Exo 2 variable
    font) to also emit static TTFs into `lib/og/fonts/`.
  - With real fonts loaded, the wordmark uses `font-family: 'Exo 2'`
    normally — the Python `fonttools` outline-path workaround is no longer
    needed.

### Pass selection

- Explicit `t`: `passWindowAtMsForObserver(observer, t, "visual", 10,
  issEcefAt)` to get the window the sharer was viewing; peak via
  `passPeakMs`.
- No `t`: the existing best-visible-pass scan (dark sky + sunlit ISS,
  highest peak) over a bounded window (≤ 45 days).

### Caching, cost, security, errors

- **Cache headers:**
  - Explicit `t` (deterministic): `public, s-maxage=86400,
    stale-while-revalidate=604800`.
  - No `t` (drifts with "now"): `public, s-maxage=3600,
    stale-while-revalidate=86400`.
  - Keyed by the full `?s=` query string → CDN serves repeats.
- **Cost:** bounded Node compute on Fluid; first hit per unique blob
  renders, the rest are CDN hits. TLE cached in-process.
- **Security:** inputs decoded then clamped (lat/lon ranges, name length,
  `t` within a sane absolute range); pass-search window bounded; no
  arbitrary code paths. Render is CPU-bounded.
- **Errors:** every failure path → `302` to `/og.png`.

### `generateMetadata`

`app/page.tsx` is already a server component. Add:

```ts
export async function generateMetadata(
  { searchParams }: { searchParams: Promise<{ s?: string }> }
): Promise<Metadata> {
  const { s } = await searchParams;
  if (!s) return {};                     // inherit layout's static og.png
  const img = `/api/og?s=${encodeURIComponent(s)}`;
  return {
    openGraph: { images: [{ url: img, width: 1200, height: 630 }] },
    twitter: { images: [img] },
  };
}
```

(Reading `searchParams` opts the page into dynamic rendering — acceptable;
it is a client SPA already.)

## Static-build unification

`scripts/build-og-image.mjs` becomes a thin entry that picks a default
location (env-overridable, e.g. Chicago) and calls the same `lib/og`
modules + `rasterize` to write `public/og.png`. The Python script,
`render-real-chart.mjs`, the `/tmp/fontvenv` venv, `fonttools`, and
`rsvg-convert` are removed. `package.json` may gain an `og:build` script.

## Testing

- **Unit:** `selectPassFromBlob` (first-station pick, clamping,
  `t`-present vs next-pass); `getIssTle` cache behavior; pass-finding
  against a committed TLE fixture (deterministic).
- **Integration:** `/api/og` returns a valid 1200×630 PNG for sample
  blobs — with `t`, without `t`, multi-station (uses first), and malformed
  (→ 302). Assert dimensions + content-type + cache headers.
- **Visual:** spot-check a couple of rendered cards (manual / committed
  golden thumbnails).

## Implementation order (de-risk first)

1. **Spike:** add `@resvg/resvg-js`, render the existing
   `render-real-chart.mjs` chart SVG with bundled Arimo + Exo 2 buffers;
   confirm class-based CSS + fonts render correctly. Fallback if not:
   flatten classes → inline styles before rasterizing.
2. Extract `lib/og/` modules from the current scripts.
3. Static unification: `build-og-image.mjs` reproduces today's `og.png`;
   delete the Python path.
4. `lib/og/pass-select.mjs` + `tle.mjs`.
5. `app/api/og/route.ts` + `generateMetadata` + error/cache handling.
6. Tests + a couple of golden visuals.

## Open risks

- **resvg-js CSS coverage** for our class-heavy chart (mitigated by the
  step-1 spike + the inline-style fallback).
- **jsdom bundle weight** in the function (acceptable for v1; shim later).
- **Font licensing** — Arimo (Apache-2.0) and Exo 2 (OFL) are both
  embeddable; commit their license files alongside the TTFs.
