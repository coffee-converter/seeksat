// lib/og/view-alt.mjs - a shared map view's satellites and its share image's
// description. Light on purpose: the shared-view page imports it for its
// metadata, and must not pull in the image renderer (lib/og/view-og.mjs).
import { POPULAR_IDS } from '../home/prefs.mjs';
import { parseView } from '../share/view-link.mjs';

/** The view's satellites on the map: the shared list less the hidden ones. */
export const shownIds = (view) => (view.following ?? POPULAR_IDS).filter((id) => !view.hidden.includes(id));

/** The share image's description, from the link's query string. */
export function viewImageAlt(search) {
  const view = parseView(search);
  if (!view) return 'SeekSat: satellite passes over you, by eye or by radio';
  const n = shownIds(view).length;
  return n === 1
    ? 'A shared live map: a globe with one satellite, its orbit track and where it is now'
    : `A shared live map: a globe with ${n} satellites, their orbit tracks and where they are now`;
}
