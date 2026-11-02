// lib/sky/up-now-line.mjs - the one line "Up now" shows when nothing is up.

const NONE = 'Nothing you follow is up right now.';

/** The empty "Up now" text, naming the next pass when there is one. */
export function emptyUpNowText(next) {
  if (!next) return NONE;
  const text = next.text.endsWith('.') ? next.text : `${next.text}.`;
  return `${NONE} Next: ${text}`;
}
