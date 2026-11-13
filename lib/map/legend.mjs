// What the flat map's legend lists, in order. The swatches are drawn in CSS.
// Ghosts (the other satellites while one is focused) share one line; hidden
// satellites are not listed.
import { emphasisOf } from './palette.mjs';

/** The legend's closing note: a dot is a ground position, not the satellite's place in space. */
export const GP_NOTE = 'Dots and tracks are ground positions: the point on Earth straight below each satellite. Two dots close together can be thousands of km apart in height, so they are not necessarily close to each other.';

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
  const opened = sats.find((s) => s.passPath);
  if (opened) {
    items.push({
      key: 'pass',
      kind: 'pass',
      color: opened.color,
      label: 'Bold line: the opened pass, rise to set. Solid in sunlight, dashed in Earth\'s shadow',
    });
    if (opened.passReachDeg > 0 && observer) {
      items.push({
        key: 'reach',
        kind: 'reach',
        label: minElevDeg > 0
          ? `Dashed circle: where it is at least ${minElevDeg}° up from you, at that height`
          : 'Dashed circle: where it is above your horizon, at that height',
      });
    }
  }
  const selected = sats.find((s) => emphasisOf(s) === 'focus' && s.footprint !== null);
  if (selected) {
    items.push({
      key: 'footprint',
      kind: 'footprint',
      color: selected.color,
      label: minElevDeg > 0
        ? `Circle: where ${selected.name} is at least ${minElevDeg}° up`
        : `Circle: where ${selected.name} is above the horizon`,
    });
  }
  if (sats.some((s) => s.radio === true)) {
    items.push({ key: 'radio', kind: 'radio', label: 'Arcs by a dot: known radio downlinks' });
  }
  items.push({ key: 'night', kind: 'night', label: 'Shading: night, darker through twilight' });
  if (observer) items.push({ key: 'observer', kind: 'observer', label: 'You' });
  // What a dot is, last and without a swatch.
  items.push({ key: 'gp', kind: 'note', label: GP_NOTE });
  return items;
}
