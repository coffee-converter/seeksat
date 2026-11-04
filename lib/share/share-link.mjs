// lib/share/share-link.mjs - build share links that point at satellite pages.

import { encodeStateBlob } from '../pass-finder/state-blob.js';

export function sharePath(noradId, blob) {
  return `/sat/${noradId}/share/${blob}`;
}

export function makeShareBlob({ noradId, observers, passMs = null, mode, freqHz = null, minElevDeg }) {
  return encodeStateBlob({ noradId, observers, activePassMs: passMs, mode, downlinkHz: freqHz, minElevDeg });
}

export function shareUrl(origin, opts) {
  return origin + sharePath(opts.noradId, makeShareBlob(opts));
}
