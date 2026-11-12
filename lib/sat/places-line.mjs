// lib/sat/places-line.mjs - the line that says which places a pass list is for.

/** "Showing passes A and B can both see", or null when only one place counts. */
export function placesLine(names) {
  if (names.length < 2) return null;
  const list = names.map((n) => n || 'Your location');
  const last = list[list.length - 1];
  const head = list.slice(0, -1);
  const who = head.length === 1 ? `${head[0]} and ${last}` : `${head.join(', ')} and ${last}`;
  return `Showing passes ${who} can ${list.length === 2 ? 'both' : 'all'} see`;
}
