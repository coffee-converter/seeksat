# Discoverability Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the MCP discoverable to agents and humans via four surfaces — `/llms.txt`, a `/mcp` docs page, an in-app About pane, and `SKILL.md` — fed by one shared content module so they can't drift.

**Architecture:** `lib/site.mjs` (canonical origin) + `lib/mcp/discovery.mjs` (tool list + URL builders + flags) are the single source of truth. A pure `buildLlmsTxt` feeds the `/llms.txt` route; `app/mcp/page.tsx` and `components/AboutPane.tsx` consume `discovery.mjs` directly; `SKILL.md` mirrors the same facts. Pure modules are `node:test`-covered; pages/components via typecheck + build + manual.

**Tech Stack:** Next.js App Router (route handler + server component + client component), `node:test`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-14-discoverability-surfaces-design.md`

---

## File Structure

- **Create** `lib/site.mjs` — `SITE_URL`.
- **Create** `lib/mcp/discovery.mjs` — `TOOL_SUMMARIES`, `mcpUrl`/`claudeAddCommand`/`mcpJsonConfig`, `GITHUB_URL`, `ACCESS_NOTE`.
- **Create** `lib/mcp/llms-txt.mjs` — `buildLlmsTxt(origin)`.
- **Create** `app/llms.txt/route.ts` — serves `/llms.txt`.
- **Create** `app/mcp/page.tsx` + `app/mcp/mcp.css` — the docs page.
- **Create** `components/AboutPane.tsx` — ⓘ button + modal.
- **Create** `skills/seeksat/SKILL.md` — the packaged skill.
- **Modify** `app/layout.tsx` (import `SITE_URL`), `components/PassFinderApp.tsx` (mount `<AboutPane />`), `app/pass-finder.css` (About styles).
- **Tests** `test/mcp-discovery.test.mjs`, `test/llms-txt.test.mjs`.

---

## Task 1: `lib/site.mjs` + layout import

**Files:** Create `lib/site.mjs`; Modify `app/layout.tsx`.

- [ ] **Step 1: Create `lib/site.mjs`**

```js
// lib/site.mjs — canonical site origin. Single source shared by the
// page metadata (app/layout.tsx) and the discoverability surfaces
// (lib/mcp/discovery.mjs consumers) so the URL can't drift.
export const SITE_URL = "https://seeksat.com";
```

- [ ] **Step 2: Use it in `app/layout.tsx`**

Add to the imports near the top:

```ts
import { SITE_URL } from "@/lib/site.mjs";
```

Delete the existing local declaration (the comment block + `const SITE_URL = "https://seeksat.com";`, around lines 8–11). Leave `SITE_NAME`, `SITE_TITLE`, etc. unchanged — only `SITE_URL` moves.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean (`SITE_URL` still resolves in `metadataBase: new URL(SITE_URL)`).

- [ ] **Step 4: Commit**

```bash
git add lib/site.mjs app/layout.tsx
git commit -m "refactor: extract SITE_URL to lib/site.mjs"
```

---

## Task 2: `lib/mcp/discovery.mjs` — shared content module

**Files:** Create `lib/mcp/discovery.mjs`; Test `test/mcp-discovery.test.mjs`.

- [ ] **Step 1: Write the failing test**

Create `test/mcp-discovery.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_SUMMARIES, mcpUrl, claudeAddCommand, mcpJsonConfig } from '../lib/mcp/discovery.mjs';

test('TOOL_SUMMARIES lists the five tools in order', () => {
  assert.deepEqual(
    TOOL_SUMMARIES.map((t) => t.name),
    ['list_satellites', 'find_passes', 'get_position', 'next_visible_pass', 'get_pass_weather'],
  );
  for (const t of TOOL_SUMMARIES) assert.ok(t.summary.length > 0, `${t.name} has a summary`);
});

