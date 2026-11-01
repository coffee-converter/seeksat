# Cesium Removal and Share Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the routed Cesium app (`/classic`) and move sharing to satellite pages, without breaking any existing link.
- Old `/?s=` and `/classic?s=` links open the ISS satellite page with their pass, mode, frequency and observers restored.
- New share links name the satellite.
- Every `.ics` file carries a link back.
- One copy of the chart CSS remains, and the CSP no longer allows Cesium's origins.

**Architecture:**
- **Share links:** a share is a path, `/sat/<id>/share/<blob>`, not a query string. That keeps `/sat/<id>` statically cached (ISR) while each share gets its own cached page and its own preview image.
- **Legacy links:** a tiny middleware turns `/?s=` and `/classic?s=` into that path.
- **Shared view:** on a satellite page, a shared view is page-local state laid over the visitor's own prefs. It never overwrites them.

**Tech Stack:** Next.js 15 App Router (ISR, middleware, `generateMetadata`), React 19, Zustand 5, satellite.js 6.0.2, resvg-wasm OG pipeline, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-30-any-satellite-tracker-design.md`, section 9: Cesium removed outright, old links open the ISS satellite page restored, new share links carry the satellite, `/classic?s=` redirects too. Anti-goal 5: don't break `/?s=` links or the MCP server. Plans 1 to 4 are done.

## Global Constraints

- **CelesTrak:** never call it from a developer machine. Tests are offline. The OG renderer reads the snapshot only (`getSnapshotRecord`).
- **Share links:** every link that works today keeps working: `/?s=<blob>`, `/classic?s=<blob>` and `/classic`. A broken or empty blob degrades to a plain page, never a 500.
- **Visitor prefs:** opening a shared link never changes the visitor's saved prefs (`seeksat.home.v1`).
- **Left alone:** `legacy/` and the unrouted triangulate tool (`components/TriangulateApp.tsx`, `components/triangulate/`, `lib/triangulate*.{js,ts}`, `lib/store.ts`, and the Cesium plumbing they import: `lib/cesium-*.ts(x)`, `lib/use-cesium-viewer.ts`, `lib/camera-controls.js`, `components/CesiumLoader.tsx`, `lib/use-body-class.ts`, `lib/types.ts`, `lib/tle-utils.ts`, `lib/pass-finder/tle.js`, `public/assets/stars/`). They must still type-check.
- **Look:** the sky chart and radio chart keep their exact look. Dark theme.
- **MCP:** tools and output unchanged.
- **Copy:** plain language, no em dashes. Quoted copy is exact.
- **Tests and commits:** `npm test`, `npx tsc --noEmit`. Conventional commit prefixes, no AI attribution lines.

## Review Focus

1. **A malformed, empty or observer-less legacy blob** (`/?s=garbage`, `/?s=`, `/classic?s=e30`). It lands on `/sat/25544` or `/`, never on an error. Pinned in Task 2 (`legacyRedirect`) and Task 4 (share route falls back).
2. **Observer names outside Latin-1** ("東京", "Zürich", an emoji). Today `btoa` throws on these, so such links could never be made. New links must round-trip them, and old Latin-1 blobs must still decode. Pinned in Task 1.
3. **A visitor with their own saved location opening a share.** They see the sender's view; `Use my location and settings` returns them to their own, and nothing in storage changed. Pinned in Task 4 (`effectiveSettings`) and its manual check.
4. **A shared pass that has already happened.** The page says so and still lists the current passes. Pinned in Task 4 (`findSharedRow`).
5. **A share for a satellite above NORAD 99999, or for one missing from the snapshot.** The preview image renders from OMM, or the route falls back to `/og.png`. Pinned in Task 3.

---

### Task 1: Share blob with a satellite, UTF-8 safe, plus classic state migration

**Files:**
- Modify: `lib/pass-finder/state-blob.js`, `test/state-blob.test.mjs`, `lib/home/prefs.mjs`, `test/home-prefs.test.mjs`
- Create: `lib/share/share-link.mjs`, `test/share-link.test.mjs`

**Interfaces:**
- Produces:
  - `encodeStateBlob(snap)`: `snap` gains an optional `noradId`, written as `n` whenever given. Encoding is UTF-8 then base64url (`TextEncoder`, then bytes to binary string, then `btoa`).
  - `decodeStateBlob(blob)` also returns `noradId: number | null`. It is null when `n` is absent or not a positive integer.
    - Decoding tries UTF-8 (`TextDecoder('utf-8', { fatal: true })`) and falls back to the raw Latin-1 string, so blobs made by the old encoder still decode.
    - Observers with latitude outside ±90 or longitude outside ±180 are dropped.
  - `lib/share/share-link.mjs`:
    - `sharePath(noradId, blob) -> "/sat/<id>/share/<blob>"`
    - `makeShareBlob({ noradId, observers, passMs = null, mode, freqHz = null, minElevDeg }) -> string`, which wraps `encodeStateBlob` (`activePassMs` = `passMs`, `downlinkHz` = `freqHz`).
    - `shareUrl(origin, opts) -> string`, which is `origin + sharePath(opts.noradId, makeShareBlob(opts))`.
  - `lib/home/prefs.mjs`: `loadPrefs` migrates the classic app's saved state when `PREFS_KEY` is absent.
    - It reads `LS_STATE_KEY` (`'iss-triangulation/state/v1'`) and decodes it.
    - The first observer becomes `location` (`source: 'coords'`, its name), the next ones up to 3 become `observers` (`obs-1`...), and mode and `minElevDeg` carry over.
    - The result is saved to `PREFS_KEY`, and the classic key is left in place.
    - Implement it as `migrateClassicState(storage) -> Prefs | null`, exported for tests.

- [ ] **Step 1: Write the failing tests**

```js
test('blob carries the satellite', () => {
  assert.equal(decodeStateBlob(encodeStateBlob({ observers: [OBS], noradId: 33591 })).noradId, 33591);
  assert.equal(decodeStateBlob(encodeStateBlob({ observers: [OBS] })).noradId, null);
});
test('non-Latin-1 names round-trip', () => {
  for (const name of ['東京', 'Zürich', 'Base 🛰️']) {
    assert.equal(decodeStateBlob(encodeStateBlob({ observers: [{ ...OBS, name }] })).observers[0].name, name);
  }
});
test('blobs from the old Latin-1 encoder still decode', () => {
  const old = btoa(JSON.stringify({ o: [['Zürich', 47.37, 8.54]], m: 'r', f: 437800000 }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const d = decodeStateBlob(old);
  assert.equal(d.observers[0].name, 'Zürich');
  assert.equal(d.downlinkHz, 437800000);
});
test('out-of-range observers are dropped', () => {
  assert.equal(decodeStateBlob(encodeStateBlob({ observers: [{ name: 'x', latDeg: 95, lonDeg: 0 }, OBS] })).observers.length, 1);
});
test('sharePath and shareUrl', () => {
  const url = shareUrl('https://seeksat.com', { noradId: 25544, observers: [OBS], passMs: 1, mode: 'radio', freqHz: 437800000, minElevDeg: 10 });
  assert.match(url, /^https:\/\/seeksat\.com\/sat\/25544\/share\/[A-Za-z0-9_-]+$/);
  const d = decodeStateBlob(url.split('/').at(-1));
  assert.deepEqual([d.noradId, d.passTimeMs, d.mode, d.downlinkHz], [25544, 1, 'radio', 437800000]);
});
test('classic saved state migrates once into home prefs', () => { /* memory storage holding only LS_STATE_KEY → loadPrefs gives location + observers + mode; PREFS_KEY now written */ });
test('existing home prefs win over classic state', () => {});
```

- [ ] **Step 2: Run** `node --test test/state-blob.test.mjs test/share-link.test.mjs test/home-prefs.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** as specified. Keep `LS_STATE_KEY`, `readPersistedBlob` and `writePersistedBlob` exported.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat: Add the satellite to share links, encode names as UTF-8 and carry over classic saved state"`.

---

### Task 2: Legacy share redirects in middleware

**Files:**
- Create: `lib/share/legacy-redirect.mjs`, `test/share-legacy-redirect.test.mjs`, `middleware.ts`
- Modify: `next.config.ts` (remove the `/?s=` → `/classic` redirect)

**Interfaces:**
- Consumes: `decodeStateBlob`, `sharePath` (Task 1).
- Produces:
  - `legacyRedirect(pathname: string, searchParams: URLSearchParams) -> string | null`:

    | Request | Redirect to |
    |---|---|
    | `/` with `s` that decodes with ≥1 observer | `sharePath(decoded.noradId ?? 25544, s)` |
    | `/` with `s` empty or bad | `/sat/25544` |
    | `/` without `s` | null (no redirect) |
    | `/classic` or `/classic/...` with a good `s` | `sharePath(decoded.noradId ?? 25544, s)` |
    | `/classic` or `/classic/...` with `s` empty or bad | `/sat/25544` |
    | `/classic` or `/classic/...` without `s` | `/` |

  - `middleware.ts` calls it and returns `NextResponse.redirect(new URL(target, req.url), 308)`. It has `export const config = { matcher: ['/', '/classic', '/classic/:path*'] }`.
  - With no `s` on `/`, the middleware is a pass-through, so `/` keeps its ISR.

- [ ] **Step 1: Write the failing tests:** every row of the table, plus `s=e30` (`{}`, no observers) → `/sat/25544`, and a blob made by the old encoder → `/sat/25544/share/<same blob>`.
- [ ] **Step 2: Run** `node --test test/share-legacy-redirect.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the helper and middleware, and remove the `next.config.ts` redirect and its comment.
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS, clean.
- [ ] **Step 5: Commit** with `git commit -m "feat: Redirect old share links to satellite pages"`.

---

### Task 3: Preview images for any satellite's shared pass

**Files:**
- Modify: `lib/og/tle.mjs`, `lib/og/render-og.mjs`, `lib/og/og-response.mjs`, `lib/og/og-metadata.mjs`, their tests in `test/og/`

**Interfaces:**
- Consumes: `satrecFromRecord` (`lib/sat/satrec.mjs`), `getCatalogReader().getSnapshotRecord`, `resolveSatellite`, `displayName`.
- Produces:
  - `getOgRecord(noradId, nowMs = Date.now(), reader = getCatalogReader()) -> Promise<record>`, from the snapshot.
    - The existing CORS fallbacks (wheretheiss, ivanstanojevic) are used only for 25544.
    - The 30-minute cache is now keyed by id.
    - It throws when nothing is found.
  - `ecefAtFactory(record)` builds from `satrecFromRecord`, so OMM-only (six-digit) objects work.
  - `renderOgPng(decoded, { noradId, getRecord = getOgRecord, nowMs, scanDays })`. The chart's `satName` is the curated short name, else the record name.
  - `ogResponse(req)` reads `s` and an optional `id`. The satellite is `decoded.noradId ?? Number(id) ?? 25544`. Any failure still 302s to `/og.png`.
  - `shareMetadata(baseMetadata, { noradId, blob }) -> Metadata`:
    - It returns `baseMetadata` with the images swapped to `/api/og?s=<blob>&id=<id>` (blob URL-encoded), in both `openGraph` and `twitter`.
    - It adds `robots: { index: false, follow: true }` and keeps `alternates.canonical = /sat/<id>`.
    - The old `ogImageMetadata` is removed.

- [ ] **Step 1: Write the failing tests:**
  - `renderOgPng` for a Meteor fixture record via an injected `getRecord` returns PNG bytes.
  - An OMM-only record with `noradId` 270001 renders.
  - `ogResponse` with a missing record 302s to `/og.png`.
  - `shareMetadata` swaps both image URLs, sets `robots`, and keeps the title, description and canonical.
- [ ] **Step 2: Run** `node --test test/og/*.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** as specified. Update the existing ISS tests to the new signatures.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat: Render share preview images for any satellite"`.

---

### Task 4: Shared view on satellite pages

**Files:**
- Create: `app/sat/[id]/share/[blob]/page.tsx`, `lib/sat/shared-view.mjs`, `test/sat-shared-view.test.mjs`
- Modify: `components/sat/SatApp.tsx`, `components/sat/PassSection.tsx`, `components/sat/ExtraObservers.tsx`, `components/passes/PassChartModals.tsx`, `app/sat.css`

**Interfaces:**
- Consumes:
  - `lookupSat`, `satPageData`, `satMetadata`, `satPath` (`lib/sat/page-data.mjs`)
  - `decodeStateBlob`, `sharePath`
  - `shareMetadata` (Task 3)
  - the existing `PassSection` internals
- Produces:
  - `lib/sat/shared-view.mjs`:
    - `sharedSettings(decoded) -> { observer, observers, mode, minElevDeg, passTimeMs, freqHz } | null`, or null when there are no observers.
      - `observer` = `{ name, latDeg, lonDeg }` of the first observer.
      - `observers` = the rest, at most 3, as `{ id: 'obs-<n>', name, latDeg, lonDeg }`.
    - `effectiveSettings(prefs, shared) -> { observer, observers, mode, minElevDeg, isShared }`. With `shared` it returns the shared values; otherwise it returns `prefs.location`, `prefs.observers`, `prefs.mode` and `prefs.minElevDeg`.
    - `findSharedRow(rows, passTimeMs, nowMs) -> { kind: 'row', key } | { kind: 'past', text } | null`.
      - `row`: a row whose pass contains `passTimeMs`.
      - `past`: when `passTimeMs < nowMs` and no row matches, with text `"The shared pass on <dayLabel> at <HH:MM> has already happened."`
      - null otherwise.
  - `app/sat/[id]/share/[blob]/page.tsx`:
    - `revalidate = 3600`, `dynamicParams = true`, `generateStaticParams() { return []; }`
    - It uses the same `lookupSat` flow as `/sat/[id]`. A non-canonical id redirects to `sharePath(id, blob)`.
    - A blob that decodes to no observers → `permanentRedirect(satPath(id))`.
    - It renders `<SatApp data={...} shared={decoded} />`.
    - `generateMetadata` = `shareMetadata(satMetadata(data), { noradId: id, blob })`.
  - `SatApp` gets a `shared?: Decoded | null` prop. It keeps the shared settings in local state, initialised from `sharedSettings(shared)`, and passes `effectiveSettings` down.
    - **Banner** (shown while shared): `"You're looking at a shared view from <name>."`, or `"You're looking at a shared view from <name> and <n> other places."` (`"1 other place"` singular).
    - **Button:** `"Use my location and settings"`. It clears the local shared state and calls `router.replace(satPath(id))`.
  - `PassSection` takes `settings` (the effective settings) plus `onModeChange` and `onMinElevChange` props instead of reading `prefs` directly.
    - In a shared view, mode and minimum elevation change the local shared state only.
    - `Change` location is hidden, and `ExtraObservers` is read-only: the chips have no remove buttons and there is no form. Add a `readOnly` prop.
    - The row that `findSharedRow` matches gets the class `pass-row--shared` and a tag `"shared pass"`, and is scrolled into view once.
    - A `past` result shows its text above the list.
  - `PassChartModals` gets an optional `preferredFreqHz` prop. When it is set, that value is used instead of `defaultDownlink` when the subject's satellite changes. `SatApp` passes the shared `freqHz`.

- [ ] **Step 1: Write the failing tests** for `sharedSettings` (extras capped at 3, ids `obs-1`...; null on no observers), `effectiveSettings` (prefs untouched in both branches; `isShared` set), and `findSharedRow` (match, past text, future-but-not-found gives null).
- [ ] **Step 2: Run** `node --test test/sat-shared-view.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the module, then the route and the component changes.
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS, clean.
- [ ] **Step 5: Commit** with `git commit -m "feat: Open shared links as a shared view on the satellite page"`.

---

### Task 5: Share buttons and calendar links

**Files:**
- Create: `components/sat/ShareButton.tsx`
- Modify: `components/sat/SatApp.tsx`, `components/sat/PassSection.tsx`, `components/home/NextUpList.tsx`

**Interfaces:**
- Consumes: `shareUrl` (Task 1), `settings` (Task 4).
- Produces:
  - `<ShareButton url={string} title={string} label="Share" />`.
    - It uses `navigator.share({ url, title })` when available, else `navigator.clipboard.writeText(url)`.
    - After copying, it shows `"Link copied"` for 2 s.
    - On failure, it shows `"Copy this link:"` with a read-only, select-on-focus 16 px input holding the URL.
    - A user cancelling `navigator.share` is not a failure.
  - **Satellite page:** a `Share` button in the header shares the current effective view without a pass. Each pass row gets a `Share` chip with `passMs: row.pass.peakMs`. Both use `window.location.origin` and the current settings: observers `[observer, ...observers]`, mode, minimum elevation, and the radio chart's chosen frequency if one was picked (else null).
  - **`.ics` files:** satellite page rows and home pass cards pass `url: shareUrl(window.location.origin, { noradId, observers, passMs: pass.peakMs, mode, freqHz: null, minElevDeg })`. Cards with pasted elements (`record.source === 'pasted'`) keep `url: null`.

- [ ] **Step 1: Build** as specified. There are no new pure modules; Task 1's tests cover the URL.
- [ ] **Step 2: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS, clean.
- [ ] **Step 3: Commit** with `git commit -m "feat: Add share links to satellite pages and links back in calendar files"`.

---

### Task 6: Remove the classic Cesium app

**Files:**
- Delete:
  - `app/classic/`
  - `components/PassFinderApp.tsx`, `components/OnboardingTour.tsx`, `components/AboutPane.tsx`
  - `components/passes/{AddObserverForm,MinElevControl,ModeToggle,ObserverCard,ObserversList,PageLoader,PlaybackControls,PolarModal,PolarPlot,RadioModal,SatellitePanel,SatelliteSelector,ShareButton,WindowsList}.tsx`
  - `lib/pass-finder-scene.js`, `lib/pass-finder-store.ts`, `lib/scene-bridge.ts`, `lib/onboarding/`
  - `lib/mirror/seed.mjs`, `lib/pass-finder/satellite-seed.js`, `lib/pass-finder/tle-seed.js`
  - `app/pass-finder.css`
  - the tests of deleted modules: `test/onboarding-tour.test.mjs`, `test/mirror-seed.test.mjs`, `test/satellite-seed.test.mjs`, `test/tle-seed.test.mjs`, `test/home-css-drift.test.mjs`, `test/no-iss-names.test.mjs` if it only scans the scene
- Modify:
  - `test/home-css.test.mjs`: assert the coarse-pointer rule in `app/home.css` only.
  - `test/bundle-split.test.mjs`: add a test that no page under `app/` reaches `lib/pass-finder-scene`, any `cesium` path, or `components/CesiumLoader`.
  - `components/home/HomeApp.tsx`, `components/sat/SatApp.tsx`: drop the `3D view` footer link.
  - `app/home.css`: comments that say "copied from pass-finder.css" or "classic" now say this is the chart style source.
  - `lib/pass-finder/polar-modal-frame.js`: its comment points at `app/home.css`.
  - `app/layout.tsx`:
    - `SITE_DESCRIPTION` becomes `"Track any satellite and find its passes from where you are, for radio or watching, with honest live numbers and polar sky charts."`
    - The keywords lose anything about globes.
  - `app/mcp/page.tsx`:
    - The lede becomes `"Same engine, two faces: the web app shows satellite pages and pass lists for people; this MCP server exposes the same SGP4 + visibility-physics engine to AI agents."`
    - The back link becomes `"← Back to SeekSat"`.
  - `README.md`:
    - Replace the globe description with a short paragraph on the home screen and satellite pages.
    - Remove the `docs/globe.png` reference.
    - Keep the triangulate paragraph and say it still uses CesiumJS from the CDN.
- Keep: everything in Global Constraints' "Left alone" list.

- [ ] **Step 1: Delete and rewire** as listed.
  - Run `grep -rn "PassFinderApp\|pass-finder-scene\|pass-finder-store\|scene-bridge\|/classic\|pass-finder.css\|readInitialSatelliteTles" app components lib test middleware.ts next.config.ts`.
  - Expected: the only hits are the `/classic` matcher and the tests in Task 2's files.
- [ ] **Step 2: Run** `npm test`, `npx tsc --noEmit` and `npm run build`. Expected: PASS, clean, and the build succeeds with no `/classic` route in the route list.
- [ ] **Step 3: Commit** with `git commit -m "refactor: Remove the classic 3D globe app"`.

---

### Task 7: Tighter CSP, global CSS cleanup, final check

**Files:**
- Create: `lib/site/csp.mjs`, `test/csp.test.mjs`
- Modify: `next.config.ts` (use `buildCsp`; drop the Cesium comment block and loader note), `app/globals.css`, `app/mcp/mcp.css`

**Interfaces:**
- Produces `buildCsp({ dev = false } = {}) -> string`:
  - `default-src 'self'`, `base-uri 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `form-action 'self'`
  - `script-src 'self' 'unsafe-inline'`, plus `'unsafe-eval'` only when `dev`, because Next's dev server needs it
  - `worker-src 'self' blob:`
  - `style-src 'self' 'unsafe-inline'`
  - `font-src 'self' data:`
  - `img-src 'self' data: blob:`
  - `connect-src 'self'` plus exactly the external origins that the client code of `/`, `/sat/*` and `/mcp` fetches. The implementer derives the list from the static import graph and states it in the report; expect `https://nominatim.openstreetmap.org` at least.
  - `upgrade-insecure-requests`
- `next.config.ts` passes `dev: process.env.NODE_ENV !== 'production'`.
- The `/assets/stars` cache header stays (the triangulate tool uses it).
- `app/globals.css`:
  - Remove the app-wide `user-select: none` rule, and the `.mcp` override in `mcp.css` that existed only to undo it.
  - Remove every rule whose selectors match no class or id in `app/`, `components/` or `lib/`, triangulate included.
  - List the removed selectors in the report.
- `test/csp.test.mjs`:
  - `buildCsp()` contains none of `cesium.com`, `arcgisonline`, `cartodb`, `tile.openstreetmap`, `celestrak.org` or `'unsafe-eval'`.
  - `buildCsp({ dev: true })` contains `'unsafe-eval'`.
  - Every `https://` origin found in source reachable from `components/home/HomeApp.tsx`, `components/sat/SatApp.tsx` and `app/mcp/page.tsx` is either in `connect-src` or listed in the test's `NOT_FETCHED` allowlist of link-only origins, such as `https://aaronhanson.dev`. Comments are stripped before scanning.

- [ ] **Step 1: Write** `test/csp.test.mjs`. **Run** it. Expected: FAIL (module not found).
- [ ] **Step 2: Implement** `buildCsp`, wire it, and clean the CSS.
- [ ] **Step 3: Run** `npm test`, `npx tsc --noEmit` and `npm run build`. Expected: PASS, clean, and the build succeeds. Report First Load JS for `/` and `/sat/[id]`.
- [ ] **Step 4: Commit** with `git commit -m "chore: Drop Cesium origins from the CSP and remove globe-only styles"`.
- [ ] **Step 5: Manual check for Aaron** on the Vercel preview after a push:
  1. An old link `/?s=<blob>` made by the classic app opens `/sat/25544/share/<blob>`. The banner names the first observer, the pass row is marked `shared pass`, and mode and frequency match. A `/classic?s=` link does the same, and `/classic` goes to `/`.
  2. `Use my location and settings` returns to your own location, and reloading `/` shows your prefs unchanged.
  3. `Share` on a satellite page row gives a link. Opening it in a private window shows the same view, and its preview image (paste it into Slack or iMessage) is that pass's sky chart for that satellite.
  4. An `.ics` from a satellite page and from a home card contains a working link.
  5. The browser console shows no CSP errors on `/`, `/sat/25544` and `/mcp`, and the geocoder still works.
  6. Text on satellite pages can be selected.
