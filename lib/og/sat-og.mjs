// lib/og/sat-og.mjs - request->Response for /api/og/sat/<id>. Reads the
// snapshot only (never on-demand) so crawlers cannot spend the CelesTrak budget.
import { resolveSatellite } from '../catalog.mjs';
import { parseSatParam, satPageData } from '../sat/page-data.mjs';
import { buildSatCardSvg } from './sat-card.mjs';
import { rasterizeSvg } from './rasterize.mjs';

const notFound = () => new Response('Not found', {
  status: 404, headers: { 'cache-control': 'public, s-maxage=600' },
});

// The card is cached for a day or more, so it states the absolute epoch
// ("Elements from 1 Nov 2026, 14:00 UTC"), never a relative age.
const EPOCH_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC',
});

export function elementsFromText(epochMs) {
  return Number.isFinite(epochMs) ? `Elements from ${EPOCH_FORMAT.format(epochMs)} UTC` : '';
}

export async function satOgResponse(param, { reader, nowMs }) {
  const parsed = parseSatParam(param);
  if (!parsed) return notFound();
  const record = await reader.getSnapshotRecord(parsed.id);
  if (!record) return notFound();
  const data = satPageData(record, resolveSatellite(parsed.id), nowMs);
  const svg = buildSatCardSvg({
    name: data.name, noradId: data.noradId, intlDesignator: data.intlDesignator,
    elements: data.elements, ageText: elementsFromText(data.elementEpochMs),
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
