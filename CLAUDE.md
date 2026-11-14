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
- Never call `/api/cron/*` or `/api/refresh-tle` by hand.
- `npm test` (node:test) and `npx tsc --noEmit` before a merge; the tests also guard the CSS tokens,
  allowed origins and accessibility rules.
