// What the flat map's legend lists, in order. The swatches are drawn in CSS.
export function legendItems({ sats, observer, minElevDeg }) {
  const items = sats.map((s) => ({
    key: `sat-${s.noradId}`,
    kind: 'sat',
    label: s.name,
    color: s.color,
  }));
  const allGeo = sats.length > 0 && sats.every((s) => s.orbitClass === 'geo');
  items.push({
    key: 'track',
    kind: 'track',
    label: allGeo
      ? 'Line: ground track over a day'
      : 'Dotted: where it has been. Solid, fading: where it is going, with ticks every 10 min',
  });
  const selected = sats.find((s) => s.selected);
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
