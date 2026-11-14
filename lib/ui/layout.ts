// lib/ui/layout.ts - The shell's layouts, as media queries, matching
// app/home.css and app/sat.css:
//   SIDE     the map beside a scrolling panel: desktop (1100 px and up) and a
//            phone held sideways (a short landscape screen, 560 px wide or more)
//   STACKED  everything else: map on top, the page scrolls
//   WIDE     desktop only, for what stays off phones whichever way they are
//            held (the satellite chips)
export const WIDE_QUERY = "(min-width: 1100px)";
export const SIDE_QUERY = "(min-width: 1100px), (orientation: landscape) and (max-height: 520px) and (min-width: 560px)";
export const STACKED_QUERY = "(max-width: 1099.98px) and (orientation: portrait), (max-width: 1099.98px) and (min-height: 520.02px), (max-width: 559.98px)";
export const PASS_VIEW_QUERY = "(max-width: 699.98px) and (orientation: portrait), (max-width: 699.98px) and (min-height: 520.02px)";
