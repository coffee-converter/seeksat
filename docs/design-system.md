# SeekSat design system

The rules every screen follows. The live reference, with every token and
part rendered, is the unlisted page at `/design-27b284ec240e9ac9`
(`app/design-27b284ec240e9ac9/`). Tokens live in `app/globals.css`; the
shared parts are in `components/ui/` with their CSS in `app/ui.css`.

## The one rule

Component CSS (`app/home.css`, `app/sat.css`) does layout: margin, padding,
gap, grid, flex, position. Size, weight, colour, radius, motion and focus
come from tokens and shared classes. If a rule needs a literal for one of
those, the design system is missing a token: add it, don't inline it.
`test/theme-css.test.mjs` fails the build on a colour literal outside the
token and chart blocks.

## Type

One family, Atkinson Hyperlegible Next (`--font-sans`), for text and
numbers. Numbers that change or line up use tabular figures (`.num`, or a
`.kv` list).

Six steps: `--fs-xs` 11, `--fs-sm` 12, `--fs-md` 13 (body), `--fs-lg` 15,
`--fs-xl` 18, `--fs-2xl` 24, plus `--fs-hero` for the one big number on a
live view. Form controls use `--fs-input` (16) so iOS does not zoom.

Every heading and note takes a **type role** class:

| Class | Step | For |
| --- | --- | --- |
| `heading-page` | 2xl semibold | The page's h1: a satellite's name, a not-found page |
| `heading-section` | lg semibold | A section's h2, and every dialog and sheet title (`.modal__title`) |
| `heading-sub` | md semibold | A heading inside a panel or section |
| `heading-group` | sm semibold, muted | A label over a group: a day of passes, a setting, a menu group |
| `note` | md, muted | Muted body text: empty states, explanations |
| `note note--sm` | sm, muted | A line under a heading or control: zone notes, hints |

Labels in a label/value pair are `--fs-sm` muted; use `<dl class="kv ...">`.

Weights: regular for text, medium for buttons, semibold for headings,
values and the primary button. No bold (700) on screen.

## Colour

Use the job-named tokens, never the raw palette: `--text-heading` for
headings, `--map-text` for body and values, `--map-muted` for labels and
notes, `--link` for links, `--danger` / `--warn` / `--ok` for status,
`--accent` for the one thing that should draw the eye. Hover fills are
`--btn-hover` (controls, rows) and `--tile-hover` (tiles, folds); a chosen
list option is `--option-on`. Satellites take their colour from the map
palette as `--sat-color` (a `.sat-dot`, or a row's leading bar).

## Space and shape

Spacing steps only: `--sp-2` to `--sp-32`. Corners: `--radius-sm` (4)
for small marks and badges, `-md` (6) for buttons and inputs, `-lg` (8)
for cards, tiles and popovers, `-xl` (12) for dialogs, `-full` for pills
and dots. Lines: `--line-subtle` (hairlines between rows),
`--line-control` (button outlines), `--line-input` (fields).

## Buttons

Always `components/ui/Button` (or `buttonClass()` on a link). Pick by job:

- **primary**: the one main action in a view (Live, Save). At most one.
- **secondary** (default): ordinary actions, outlined.
- **quiet**: low-weight actions in a row, and icon buttons in the header.
- **link**: an action inside text or a label row ("ISS page").
- **overlay**: on top of the map imagery.
- `tone="danger"` for Unfollow and Remove, `done` after a copy or save,
  `pressed` for toggles. `size="sm"` in rows and sheets, md elsewhere.

Touch screens get 44 px targets automatically (`pointer: coarse`).
A whole row that opens something (a pass row) is the one place a raw
`<button>` is right; it uses `--btn-hover`, a `--dur-fast` transition and
an inset focus ring.

## Icons

`components/ui/Icon`: line icons, 2 px strokes in `currentColor`, so they
follow the button's colour and hover. 16 px in buttons and beside text,
20 px in the header, 14 px in chips. Always decorative: the button carries
the name (`aria-label` or visible text). No emoji or text glyphs (✕ × ⛶ ▾ ›)
as icons. To add one, draw it on the 24 px grid and add it to `PATHS`.

## Motion

`--dur-fast` (120 ms) for hover and press colour changes, `--dur-base`
(200 ms) for small moves, `--dur-slow` (300 ms) for sheets sliding in,
`--dur-flash` (700 ms) for a value that just changed, `--dur-pulse` (1600 ms) for the loading rows' slow pulse. One easing, `--ease`.
Reduced motion sets every duration to 0. Every hover change has a
transition; nothing animates on its own except the live dot.

## Focus

A visible 2 px `--focus-ring` outline on `:focus-visible`, offset 1 px
on controls, 2 px on folds, inset (-2 px) inside a clipped list. Never
remove the outline without replacing it.

## Shared parts

In `components/ui/`: Button, Segmented, Modal (dialog, sheet, full),
Field, Chip, Badge, RatingBars, StatTile, Surface, Disclosure and Details,
Icon, SettingRow, RadioMark. Shared classes in `app/ui.css`: the type
roles, `.kv`, `.sat-dot`, `.setting-row`. Before hand-building a
heading, note, fold, settings row, label/value list or icon, use these.

## Not yet on the system

The triangulate tool (`components/triangulate/`) keeps its own styles
and raw buttons. The chart canvases (sky chart, radio chart, polar plot)
keep literal colours in both themes by design (`chart-block` in
`app/globals.css`).
