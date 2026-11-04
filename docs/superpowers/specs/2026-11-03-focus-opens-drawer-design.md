# Focus Opens the Drawer Design

**Date:** 2026-11-03
**Status:** Approved direction ("seems good"). Built on the shared map (`2026-11-03-shared-map-design.md`), which keeps one map mounted across `/` and `/sat/<id>`.

## Why

Focusing a satellite on home moves the map but leaves the drawer on the list. A satellite's details are hard to find:
- **"Open page":** the button on the focus bar has a vague label.
- **"Details":** the link on its card is down the list, so you have to scroll to Next up.
- **Search:** on home a result only focuses.

With the map shared, switching the drawer no longer rebuilds the map, so focus can simply mean "show this satellite's drawer", as in a map app.

## Behaviour

1. **Focusing opens the page.** Focusing a satellite pushes `/sat/<id>`. That covers:
   - a tap on its dot on the map;
   - its chip;
   - a search result;
   - the Next strip;
   - a card's headline.

   The map keeps its view and focuses that satellite (it centres on it, as focus does today). The drawer shows its details.
2. **Pasted satellites stay on home.** A satellite from pasted elements has no page, so it keeps today's home focus: the focus bar and the circle on the map, with the drawer on the list.
3. **Close goes back to the list.** On a satellite page the focus bar has a Close button (×, labelled "Close details") in place of Show all and Open page. Esc does the same.
   - If the page was reached from home in this tab, Close goes back in history, so Forward still works.
   - Otherwise (a direct load or a shared link), it pushes `/`.
4. **The other satellites you follow** show on a satellite page as faint dots, as home's focus shows them. Tapping one opens its page.
5. **Phones.** The drawer is under the map there, so on screens under 1100 px the focus bar has a "Details" button that scrolls the drawer's title into view.
6. **Old URLs keep working.**
   - `/?focus=<id>` redirects to `/sat/<id>`. A pasted satellite keeps the home focus instead.
   - `/sat/<id>?map=all` drops the query and shows the satellite page.
7. **Following** stays on the focus bar as today.

## Map motion and views (agreed add-ons, same plan)

8. **Smooth dots.** The map moves the satellite dots and the focused satellite's circle about five times a second (every 200 ms), computed from each satellite's orbit on the map side. The page's own one-second clock (the drawer, the cards) is unchanged. Ground tracks still rebuild once a minute. The fast updates pause while the tab is hidden.
9. **Follow.** The focus bar has a Follow toggle in both views.
   - While on, the camera stays centred on the focused satellite on every map update.
   - Dragging or zooming the map turns it off, and the button shows that.
   - Focusing another satellite turns it off.
   - The globe's "On the satellite" button turns it on.
   - It is off when a page loads.
10. **Satellite's view.** A third entry in the view menu, after Globe and Mercator. The camera sits above the focused satellite at its real height, looking straight down, so the visible Earth is what the satellite can see. It follows the satellite as it moves.
    - It uses MapLibre's vertical-perspective projection.
    - The zoom comes from the altitude, clamped to the map's minimum zoom for very high orbits.
    - Dragging is off in this view.
    - With no focused satellite it shows the globe. The choice is saved like the other views.
11. **Night side.** A globe camera preset beside the North and South pole buttons. It centres on the point opposite the Sun (the middle of the night side) at the globe's whole-Earth zoom.

## Removed

- **Home focus:** `?focus=` as home state for catalog satellites (it stays for pasted ones).
- **Show all on satellite pages:** `?map=all` and the focus bar's Show all there. The chips stay on every page: a chip opens that satellite's page, and the eye still hides or shows it.
- **"Open page":** on the focus bar.

## Unchanged

- **The shared map:** its camera persists, and Back closes charts.
- **Share links:** they keep working.
- **Server rendering:** satellite pages are still rendered on the server.
- **The home list:** Next up, the cards and their Details link.

## Constraints

- **Network:** never call CelesTrak from Aaron's laptop.
- **Copy:** no em dashes in new copy.
- **History:** one history entry per satellite opened, and none for Close-by-Back.
