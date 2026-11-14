// lib/og/view-og.mjs - request->Response for /api/og/view?<shared view>: the
// share image of a shared map (the map's Share button, lib/share/view-link):
// the globe facing where the map was, with each shared satellite's track and
// its dot where it is now, in the map's colours. Reads the snapshot only, so
// crawlers cannot spend the CelesTrak budget.
import { resolveSatellite } from '../catalog.mjs';
import { SAT_PALETTE } from '../map/palette.mjs';
import { parseView } from '../share/view-link.mjs';
import { shownIds } from './view-alt.mjs';
import { ecefToGeodetic } from '../coords.js';
import { distanceText } from '../units.mjs';
import { buildGlobeCardSvg, cardTester, globeCentre, onCard } from './globe-card.mjs';
import { ecefAtFactory, periodMinOf } from './tle.mjs';
import { rasterizeSvg } from './rasterize.mjs';

/** At most one of each palette colour drawn; the title counts the rest. */
const MAX_DRAWN = SAT_PALETTE.length;
const MIN = 60_000;


/** "ISS · Tiangong · Hubble and 17 more": names while they fit, then a count. */
export function namesLine(names, total, maxChars = 44) {
  const out = [];
  for (const [i, n] of names.entries()) {
    const rest = total - i - 1;
    const tail = rest > 0 ? ` and ${rest} more` : '';
    const next = [...out, n].join(' · ');
    if (out.length && (next + tail).length > maxChars) break;
    out.push(n);
  }
  // No names to lead with: nothing, rather than a bare "and 3 more".
  if (!out.length) return '';
  const more = total - out.length;
  return more > 0 ? `${out.join(' · ')} and ${more} more` : out.join(' · ');
}

/** A catalog name's common name: "GSAT0201 (GALILEO 5)" is "GALILEO 5", as
 *  "EYESAT A (AO-27)" is "AO-27". Names without brackets stay as they are. */
export function commonName(name) {
  const m = /^.+? \(([^()]+)\)$/.exec(name ?? '');
  return m ? m[1] : name;
}

/** The view's satellites with their tracks around nowMs, in the map's colours. */
export async function viewTracks(view, { reader, nowMs }) {
  const ids = shownIds(view).slice(0, MAX_DRAWN);
  const out = [];
  for (const [i, id] of ids.entries()) {
    const record = await reader.getSnapshotRecord(id).catch(() => null);
    if (!record) continue;
    let ecefAt;
    try { ecefAt = ecefAtFactory(record); } catch { continue; }
    const sub = (ms) => {
      const e = ecefAt(new Date(ms));
      if (!e) return null;
      const g = ecefToGeodetic(e[0], e[1], e[2]);
      return [g.lonDeg, g.latDeg, g.elevM / 1000];
    };
    const now = sub(nowMs);
    if (!now) continue;
    // One orbit around now (half each way), at most 12 hours each way, as the
    // satellite page's card draws it: 45 minutes cut slower orbits short.
    let periodMin = 90;
    try { periodMin = periodMinOf(record); } catch { /* the default */ }
    const half = Math.min(Number.isFinite(periodMin) && periodMin > 0 ? periodMin / 2 : 45, 12 * 60) * MIN;
    const step = Math.max(30_000, (2 * half) / 300);
    const ground = [];
    for (let t = nowMs - half; t <= nowMs + half; t += step) {
      const p = sub(t);
      if (p) ground.push([p[0], p[1]]);
    }
    const entry = resolveSatellite(id);
    out.push({
      noradId: id,
      name: (entry && entry.noradId === id && entry.shortName) || commonName(record.name) || `NORAD ${id}`,
      color: SAT_PALETTE[i % SAT_PALETTE.length],
      ground,
      sat: { lonDeg: now[0], latDeg: now[1], altKm: now[2] },
    });
  }
  return out;
}

/** The view of the Earth that shows the most of these satellites just now:
 *  a dot on the card counts most, then how much of each track it shows.
 *  [lon, lat] to look at, or null without tracks. */
export function bestCentre(tracks) {
  if (!tracks.length) return null;
  // Each track sampled once; each candidate view's projection built once.
  const sampled = tracks.map((t) => ({ sat: t.sat, pts: t.ground.filter((_, i) => i % 6 === 0) }));
  let best = null, bestScore = -1;
  for (let lat = -45; lat <= 75; lat += 15) {
    for (let lon = -180; lon < 180; lon += 15) {
      const seen = cardTester(globeCentre(lon, lat));
      let score = 0;
      for (const { sat, pts } of sampled) {
        if (seen(sat.lonDeg, sat.latDeg)) score += 3;
        if (pts.length) score += pts.filter(([x, y]) => seen(x, y)).length / pts.length;
      }
      if (score > bestScore + 1e-9) { bestScore = score; best = [lon, lat]; }
    }
  }
  return best;
}

/** The card for a shared map. */
export function buildViewCardSvg(view, tracks) {
  // Where the map was (the link opens there), unless no satellite is on that
  // side of the Earth just now, or the map had no place of its own (the home
  // view, which opens wherever each visitor is): then the view that shows the
  // most of them.
  const shows = (c) => tracks.some((t) => onCard(globeCentre(c[0], c[1]), t.sat.lonDeg, t.sat.latDeg));
  const at = (view.center && shows(view.center) ? view.center : bestCentre(tracks)) ?? [0, 20];
  const total = Math.max(shownIds(view).length, tracks.length);
  const one = total === 1 && tracks.length === 1;
  const title = one ? tracks[0].name : total ? `${total} satellites` : 'A shared map';
  const names = namesLine(tracks.map((t) => t.name), total);
  return buildGlobeCardSvg({
    centre: globeCentre(at[0], at[1]),
    tracks,
    title,
    titleColor: one ? tracks[0].color : '#7eb8ff',
    // The first line says something the second does not: for one satellite
    // how high it is, for several their names.
    lines: [
      one ? (Number.isFinite(tracks[0].sat.altKm) ? `Where it is now, ${distanceText(tracks[0].sat.altKm)} up` : 'Where it is now') : names || 'Satellite passes over you',
      'Shared live map · seeksat.com',
    ],
  });
}

export async function viewOgResponse(url, { reader, nowMs }) {
  const u = new URL(url);
  const view = parseView(u.search);
  if (!view) return Response.redirect(new URL('/og.png', u), 302);
  const tracks = await viewTracks(view, { reader, nowMs });
  const png = await rasterizeSvg(buildViewCardSvg(view, tracks), { width: 1200 });
  return new Response(new Uint8Array(png), {
    status: 200,
    headers: { 'content-type': 'image/png', 'cache-control': 'public, s-maxage=1800, stale-while-revalidate=86400' },
  });
}
