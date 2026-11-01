import { pickPlaceLabels } from './labels.mjs';

const r = (v, step) => Math.round(v / step) * step;

/**
 * Cache key for a label layout: projection, size, zoom, rounded pan, observer,
 * and (satellite view only) the subpoint rounded to 0.5 degrees.
 */
export function labelKey({ projectionId, width, height, zoom, pan, observer, sub }) {
  const obs = observer ? `${observer.latDeg},${observer.lonDeg}` : '-';
  const s = projectionId === 'satellite' && sub ? `${r(sub.latDeg, 0.5)},${r(sub.lonDeg, 0.5)}` : '-';
  return [projectionId, width, height, zoom, r(pan[0], 1), r(pan[1], 1), obs, s].join('|');
}

/** Keeps the last result and reuses it while the key is unchanged. */
export function createLabelCache(pick = pickPlaceLabels) {
  let lastKey = null;
  let last;
  return {
    get(key, args) {
      if (lastKey !== key) {
        last = Array.isArray(args) ? pick(...args) : pick(args);
        lastKey = key;
      }
      return last;
    },
  };
}