test('mcpUrl + claudeAddCommand build from an origin', () => {
  assert.equal(mcpUrl('https://seeksat.com'), 'https://seeksat.com/api/mcp');
  assert.equal(
    claudeAddCommand('https://seeksat.com'),
    'claude mcp add --transport http seeksat https://seeksat.com/api/mcp',
  );
});

test('mcpJsonConfig parses back to the expected object', () => {
  const cfg = JSON.parse(mcpJsonConfig('https://seeksat.com'));
  assert.equal(cfg.mcpServers.seeksat.url, 'https://seeksat.com/api/mcp');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/mcp-discovery.test.mjs`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement `lib/mcp/discovery.mjs`**

```js
// lib/mcp/discovery.mjs — canonical facts about the MCP server, shared
// by every discoverability surface (/llms.txt, /mcp page, About pane) so
// they can't drift. Pure data + string builders; no I/O.

export const MCP_ENDPOINT_PATH = '/api/mcp';

export const TOOL_SUMMARIES = [
  { name: 'list_satellites', summary: "What's trackable + each satellite's TLE freshness and tier." },
  { name: 'find_passes', summary: 'Upcoming passes (magnitude, sunlit, quality) for a satellite over a location.' },
  { name: 'get_position', summary: 'Live sub-point latitude/longitude, altitude, and sunlit state.' },
  { name: 'next_visible_pass', summary: 'One-call "when can I next see X from here?"' },
  { name: 'get_pass_weather', summary: 'Cloud-cover forecast + viewing probability (network-dependent).' },
];

// `origin` is the absolute site origin, e.g. "https://seeksat.com".
export function mcpUrl(origin) {
  return `${origin}${MCP_ENDPOINT_PATH}`;
}

export function claudeAddCommand(origin) {
  return `claude mcp add --transport http seeksat ${mcpUrl(origin)}`;
}

export function mcpJsonConfig(origin) {
  return JSON.stringify({ mcpServers: { seeksat: { url: mcpUrl(origin) } } }, null, 2);
}

// Optional public repo link. Empty string = omit links everywhere (the
// repo is private). Set to the public URL to enable links at once.
export const GITHUB_URL = '';

// One-line access/tiering note (ties to the monetization seam). Surfaced
// on the /mcp page and the About pane.
export const ACCESS_NOTE =
  'Free and open today. The server is key-gated-ready: premium satellites and ' +
  'higher rate limits can be enabled per API key without an API change.';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/mcp-discovery.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/mcp/discovery.mjs test/mcp-discovery.test.mjs
git commit -m "feat(mcp): shared discovery content module (tools, URL builders)"
```

---

## Task 3: `/llms.txt` — builder + route

**Files:** Create `lib/mcp/llms-txt.mjs`, `app/llms.txt/route.ts`; Test `test/llms-txt.test.mjs`.

- [ ] **Step 1: Write the failing test**

Create `test/llms-txt.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLlmsTxt } from '../lib/mcp/llms-txt.mjs';

test('buildLlmsTxt includes endpoint, add-command, every tool, and the /mcp link', () => {
  const txt = buildLlmsTxt('https://seeksat.com');
  assert.ok(txt.includes('https://seeksat.com/api/mcp'), 'endpoint');
  assert.ok(txt.includes('claude mcp add'), 'add command');
  assert.ok(txt.includes('list_satellites'), 'first tool');
  assert.ok(txt.includes('get_pass_weather'), 'last tool');
  assert.ok(txt.includes('https://seeksat.com/mcp'), 'docs link');
  assert.ok(txt.startsWith('# SeekSat'), 'llms.txt heading');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/llms-txt.test.mjs`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement `lib/mcp/llms-txt.mjs`**

```js
// lib/mcp/llms-txt.mjs — pure builder for the /llms.txt body. Follows the
// llms.txt convention (plain text, markdown-ish headings + links) and
// points agents at the MCP. Testable without the route.

import { TOOL_SUMMARIES, mcpUrl, claudeAddCommand } from './discovery.mjs';

export function buildLlmsTxt(origin) {
  return [
    '# SeekSat',
    '',
    '> Satellite & ISS pass forecasts. The same SGP4 + visibility engine that',
    '> powers the 3D web app is exposed to AI agents over MCP.',
    '',
    '## MCP server',
    '',
    `Streamable HTTP endpoint: ${mcpUrl(origin)}`,
    '',
    `Add to Claude Code: ${claudeAddCommand(origin)}`,
    '',
    '## Tools',
    '',
    ...TOOL_SUMMARIES.map((t) => `- ${t.name}: ${t.summary}`),
    '',
    '## Docs',
    '',
    `- ${origin}/mcp — human-readable MCP documentation`,
    '',
  ].join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/llms-txt.test.mjs`
Expected: PASS.

- [ ] **Step 5: Create the route `app/llms.txt/route.ts`**

```ts
// app/llms.txt/route.ts — serves /llms.txt. A route handler (not a static
// public/ file) so it shares lib/mcp/discovery.mjs and can't drift.
import { SITE_URL } from '@/lib/site.mjs';
import { buildLlmsTxt } from '@/lib/mcp/llms-txt.mjs';

export const dynamic = 'force-static';

export function GET() {
  return new Response(buildLlmsTxt(SITE_URL), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  });
}
```

- [ ] **Step 6: Build + verify the route resolves**

Run: `npm run build`
Expected: compiles; the build output lists a `/llms.txt` route. If Next.js does not register the dotted folder as a route, report it (fallback would be `app/llms[.]txt` is not needed — `app/llms.txt/route.ts` is the supported form).

- [ ] **Step 7: Commit**

```bash
git add lib/mcp/llms-txt.mjs app/llms.txt/route.ts test/llms-txt.test.mjs
git commit -m "feat: /llms.txt agent-discovery surface"
```

---

## Task 4: `/mcp` docs page

**Files:** Create `app/mcp/page.tsx`, `app/mcp/mcp.css`.

- [ ] **Step 1: Create `app/mcp/mcp.css`**

```css
.mcp-doc {
  max-width: 760px; margin: 0 auto; padding: 56px 22px 96px;
  color: #cfe0ff; background: #0a0e1a; min-height: 100vh;
  font: 15px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.mcp-doc h1 {
  font-family: 'Exo 2', -apple-system, sans-serif; font-weight: 600;
  font-size: 30px; letter-spacing: 0.01em; margin: 0 0 8px;
}
.mcp-doc h1 .seek { color: #8aa0c8; }
.mcp-doc h1 .sat { color: #7eb8ff; }
.mcp-doc .lede { opacity: 0.8; margin: 0 0 8px; }
.mcp-doc h2 { font-size: 18px; margin: 40px 0 12px; color: #eaf1ff; }
.mcp-doc p { margin: 0 0 12px; }
.mcp-doc pre {
  background: #0c1322; border: 1px solid rgba(255,255,255,0.12);
  border-radius: 8px; padding: 12px 14px; overflow-x: auto; margin: 0 0 14px;
}
.mcp-doc pre code { font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color: #d6e6ff; }
.mcp-doc table { width: 100%; border-collapse: collapse; margin: 0 0 12px; }
.mcp-doc th, .mcp-doc td {
  text-align: left; padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.1);
  vertical-align: top;
}
.mcp-doc th { opacity: 0.6; font-weight: 600; }
.mcp-doc td code { color: #7eb8ff; font: 13px ui-monospace, monospace; white-space: nowrap; }
.mcp-doc ul { padding-left: 18px; margin: 0 0 12px; }
.mcp-doc li { margin: 0 0 8px; }
.mcp-doc footer { margin-top: 48px; opacity: 0.7; }
.mcp-doc a { color: #7eb8ff; }
```

- [ ] **Step 2: Create `app/mcp/page.tsx`**

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { SITE_URL } from "@/lib/site.mjs";
import {
  TOOL_SUMMARIES, mcpUrl, claudeAddCommand, mcpJsonConfig, ACCESS_NOTE, GITHUB_URL,
} from "@/lib/mcp/discovery.mjs";
import "./mcp.css";

export const metadata: Metadata = {
  title: "MCP Server",
  description:
    "Query SeekSat's satellite pass & position engine from AI agents over the Model Context Protocol.",
  alternates: { canonical: "/mcp" },
};

export default function McpDocsPage() {
  return (
    <main className="mcp-doc">
      <header>
        <h1><span className="seek">Seek</span><span className="sat">Sat</span> MCP</h1>
        <p className="lede">
          Same engine, two faces: the web app renders satellite passes in a 3D globe for
          humans; this MCP server exposes the same SGP4 + visibility-physics engine to AI agents.
        </p>
      </header>

      <section>
        <h2>Connect</h2>
        <p>Streamable HTTP endpoint:</p>
        <pre><code>{mcpUrl(SITE_URL)}</code></pre>
        <p>Add to Claude Code:</p>
        <pre><code>{claudeAddCommand(SITE_URL)}</code></pre>
        <p>Or in an MCP client config:</p>
        <pre><code>{mcpJsonConfig(SITE_URL)}</code></pre>
      </section>

      <section>
        <h2>Tools</h2>
        <table>
          <thead><tr><th>Tool</th><th>What it does</th></tr></thead>
          <tbody>
            {TOOL_SUMMARIES.map((t) => (
              <tr key={t.name}><td><code>{t.name}</code></td><td>{t.summary}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Access</h2>
        <p>{ACCESS_NOTE}</p>
      </section>

      <section>
        <h2>Design decisions</h2>
        <ul>
          <li><strong>Deterministic, offline core.</strong> Pass geometry, magnitude, and
            visibility run with zero network calls; weather is the only network-dependent tool
            and is deliberately separate.</li>
          <li><strong>Cron-cached, epoch-guarded TLEs.</strong> A 6-hour cron refreshes TLEs
            into Edge Config; requests read from the cache (sub-ms), never upstream. A flaky
            source returning an older element set can&apos;t clobber good data, and an upstream
            outage just means serving the last-known-good TLE — still SGP4-valid for days.</li>
          <li><strong>Engine reuse.</strong> Every pass number comes from the same unit-tested
            <code> lib/pass-finder/*</code> modules that drive the web app, so the two faces
            can&apos;t drift.</li>
        </ul>
      </section>

      <footer>
        <Link href="/">← Back to the globe</Link>
        {GITHUB_URL && (
          <> · <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">Source</a></>
        )}
      </footer>
    </main>
  );
}
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: clean; build lists a `/mcp` route.

- [ ] **Step 4: Commit**

```bash
git add app/mcp/page.tsx app/mcp/mcp.css
git commit -m "feat: hosted /mcp documentation page"
```

---

## Task 5: About pane

**Files:** Create `components/AboutPane.tsx`; Modify `components/PassFinderApp.tsx`, `app/pass-finder.css`.

- [ ] **Step 1: Create `components/AboutPane.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { SITE_URL } from "@/lib/site.mjs";
import { mcpUrl, claudeAddCommand, GITHUB_URL } from "@/lib/mcp/discovery.mjs";

// Inconspicuous "ⓘ" button near the brand-mark that opens a small modal
// card surfacing the MCP endpoint + a copy-able connect command, with a
// link to the full /mcp docs. Esc and backdrop click close it.
export default function AboutPane() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const copyCmd = async () => {
    try {
      await navigator.clipboard?.writeText(claudeAddCommand(SITE_URL));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (insecure origin) — the command stays selectable */
    }
  };

  return (
    <>
      <button
        type="button"
        className="about-button"
        aria-label="About SeekSat and its MCP API"
        onClick={() => setOpen(true)}
      >
        i
      </button>
      {open && (
        <div className="about-backdrop" onClick={() => setOpen(false)}>
          <div
            className="about-modal"
            role="dialog"
            aria-modal="true"
            aria-label="About SeekSat"
            onClick={(e) => e.stopPropagation()}
          >
            <button ref={closeRef} type="button" className="about-close" aria-label="Close" onClick={() => setOpen(false)}>
              ×
            </button>
            <h2 className="about-title"><span className="seek">Seek</span><span className="sat">Sat</span></h2>
            <p>Satellite &amp; ISS pass forecasts — a 3D globe with multi-station overhead timing and per-pass sky charts.</p>
            <h3>Agent-queryable via MCP</h3>
            <p>The same SGP4 + visibility engine is exposed to AI agents over the Model Context Protocol:</p>
            <code className="about-endpoint">{mcpUrl(SITE_URL)}</code>
            <button type="button" className="about-copy" onClick={copyCmd}>
              {copied ? "Copied!" : "Copy connect command"}
            </button>
            <p className="about-links">
              <a href="/mcp">Full API docs →</a>
              {GITHUB_URL && (
                <> · <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">Source</a></>
              )}
            </p>
            <p className="about-stack">Next.js · Cesium · satellite.js · SGP4</p>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Mount it in `components/PassFinderApp.tsx`**

Add the import with the other component imports:

```tsx
import AboutPane from "@/components/AboutPane";
```

Immediately after the `brand-mark` div (the `<div className="brand-mark" aria-hidden="true">…</div>` block around line 93), add:

```tsx
      <AboutPane />
```

- [ ] **Step 3: Add styles to `app/pass-finder.css`**

Append:

```css
/* About button (near the brand-mark) + modal */
.about-button {
  position: absolute; top: 40px; right: 18px; z-index: 1001;
  width: 22px; height: 22px; border-radius: 50%;
  display: grid; place-items: center; cursor: pointer;
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.18);
  color: #b9cdf0; font: italic 600 13px/1 Georgia, serif; opacity: 0.6;
}
.about-button:hover { opacity: 1; }
.about-backdrop {
  position: fixed; inset: 0; z-index: 2000; display: grid; place-items: center;
  background: rgba(4,8,18,0.6); backdrop-filter: blur(2px);
}
.about-modal {
  position: relative; width: min(440px, calc(100vw - 32px));
  background: #0c1322; border: 1px solid rgba(255,255,255,0.14); border-radius: 12px;
  padding: 22px 22px 18px; color: #cfe0ff; box-shadow: 0 18px 60px rgba(0,0,0,0.6);
  font: 14px/1.6 -apple-system, BlinkMacSystemFont, sans-serif;
}
.about-modal h3 { font-size: 14px; margin: 16px 0 6px; color: #eaf1ff; }
.about-modal p { margin: 0 0 10px; opacity: 0.9; }
.about-title { font-family: 'Exo 2', sans-serif; font-weight: 600; font-size: 22px; margin: 0 0 10px; }
.about-title .seek { color: #8aa0c8; }
.about-title .sat { color: #7eb8ff; }
.about-close {
  position: absolute; top: 10px; right: 12px; width: 26px; height: 26px;
  background: transparent; border: 0; color: #9fb4da; font-size: 20px; cursor: pointer;
}
.about-endpoint {
  display: block; background: #0a0f1c; border: 1px solid rgba(255,255,255,0.12);
  border-radius: 6px; padding: 8px 10px; font: 12px ui-monospace, monospace;
  color: #d6e6ff; word-break: break-all; margin: 0 0 10px;
}
.about-copy {
  cursor: pointer; background: rgba(90,140,255,0.18); border: 1px solid rgba(126,184,255,0.4);
  color: #dce9ff; border-radius: 6px; padding: 7px 12px; font: inherit; font-size: 13px;
}
.about-links { margin: 14px 0 6px; }
.about-links a { color: #7eb8ff; }
.about-stack { font-size: 12px; opacity: 0.55; margin: 0; }
```

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add components/AboutPane.tsx components/PassFinderApp.tsx app/pass-finder.css
git commit -m "feat: in-app About pane surfacing the MCP endpoint"
```

---

## Task 6: `SKILL.md`

**Files:** Create `skills/seeksat/SKILL.md`.

- [ ] **Step 1: Create `skills/seeksat/SKILL.md`**

```markdown
---
name: seeksat
description: Use when the user asks where a satellite (like the ISS, Hubble, Tiangong) is right now, or when it will next be visible / pass over a location — connects to the SeekSat MCP server for SGP4-accurate passes, positions, and viewing conditions.
---

# SeekSat

SeekSat answers "where is this satellite and when can I see it?" using the same
SGP4 + visibility engine that powers the SeekSat 3D web app, exposed over MCP.

## Connect

Streamable HTTP endpoint: `https://seeksat.com/api/mcp`

```bash
claude mcp add --transport http seeksat https://seeksat.com/api/mcp
```

## Tools

- `list_satellites` — what's trackable + each satellite's TLE freshness and tier.
- `find_passes` — upcoming passes (magnitude, sunlit, quality) for a satellite over a location.
- `get_position` — live sub-point latitude/longitude, altitude, and sunlit state.
- `next_visible_pass` — one-call "when can I next see X from here?"
- `get_pass_weather` — cloud-cover forecast + viewing probability (network-dependent).

Locations accept either `lat`/`lon` or a place-name string (geocoded). Passes
carry a `quality` score and `tier`/freshness metadata.

## Example prompts

- "When can I next see the ISS from Tokyo?"
- "Is the ISS sunlit right now, and where is it?"
- "Find tonight's visible passes of Tiangong over Paris, and will it be cloudy?"
```

- [ ] **Step 2: Commit**

```bash
git add skills/seeksat/SKILL.md
git commit -m "feat: SKILL.md packaging the SeekSat MCP as a Claude skill"
```

---

## Task 7: Full verification + manual smoke

**Files:** none (verification only).

- [ ] **Step 1: Full suite + typecheck + build**

Run: `npm test && npm run typecheck && npm run build`
Expected: all tests pass (including the new `mcp-discovery` and `llms-txt` suites); typecheck + build clean; build output lists `/llms.txt` and `/mcp` routes.

- [ ] **Step 2: Manual smoke (`npm run dev`)**

- `GET /llms.txt` → plain-text body with the endpoint, tools, `claude mcp add` command, and `/mcp` link.
- `GET /mcp` → styled docs page: hero, Connect snippets, Tools table (5 rows), Access note, Design decisions, "Back to the globe".
- `/` → the small **ⓘ** button shows near the brand-mark (top-right); clicking opens the modal; "Copy connect command" copies; Esc and backdrop click close it; "Full API docs →" navigates to `/mcp`.
- No GitHub links appear anywhere (GITHUB_URL is empty).

- [ ] **Step 3: Final commit (only if manual fixups were needed)**

```bash
git add -A
git commit -m "chore: discoverability surfaces verification fixups"
```

---

## Notes for the implementer

- **DRY is the point:** every surface pulls from `lib/mcp/discovery.mjs` (and `SITE_URL` from `lib/site.mjs`). Do not hardcode the endpoint or tool list in the page/About/route — import the builders. `SKILL.md` is static markdown (can't import JS); keep its facts matching `discovery.mjs`.
- **`.mjs` into `.ts`/`.tsx`** imports already work here (the route imports `tle-store.mjs`; the layout will import `site.mjs`).
- **`GITHUB_URL` is intentionally empty** — links are conditionally rendered, so nothing dead appears. One edit enables every link if the repo goes public.
- **No new dependencies** — the `/mcp` page is hand-authored JSX, not rendered markdown.
- **No React/route test harness** — `/llms.txt` route, `/mcp` page, and About pane are verified by typecheck + build + the manual smoke; only the pure `discovery`/`llms-txt` modules get `node:test`.
- **If `app/llms.txt/route.ts` does not register as `/llms.txt`** in the build output, report it as BLOCKED with the build output rather than guessing — but the dotted-folder route handler is the supported Next.js form for this.
