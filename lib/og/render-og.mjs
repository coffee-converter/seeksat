// lib/og/render-og.mjs - one call from a decoded share blob to OG PNG
// bytes. Shared by the serverless route and the static build. TLE source
// is injectable for tests.
import { getIssTle, ecefAtFactory } from "./tle.mjs";
import { selectPass } from "./pass-select.mjs";
import { renderPassChartSVG } from "./render-pass-chart.mjs";
import { buildCardSVG } from "./build-card.mjs";
import { rasterizeCard } from "./rasterize.mjs";

export async function renderOgPng(decoded, opts = {}) {
  const { getTle = getIssTle, nowMs = Date.now(), scanDays = 45 } = opts;
  const tle = await getTle();
  const ecefAt = ecefAtFactory(tle);
  const sel = selectPass(decoded, ecefAt, { nowMs, scanDays });
  if (!sel) throw new Error("no station or pass to render");
  const chart = renderPassChartSVG({ ...sel, ecefAt });
  return rasterizeCard(buildCardSVG(chart));
}
