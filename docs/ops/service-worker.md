# Service worker: turning it off

SeekSat's worker (`public/sw.js`, registered by `components/SwRegister.tsx`)
saves pages, static chunks, star images and `/api/sats` answers for offline
use. If it ever serves something broken, there are two levers.

## Lever 1: NEXT_PUBLIC_SW_OFF=1

Set `NEXT_PUBLIC_SW_OFF=1` in the Vercel project and redeploy. The value is
read at build time, so a redeploy is required.

On the next page load, SwRegister registers nothing. It unregisters every
worker for the site and deletes every cache whose name starts with
`seeksat-`. The worker that is already running keeps control of open tabs
until they close or reload.

Use this when the new build still reaches the browser, that is when pages
load from the network.

To turn the worker back on, remove the variable and redeploy.

## Lever 2: the kill-switch sw.js

If a broken worker keeps answering from its cache, the new build never
reaches the page and lever 1 never runs. In that case, replace the whole
of `public/sw.js` with the body between `kill-switch:begin` and
`kill-switch:end` in its header comment (uncommented) and deploy.

The browser checks the worker script on navigation, even when the worker
answers the page itself. The query string the page
registers with (`/sw.js?v=<build>`) does not matter, because every version
fetches the same file. The kill-switch worker installs at once, deletes the
`seeksat-*` caches, unregisters itself and reloads each open window from
the network.

Keep the kill-switch file deployed until traffic from old workers has died
down, a few weeks. Then restore the real worker. Lever 1 can be used with it
so a fresh page does not register the worker again in the meantime.
