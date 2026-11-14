// lib/og/view-alt.mjs - a shared map view's satellites and its share image's
// description. Light on purpose: the shared-view page imports it for its
// metadata, and must not pull in the image renderer (lib/og/view-og.mjs).
import { POPULAR_IDS } from '../home/prefs.mjs';
import { parseView } from '../share/view-link.mjs';
import { resolveSatellite } from '../catalog.mjs';

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

/** The shared map's description: the satellites it shows (named where the
 *  catalog has a short name, then how many more), or null for no view. */
export function viewDescription(search) {
  const view = parseView(search);
  if (!view) return null;
  const ids = shownIds(view);
  const names = ids.map((id) => { const e = resolveSatellite(id); return e && e.noradId === id ? e.shortName ?? null : null; }).filter(Boolean).slice(0, 3);
  const rest = ids.length - names.length;
  const who = !names.length
    ? `${ids.length} ${ids.length === 1 ? 'satellite' : 'satellites'}`
    : rest > 0 ? `${names.join(', ')} and ${rest} more` : names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
  return `${who} on a live SeekSat map: where ${ids.length === 1 ? 'it is' : 'they are'} now and ${ids.length === 1 ? 'its orbit track' : 'their orbit tracks'}.`;
}
