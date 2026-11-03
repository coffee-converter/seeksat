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

## Removed

- **Home focus:** `?focus=` as home state for catalog satellites (it stays for pasted ones).
- **Show all on satellite pages:** `?map=all` and its chips, and the focus bar's Show all there.
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
