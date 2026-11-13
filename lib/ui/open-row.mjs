// lib/ui/open-row.mjs - pass lists open one row at a time, and the row a
// person taps stays where it was on screen while the other one closes.

/** The open row after tapping `key`: it closes if it was the open one, else it
 *  opens and whichever was open closes. */
export function toggleOpen(openKey, key) {
  return openKey === key ? null : key;
}

/**
 * The scroll position that puts a row back where it was: `beforeTop` and
 * `afterTop` are its top on screen before and after the change, `scrollTop`
 * the scroller's position after it, clamped to 0..maxScrollTop.
 * @param {{ beforeTop: number, afterTop: number, scrollTop: number, maxScrollTop: number }} o
 */
export function keptScrollTop({ beforeTop, afterTop, scrollTop, maxScrollTop }) {
  const want = scrollTop + (afterTop - beforeTop);
  return Math.min(Math.max(0, maxScrollTop), Math.max(0, want));
}
