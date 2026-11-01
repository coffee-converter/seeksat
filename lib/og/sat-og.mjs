// lib/og/sat-og.mjs - request->Response for /api/og/sat/<id>. Reads the
// snapshot only (never on-demand) so crawlers cannot spend the CelesTrak budget.
import { resolveSatellite } from '../catalog.mjs';
import { parseSatParam, satPageData } from '../sat/page-data.mjs';
import { buildSatCardSvg } from './sat-card.mjs';
import { rasterizeSvg } from './rasterize.mjs';

const notFound = () => new Response('Not found', {
  status: 404, headers: { 'cache-control': 'public, s-maxage=600' },
});

export async function satOgResponse(param, { reader, nowMs }) {
  const parsed = parseSatParam(param);
  if (!parsed) return notFound();
  const record = await reader.getSnapshotRecord(parsed.id);
  if (!record) return notFound();
  const data = satPageData(record, resolveSatellite(parsed.id), nowMs);
  const svg = buildSatCardSvg({
    name: data.name, noradId: data.noradId, intlDesignator: data.intlDesignator,
    elements: data.elements, ageText: data.age?.text ?? '',
  });
  const png = await rasterizeSvg(svg, { width: 1200 });
  return new Response(new Uint8Array(png), {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
