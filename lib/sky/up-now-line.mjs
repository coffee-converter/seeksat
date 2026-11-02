// lib/sky/up-now-line.mjs - the one line "Up now" shows when nothing is up.

const NONE = 'Nothing you follow is up right now.';

/** The empty "Up now" text, naming the next pass when there is one. A pass
 *  already in progress (a satellite hidden from the sky view, or one that
 *  just set before the cards refreshed) is left out rather than contradict. */
export function emptyUpNowText(next) {
  if (!next || next.pass?.inProgress) return NONE;
  const text = next.text.endsWith('.') ? next.text : `${next.text}.`;
  return `${NONE} Next: ${text}`;
}
