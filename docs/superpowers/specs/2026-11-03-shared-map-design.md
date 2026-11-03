# Shared Map Design

**Date:** 2026-11-03
**Status:** Approved direction. Aaron asked whether tapping a satellite should switch the right drawer to its details. We kept a tap as "focus", and agreed the real gap is that moving between `/` and `/sat/<id>` builds a new map. He said yes to fixing that first.

## Why

`/` (HomeApp) and `/sat/<id>` (SatApp) each render their own `MapShell` and `FlatMap`. Moving between them unmounts one MapLibre map and builds another:
- the camera resets;
- the tiles reload;
- the header, clock and theme controls re-render.

Opening a satellite's page should feel like the drawer switching, with the map left exactly where it was.

## Behaviour

1. **The map stays mounted.** It stays across every move between `/`, `/sat/<id>` and `/sat/<id>/share/<blob>`: Open page, Back and Forward, a search result, "Your satellites", and the wordmark. The camera, zoom, projection and loaded tiles are unchanged. Only the satellites drawn and the focus change, as each page asks.
2. **What each page draws is unchanged.** Each page still decides the map's satellites, focus, chips, focus bar and the content above the map, exactly as it does today:
   - **Home:** `?focus=`, chips, the focus bar, the location prompt and the Next strip.
   - **Satellite page:** the satellite focused, `?map=all`, chips after Show all, and the focus bar.
3. **The camera only moves when focus moves.** It moves when the focused satellite changes, as `FlatMap` already does. Opening the page of the satellite already focused does not move the camera.
4. **The header is shared.**
   - It holds the wordmark, the search, the live clock, the theme and Night vision.
   - The wordmark is an `<h1>` on `/` and a link to `/` on the other pages, as today.
   - A search result does what the current page does today: on home it focuses the satellite, and on a satellite page it opens that satellite's page.
5. **The drawer starts at the top.** The right drawer (the panel) scrolls back to the top when the page changes.
6. **Server rendering stays.**
   - A satellite page's drawer is still rendered on the server: the title, the facts, the metadata and the OG image.
   - The map stays client-only, as today.
   - Before mount the live clock shows dashes on every page, as it already does on home.
7. **Back closes an open chart.** This still works on both pages, since the charts live in the page drawer.
8. **Not found.** A satellite that is not found shows its "Satellite not found" message in the drawer, with the map beside it.

## Unchanged

- **URLs:** every URL, `?focus=`, `?map=all` and the share paths.
- **Store:** the zustand store (`lib/home/store.ts`). It is module state, so it already survives client navigation.
- **Stylesheets:** home.css and sat.css. The `.map-shell.sat` class comes from the pathname, so it is right on the server render.
- **Other routes:** `/mcp`, the API routes and the root not-found page are outside the map layout.

## Constraints

- **Network:** never call CelesTrak from Aaron's laptop.
- **Copy:** no em dashes in new copy.
- **Hydration:** no hydration mismatch. Anything the server cannot know (the scene from a page effect, the clock) starts empty on both server and client.
