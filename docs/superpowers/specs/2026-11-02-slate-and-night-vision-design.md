# Slate Look and Night Vision Design

**Date:** 2026-11-02
**Status:** Approved direction (Aaron chose "Slate" and "yes a night vision toggle" from the look comparison page)
**Reference mock:** `/private/tmp/claude-501/-Users-aaron-work/43ed1f7f-2350-4934-a11b-ef9b444d0e87/scratchpad/ui-looks/index.html`, the "2. Slate" dark and light panels and the "3. Night vision" panel. Screenshot: `.../scratchpad/qa/looks.png`.

## Why

Aaron's words:
- "the whole UI is blue and buttons/dropdown are similar appearance"
- "a little busy looking overall - need some easier visual parsing"

## Goals

1. **Slate colours.**
   - A muted blue stays as the brand.
   - Panels, inputs and borders become neutral-cool greys instead of blue-tinted ones.
   - Blue is kept for the brand mark, links, focus, the main action and selected toggles.
2. **A clear control hierarchy,** so each kind of control looks different:

   | Control | Look |
   |---|---|
   | Main action (Live, Follow, Add) | Filled with the brand blue |
   | Secondary actions (Sky chart, Details, Share) | Neutral outline |
   | Tertiary (More, Unfollow) | Text only, muted |
   | On/off and choice toggles (Radio/Visual, theme) | Segmented control: a well with the selected segment filled |
   | Menus (map view, frequency) | Input-style field: a well background with an inset chevron |
   | Links | Brand blue, underlined |

3. **Easier parsing,** applied to Slate as my call, since Aaron asked for it in the same breath:
   - more space between sections;
   - sentence-case headings, no tracked-out uppercase;
   - badges as quiet text with a coloured word, not outlined pills;
   - fewer nested borders.

   Cards keep the satellite colour stripe on the left as their one identifying mark.
4. **Night vision:** a toggle beside the theme control.
   - When on, the whole app renders in dim reds over the dark theme: chrome, map, satellites and charts.
   - It is for use outside at night, because red light preserves dark adaptation.

## Non-goals

- No new fonts. Slate uses the system UI font, as the mock does.
- No layout changes beyond spacing and borders.
- No change to the sky or radio chart internals beyond what Night vision's red rendering does.

## Night vision behaviour

- **Toggle:**
  - A button labelled `Night vision`, with `aria-pressed`, next to the Auto/Light/Dark control.
  - Under 480 px it is an icon button with the same accessible name.
- **Storage:** saved in localStorage under `seeksat.night` (`'1'` or absent), separate from the theme mode.
- **Rendering:**
  - On: `<html data-night="1">`, and the resolved theme is forced to `dark`.
  - Off: the saved mode resolves as before.
  - The pre-paint script applies it before first paint, so a reload at night never flashes white or blue.
- **Implementation (my call):** a CSS `filter` on the root element, which turns every colour into a dim red. Examples: `grayscale(1) sepia(1) saturate(N) hue-rotate(-Xdeg) brightness(B)`, or an SVG `feColorMatrix` filter.
  - A filter on the root element does not create a containing block, so fixed-position dialogs and the full-screen map still work.
  - It covers the WebGL map and the chart canvases with no per-component work.
  - **Target:** every rendered pixel has its green and blue channels at most about 35% of red, and white text is no brighter than about 70%.
- **Satellite identity:** satellites lose their hue in Night vision, so names and labels carry identity. That is accepted: red-only is the point of the mode.
- **`theme-color` meta:** a dark red-black in Night vision.

## Constraints

- **Contrast:** body text stays AA (4.5:1) and large text and controls 3:1, in both Slate themes. `test/theme-css.test.mjs` keeps colours in tokens.
- **Satellite colours:** `SAT_PALETTES` still keeps 3:1 against map water and land. The map basemaps are unchanged.
- **Copy:** plain language, no em dashes.
- **Print:** unchanged.
