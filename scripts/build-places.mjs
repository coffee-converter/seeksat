// Reduce Natural Earth ne_50m_populated_places_simple.geojson to lib/map/places.json.
// Usage: node scripts/build-places.mjs <input.geojson>
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const input = process.argv[2];
if (!input) {
  console.error('usage: node scripts/build-places.mjs <input.geojson>');
  process.exit(1);
}
const out = fileURLToPath(new URL('../lib/map/places.json', import.meta.url));
const MAX_RANK = 7;

const geo = JSON.parse(readFileSync(input, 'utf8'));
const rows = [];
for (const f of geo.features) {
  const p = f.properties;
  const z = Number.isFinite(p.min_zoom) ? p.min_zoom : p.scalerank;
  // min_zoom is fractional and starts at 1.7 for capitals and megacities.
  // floor(z) - 1 gives integer ranks from 0, so big cities land at 0 to 2.
  const rank = Math.max(0, Math.floor(z) - 1);
  if (!(rank <= MAX_RANK)) continue;
  const [lon, lat] = f.geometry.coordinates;
  const name = String(p.nameascii || p.name);
  rows.push({
    e: [name, Math.round(lat * 100) / 100, Math.round(lon * 100) / 100, rank],
    pop: p.pop_max || 0,
  });
}
rows.sort((a, b) => a.e[3] - b.e[3] || b.pop - a.pop);
const json = '[\n' + rows.map((r) => JSON.stringify(r.e)).join(',\n') + '\n]\n';
writeFileSync(out, json);
console.log(`wrote ${rows.length} places, ${Buffer.byteLength(json)} bytes -> ${out}`);
