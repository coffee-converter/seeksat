// lib/home/next-strip.mjs - the one pass a phone shows above the map: the
// soonest among the followed satellites (a pass already up starts soonest).
import { cardHeadline } from './next-up.mjs';

/** { noradId, name, text, pass } for the soonest pass card, or null. */
export function nextPassSummary(cards, nowMs) {
  let best = null;
  for (const c of cards ?? []) {
    if (c.kind !== 'pass') continue;
    if (!best || c.pass.startMs < best.pass.startMs) best = c;
  }
  return best ? { noradId: best.noradId, name: best.name, text: cardHeadline(best, nowMs), pass: best.pass } : null;
}

/** The cards, only while they were computed for the current location and
 *  follow list (`key`); null while new ones are on the way. */
export function currentCards(cardState, key) {
  return cardState && cardState.key === key ? cardState.cards : null;
}
