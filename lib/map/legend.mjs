// What the flat map's legend lists, in order. The swatches are drawn in CSS.
// Ghosts (the other satellites while one is focused) share one line; hidden
// satellites are not listed.
import { emphasisOf } from './palette.mjs';

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
  // Each satellite's tickMin (geometry.mjs tickStepMin): 10 on low orbits, 60 above.
  const steps = new Set(sats.map((s) => s.tickMin ?? 10));
  const ticks = steps.size > 1
    ? 'with ticks every 10 min on low orbits, every hour on higher ones'
    : steps.has(60) ? 'with ticks every hour' : 'with ticks every 10 min';
  items.push({
    key: 'track',
    kind: 'track',
    label: `Dotted: where it has been. Solid, fading: where it is going, ${ticks}`,
  });
  const selected = sats.find((s) => emphasisOf(s) === 'focus');
  if (selected) {
    items.push({
      key: 'footprint',
      kind: 'footprint',
      label: minElevDeg > 0
        ? `Circle: where ${selected.name} is at least ${minElevDeg}° up`
        : `Circle: where ${selected.name} is above the horizon`,
    });
  }
  items.push({ key: 'night', kind: 'night', label: 'Shading: night, darker through twilight' });
  if (observer) items.push({ key: 'observer', kind: 'observer', label: 'You' });
  return items;
}
