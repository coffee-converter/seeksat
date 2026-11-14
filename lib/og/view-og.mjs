// lib/og/view-og.mjs - request->Response for /api/og/view?<shared view>: the
// share image of a shared map (the map's Share button, lib/share/view-link):
// the globe facing where the map was, with each shared satellite's track and
// its dot where it is now, in the map's colours. Reads the snapshot only, so
// crawlers cannot spend the CelesTrak budget.
import { resolveSatellite } from '../catalog.mjs';
import { POPULAR_IDS } from '../home/prefs.mjs';
import { SAT_PALETTE } from '../map/palette.mjs';
import { parseView } from '../share/view-link.mjs';
import { ecefToGeodetic } from '../coords.js';
import { buildGlobeCardSvg, globeCentre, onCard } from './globe-card.mjs';
import { ecefAtFactory } from './tle.mjs';
import { rasterizeSvg } from './rasterize.mjs';

/** At most one of each palette colour drawn; the title counts the rest. */
const MAX_DRAWN = SAT_PALETTE.length;
const MIN = 60_000;

/** The view's satellites on the map: the shared list less the hidden ones. */
const shownIds = (view) => (view.following ?? POPULAR_IDS).filter((id) => !view.hidden.includes(id));

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
  const more = total - out.length;
  return more > 0 ? `${out.join(' · ')} and ${more} more` : out.join(' · ');
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
      return [g.lonDeg, g.latDeg];
    };
    const now = sub(nowMs);
    if (!now) continue;
    const ground = [];
    for (let t = nowMs - 45 * MIN; t <= nowMs + 45 * MIN; t += 30_000) {
      const p = sub(t);
      if (p) ground.push(p);
    }
    const entry = resolveSatellite(id);
    out.push({
      noradId: id,
      name: (entry && entry.noradId === id && entry.shortName) || record.name || `NORAD ${id}`,
      color: SAT_PALETTE[i % SAT_PALETTE.length],
      ground,
      sat: { lonDeg: now[0], latDeg: now[1] },
    });
  }
  return out;
}

/** The card for a shared map. */
export function buildViewCardSvg(view, tracks) {
  // Where the map was, unless no satellite is on that side of the Earth just
  // now: then the first satellite, so the card shows at least one.
  const first = tracks[0] ? [tracks[0].sat.lonDeg, tracks[0].sat.latDeg] : [0, 20];
  const shows = (c) => tracks.some((t) => onCard(globeCentre(c[0], c[1]), t.sat.lonDeg, t.sat.latDeg));
  const at = view.center && shows(view.center) ? view.center : first;
  const total = Math.max(shownIds(view).length, tracks.length);
  const one = total === 1 && tracks.length === 1;
  const title = one ? tracks[0].name : total ? `${total} satellites` : 'A shared map';
  const names = namesLine(tracks.map((t) => t.name), total);
  return buildGlobeCardSvg({
    centre: globeCentre(at[0], at[1]),
    tracks,
    title,
    titleColor: one ? tracks[0].color : '#7eb8ff',
    lines: [one ? 'On a shared live map' : names || 'A live satellite map', 'Shared live map · seeksat.com'].filter((l, i, a) => a.indexOf(l) === i),
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
