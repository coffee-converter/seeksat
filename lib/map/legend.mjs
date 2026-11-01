// What the flat map's legend lists, in order. The swatches are drawn in CSS.
// Ghosts (the other satellites while one is focused) share one line; hidden
// satellites are not listed.
import { emphasisOf } from './draw.mjs';

export function legendItems({ sats: all, observer, minElevDeg }) {
  const sats = all.filter((s) => emphasisOf(s) === 'focus' || emphasisOf(s) === 'normal');
  const items = sats.map((s) => ({
    key: `sat-${s.noradId}`,
    kind: 'sat',
    label: s.name,
    color: s.color,
  }));
  if (all.some((s) => emphasisOf(s) === 'ghost')) {
    items.push({ key: 'ghost', kind: 'ghost', label: 'Faint dots: the other satellites you follow' });
  }
  const allGeo = sats.length > 0 && sats.every((s) => s.orbitClass === 'geo');
  items.push({
    key: 'track',
    kind: 'track',
    label: allGeo
      ? 'Dotted: where it has been. Solid, fading: where it is going, with ticks every hour'
      : 'Dotted: where it has been. Solid, fading: where it is going, with ticks every 10 min',
  });
  const selected = sats.find((s) => emphasisOf(s) === 'focus');
  if (selected) {
    items.push({
      key: 'footprint',
      kind: 'footprint',
      label: `Dashed circle: where ${selected.name} is at least ${minElevDeg}° up`,
    });
  }
  items.push({ key: 'night', kind: 'night', label: 'Shading: night, darker through twilight' });
  if (observer) items.push({ key: 'observer', kind: 'observer', label: 'You' });
  return items;
}
