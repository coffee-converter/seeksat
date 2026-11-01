// lib/og/render-og.mjs - one call from a decoded share blob to OG PNG
// bytes. Shared by the serverless route and the static build. TLE source
// is injectable for tests.
import { getOgRecord, ecefAtFactory } from "./tle.mjs";
import { resolveSatellite } from "../catalog.mjs";
import { selectPass } from "./pass-select.mjs";
import { renderPassChartSVG } from "./render-pass-chart.mjs";
import { buildCardSVG } from "./build-card.mjs";
import { rasterizeCard } from "./rasterize.mjs";

export async function renderOgPng(decoded, opts = {}) {
  const { noradId = decoded?.noradId ?? 25544, getRecord = getOgRecord, nowMs = Date.now(), scanDays = 45 } = opts;
  const record = await getRecord(noradId);
  const entry = resolveSatellite(noradId);
  const satName = (entry && entry.shortName && entry.noradId === noradId && entry.shortName) || record.name;
  const ecefAt = ecefAtFactory(record);
  const sel = selectPass(decoded, ecefAt, { nowMs, scanDays });
  if (!sel) throw new Error("no station or pass to render");
  const chart = renderPassChartSVG({ ...sel, ecefAt, satName });
  return rasterizeCard(buildCardSVG(chart));
}
