# Discoverability Surfaces — Design

**Date:** 2026-06-14
**Status:** Approved (pending spec review)
**Scope:** Spec C of a 3-part batch. (A = satellite selector + tiering, PR #6; B = MCP monetization seam, PR #7.) This branch (`seeksat-discoverability`) is stacked on B — the About pane and `/mcp` page describe the MCP and its tiering from A and B.

## Purpose

The MCP server is live but invisible: nothing on seeksat.com tells an agent or a human reviewer it exists. This spec adds four discoverability surfaces — `/llms.txt`, a hosted `/mcp` docs page, an in-app About pane, and a `SKILL.md` — fed by one shared content module so they can't drift. For a job-hunt portfolio piece, discoverability is most of the value: it turns a cool globe into a visible, agent-queryable product with a documented API.

## Background / current state

- `app/` is a Next.js App Router project. Existing routes: `app/page.tsx` (the globe), `app/api/*`, `app/robots.ts`, `app/sitemap.ts`. `app/layout.tsx` defines `SITE_URL = "https://seeksat.com"` and site metadata.
- The MCP lives at `/api/mcp` (Streamable HTTP), five tools registered in `app/api/mcp/route.ts`, pure handlers in `lib/mcp/tools.mjs`. Spec B added `tier` to `list_satellites` and a dormant key-gate.
- `docs/seeksat-mcp.md` (38 lines) already has the canonical Connect snippet, tool list, and Design-decisions prose — reused here.
- `components/PassFinderApp.tsx:93` renders a decorative `.brand-mark` (`pointer-events: none`, `aria-hidden`) top-right of the globe. The About button sits near it but is interactive.
- The repo is **private**, so GitHub links would 404 for reviewers — omitted by default behind a constant (see below).
- Tests: `node:test` over pure `.mjs`/`.js`; pages/components via typecheck + `next build` + manual.

## Shared content module (the anti-drift backbone)

`lib/mcp/discovery.mjs` (new, pure data) is the single source of the facts that appear on every surface:

```js
export const MCP_ENDPOINT_PATH = '/api/mcp';

export const TOOL_SUMMARIES = [
  { name: 'list_satellites',  summary: "What's trackable + each satellite's TLE freshness and tier." },
  { name: 'find_passes',      summary: 'Upcoming passes (magnitude, sunlit, quality) for a satellite over a location.' },
  { name: 'get_position',     summary: 'Live sub-point latitude/longitude, altitude, and sunlit state.' },
  { name: 'next_visible_pass', summary: 'One-call "when can I next see X from here?"' },
  { name: 'get_pass_weather', summary: 'Cloud-cover forecast + viewing probability (network-dependent).' },
];

// Pure builders so callers don't duplicate snippet strings. `origin` is
// the absolute site origin (e.g. "https://seeksat.com").
export function mcpUrl(origin) { return `${origin}${MCP_ENDPOINT_PATH}`; }
export function claudeAddCommand(origin) {
  return `claude mcp add --transport http seeksat ${mcpUrl(origin)}`;
}
export function mcpJsonConfig(origin) {
  return JSON.stringify({ mcpServers: { seeksat: { url: mcpUrl(origin) } } }, null, 2);
}

// Optional public repo link. Empty string = omit everywhere (repo is
// private). Set to the public URL to enable links on all surfaces at once.
export const GITHUB_URL = '';

// One-line access/tiering note (ties to Spec B). Surfaced on /mcp + About.
export const ACCESS_NOTE =
  'Free and open today. The server is key-gated-ready: premium satellites and higher limits can be enabled per API key without an API change.';
```

`SITE_URL` (`https://seeksat.com`) is imported from a shared location. To avoid a circular import with `app/layout.tsx`, extract the constant into `lib/site.mjs` (`export const SITE_URL = 'https://seeksat.com'`) and have `layout.tsx` import it; `discovery` consumers pass `SITE_URL` as `origin`.

## Surfaces

### 1. `/llms.txt` — `app/llms.txt/route.ts`

A Next.js route handler returning `text/plain`. A pure builder assembles the body so it is unit-testable:

`lib/mcp/llms-txt.mjs` → `buildLlmsTxt(origin)` returns the full text: a one-line site description, the MCP endpoint, the `claude mcp add` snippet, the tool list (from `TOOL_SUMMARIES`), and links to `/mcp` and the live endpoint. The route handler calls `buildLlmsTxt(SITE_URL)` and returns it with `Content-Type: text/plain; charset=utf-8` and a sensible `Cache-Control`.

### 2. `/mcp` docs page — `app/mcp/page.tsx`

A styled server component (hand-authored JSX, **no markdown dependency**) consuming `discovery.mjs`:
- **Hero** — "Same engine, two faces": the globe for humans, this MCP for agents.
- **Connect** — the endpoint, the `claudeAddCommand(SITE_URL)`, and the `mcpJsonConfig(SITE_URL)` block.
- **Tools** — a table rendered from `TOOL_SUMMARIES`.
- **Access** — the `ACCESS_NOTE` (free now, key-gated-ready).
- **Design decisions** — the three bullets from `docs/seeksat-mcp.md` (deterministic offline core; cron-cached epoch-guarded TLEs; engine reuse).
- A back-link to the globe (`/`) and, when `GITHUB_URL` is set, a repo link.
- `export const metadata` with `title: 'MCP Server'` (→ "MCP Server | SeekSat") and a fitting description. Styling reuses existing CSS idioms; a scoped `app/mcp/mcp.css` if needed.

### 3. About pane — `components/AboutPane.tsx`

A `"use client"` component: a small inconspicuous floating **ⓘ** button positioned near the brand-mark (interactive — its own element, not the `aria-hidden` mark), opening a lightweight **modal card** centered over the scene with a dimmed backdrop. Closes on Esc and backdrop/outside click. Contents:
- One-liner: what SeekSat is.
- "Agent-queryable via MCP" — the endpoint + a copy-to-clipboard `claudeAddCommand(SITE_URL)`.
- A "Full API docs →" link to `/mcp`.
- The stack line (Next.js · Cesium · satellite.js · SGP4), and a repo link only when `GITHUB_URL` is set.

Mounted in `components/PassFinderApp.tsx` next to the brand-mark. New styles in `app/pass-finder.css` (button + modal + backdrop), matching the dark-glass overlay idiom. Accessible: button `aria-label`, modal `role="dialog"` + `aria-modal`, focus the close control on open, Esc to close.

### 4. `SKILL.md` — `skills/seeksat/SKILL.md`

A shareable Claude skill wrapping the MCP. Frontmatter `name: seeksat`, `description:` a when-to-use line ("when the user asks where/when a satellite like the ISS is, or when it's next visible from a location"). Body: a one-paragraph overview, how to connect (the `claude mcp add` command + endpoint), the five tools with their one-liners, and 2–3 example prompts. Hand-authored markdown, kept consistent with `discovery.mjs` (not generated).

## Data flow

```
lib/site.mjs (SITE_URL)
        │
lib/mcp/discovery.mjs (TOOL_SUMMARIES, builders, GITHUB_URL, ACCESS_NOTE)
   ├─ lib/mcp/llms-txt.mjs buildLlmsTxt(origin) → app/llms.txt/route.ts
   ├─ app/mcp/page.tsx (server component)
   └─ components/AboutPane.tsx (client) ← mounted in PassFinderApp
SKILL.md  (static, mirrors the same facts)
```

## Error handling

- `/llms.txt` and `/mcp` are static-data renders with no I/O — no failure paths beyond build-time.
- About pane copy-to-clipboard: guard `navigator.clipboard` (may be undefined on insecure origins); on failure, no-op / leave the text selectable. Never throw.

## Testing

`node:test` (pure):
- `discovery.mjs`: `TOOL_SUMMARIES` has the five expected names; `mcpUrl`/`claudeAddCommand`/`mcpJsonConfig` produce the right strings for a sample origin; `mcpJsonConfig` parses back to the expected object.
- `llms-txt.mjs`: `buildLlmsTxt('https://seeksat.com')` contains the endpoint URL, every tool name, the `claude mcp add` command, and a `/mcp` link.

`/mcp` page, About pane, `llms.txt` route wiring, and `SKILL.md`: typecheck + `next build` + manual (open `/mcp`, `/llms.txt`, click the ⓘ button, copy the command). No React/route test harness.

## Out of scope

- Markdown rendering library for `/mcp` (hand-authored JSX instead).
- Submitting the MCP to any external registry/directory.
- Making the repo public / enabling GitHub links (one-line `GITHUB_URL` flip when ready).
- Changing the MCP server itself (Spec B is done) — this spec only describes it.

## Files affected

- **Add:** `lib/site.mjs`, `lib/mcp/discovery.mjs`, `lib/mcp/llms-txt.mjs`, `app/llms.txt/route.ts`, `app/mcp/page.tsx`, `components/AboutPane.tsx`, `skills/seeksat/SKILL.md`, `test/mcp-discovery.test.mjs`, `test/llms-txt.test.mjs`. Possibly `app/mcp/mcp.css`.
- **Modify:** `app/layout.tsx` (import `SITE_URL` from `lib/site.mjs`), `components/PassFinderApp.tsx` (mount `<AboutPane />`), `app/pass-finder.css` (About button + modal styles).
