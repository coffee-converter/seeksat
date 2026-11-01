import { pickPlaceLabels } from './labels.mjs';

const r = (v, step) => Math.round(v / step) * step;

/** Satellites move every second; labels re-pick once one has moved this far. */
export const SAT_KEY_DEG = 2;

/**
 * The satellites' part of a label key: each drawn satellite's id, emphasis and
 * position rounded to SAT_KEY_DEG, so labels keep clear of their dots and
 * names without re-picking on every tick.
 */
export function satsKey(sats) {
  if (!sats?.length) return '-';
  const parts = [];
  for (const s of sats) {
    const e = s.emphasis ?? (s.selected ? 'focus' : 'normal');
    if (e === 'hidden' || !s.position) continue;
    parts.push(`${s.noradId}${e[0]}${r(s.position.latDeg, SAT_KEY_DEG)},${r(s.position.lonDeg, SAT_KEY_DEG)}`);
  }
  return parts.join(';') || '-';
}

/**
 * Cache key for a label layout: projection, size, zoom, rounded pan, the world
 * maps' rotation to 0.001 degrees (it changes only when a gesture ends, a
 * focus centres or the view resets, so this costs no extra picks), observer,
 * (satellite view only) the subpoint rounded to 0.5 degrees, and the drawn
 * satellites rounded to SAT_KEY_DEG.
 */
export function labelKey({ projectionId, width, height, zoom, pan, observer, sub, sats = null, rotLon = 0 }) {
  const obs = observer ? `${observer.latDeg},${observer.lonDeg}` : '-';
  const s = projectionId === 'satellite' && sub ? `${r(sub.latDeg, 0.5)},${r(sub.lonDeg, 0.5)}` : '-';
  return [projectionId, width, height, zoom, r(pan[0], 1), r(pan[1], 1), Number(rotLon).toFixed(3), obs, s, satsKey(sats)].join('|');
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
