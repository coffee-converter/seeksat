# CLAUDE.md – SeekSat

## Deploys

- `develop` is the working branch; Vercel builds a preview of every push.
- **Merging to `main` deploys seeksat.com.** Merge only with the owner's explicit go-ahead, through a PR from `develop`.

## After a deploy

Once the production deploy is live (check the commit status on GitHub, or the site itself):

1. **Run IndexNow only when the deploy changed what a search engine sees** – and only for what changed:
   - **Every page** (`npm run indexnow`, the whole live sitemap in batches of 10,000): site-wide changes
     to titles, descriptions, structured data or the sitemap itself, or a new kind of page.
   - **Just the pages that changed** (`npm run indexnow -- / /mcp /sat/25544`): a new or reworded page,
     or new page content on a few routes.
   - **Not at all**: styling, map or layout fixes, client-side behaviour, MCP tools, tests, docs. The
     pages' indexed content is the same, and resubmitting 17,000 unchanged URLs gains nothing.

   It reads the *live* sitemap, so run it only after the deploy has landed; earlier submits the previous
   build.

   **New satellites need no run.** The catalog refresh (`app/api/refresh-tle`, every 4 hours) submits
   the pages of satellites new to the snapshot, and of ones gone from it, through `lib/seo/indexnow.mjs`;
   the sitemap picks them up within the hour (it revalidates hourly).
   - IndexNow reaches Bing, Yandex, Seznam and others, not Google. Google reads
     `https://seeksat.com/sitemap.xml` through Search Console.
   - The key lives in `public/<key>.txt` (it is also hard-coded in `scripts/indexnow.mjs`). If the key ever
     changes, the first submission returns 403 `SiteVerificationNotCompleted` until IndexNow has fetched the
     new file. Retry after a few minutes.
2. Spot-check what changed on the live site. Link previews (share images) are cached by Discord, Slack
   and others, so old links can keep an old image for a while.

## Working rules

- Never call CelesTrak from a laptop (it blocks the IP). Local servers and scripts read SeekSat's own
  `/api/sats` or the snapshot; browser automation aborts `celestrak` and `nominatim` requests.
- Never call `/api/cron/*`, `/api/refresh-tle` or `/api/refresh-reception` by hand.
- Crons (`vercel.json`, UTC): the catalog refresh at :23 past every fourth hour from 00; the reception
  collector at :41 past every fourth hour from 02. Keep new ones off these hours and off round minutes.
  (Temporarily, for the first backfill, the collector runs at :41 every hour the refresh does not use;
  see `docs/backlog.md`.)
- `npm test` (node:test) and `npx tsc --noEmit` before a merge; the tests also guard the CSS tokens,
  allowed origins and accessibility rules.
- Pin new or bumped dependencies to versions at least two weeks old.

## Checking the app in a browser

`npx next build && npx next start -p 3100`, then Playwright at phone size (390×844 portrait, 844×390
landscape) and desktop. Seed `localStorage['seeksat.home.v1']` with a location and a few satellites, and
abort requests to CelesTrak and Nominatim. Tests and a type check do not show layout; for anything visual,
look at a screenshot before calling it done.

## Rules the tests enforce (and why they bite)

- **CSS:** spacing, font sizes and weights use tokens (`--sp-*`, `--fs-*`, `--fw-*`), not literals;
  `env()` in padding fails too. No `filter` outside the night-vision rules. Colours are theme tokens.
- **Origins:** every `https://` origin in code the browser can load must be in the CSP or marked
  link-only. Server-only strings (JSON-LD's schema.org, IndexNow's endpoint) go in server-only modules
  (`lib/sat/json-ld.mjs`, `lib/seo/`), not in files the client bundles (`lib/sat/page-data.mjs` is one).
- **Controls:** no raw `<button>`; use `components/ui` (a bespoke control goes on the allowlist).

## Where things live

- **Layouts:** `lib/ui/layout.ts` holds the media queries (side, stacked, phone pass view, desktop);
  `app/home.css` and `app/sat.css` use the same strings, and a test keeps them equal. Two rules at equal
  specificity that set `--map-h` resolve by file order; the pass view doubles its class to win.
- **Satellite colours:** `lib/map/palette.mjs` – one 10-colour palette for both themes (colour-blind
  checked, prefix-ordered), `SAT_CASING` under tracks and dots, `SAT_LABEL_INK` for light-map labels.
  `lib/map/palette.mjs` tests guard contrast and separation; change colours there and nowhere else.
- **Share images:** `lib/og/` (resvg). The fonts are bundled subsets (Atkinson: Latin and Latin
  Extended-A; Exo 2 for names and the wordmark); text the fonts cannot draw becomes coordinates
  (`lib/og/drawable.mjs`). The static home and MCP cards are built by `scripts/build-og-image.mjs` with
  `OG_RECORD_FILE` and `OG_NOW` pinned, so a rebuild changes only what was meant to change.
- **MCP server:** `app/api/mcp/route.ts`, tools in `lib/mcp/`. Tool descriptions (`lib/mcp/tool-specs.mjs`)
  are what agents read: changing one changes behaviour for every client. Heavy calls (scans, chart
  renders) go through `lib/mcp/heavy-gate.mjs`.
- **Catalog:** the snapshot in Blob, refreshed by the cron; `lib/mirror/`.
- **Radio reception:** `lib/reception/` sweeps SatNOGS Network observations (good and bad, a settled 6-hour
  window at a time, the last 7 days) into a 30-day per-transmitter tally in its own Blob file
  (`catalog/reception.json.gz`, never inside the snapshot). Data CC BY-SA 4.0; name the source wherever
  it shows.
  SatNOGS Network allows 60 observation requests an hour per IP without a token, 240 with one
  (`SATNOGS_API_TOKEN` in Vercel); the collector's per-run page budget stays under that.

## Writing

User-facing copy: plain words, short sentences, no em dashes. Say "Mercator" for the flat map.
