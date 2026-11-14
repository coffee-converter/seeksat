// lib/og/render-og.mjs - one call from a decoded share blob to OG PNG
// bytes. Shared by the serverless route and the static build. TLE source
// is injectable for tests.
import { getOgRecord, ecefAtFactory, walkOptsForRecord } from "./tle.mjs";
import { resolveSatellite } from "../catalog.mjs";
import { firstObserver, selectPass } from "./pass-select.mjs";
import { buildGlobeCardSvg } from "./globe-card.mjs";
import { fixedLines, fixedScene, passLines, passScene, staysPut } from "./globe-scene.mjs";
import { rasterizeCard } from "./rasterize.mjs";

export async function renderOgPng(decoded, opts = {}) {
  const { noradId = decoded?.noradId ?? 25544, getRecord = getOgRecord, nowMs = Date.now(), scanDays = 45 } = opts;
  const record = await getRecord(noradId);
  const entry = resolveSatellite(noradId);
  const satName = (entry && entry.shortName && entry.noradId === noradId && entry.shortName) || record.name;
  const ecefAt = ecefAtFactory(record);
  const title = opts.home ? null : satName;
  // A satellite that stays put has no pass: where to look instead.
  const station = firstObserver(decoded);
  if (station && staysPut(ecefAt, nowMs)) {
    const scene = fixedScene({ ecefAt, observer: station, nowMs });
    return rasterizeCard(buildGlobeCardSvg({ ...scene, title, lines: fixedLines({ ecefAt, observer: station, nowMs }) }));
  }
  const sel = selectPass(decoded, ecefAt, { nowMs, scanDays, walk: walkOptsForRecord(record) });
  if (!sel) throw new Error("no station or pass to render");
  // The globe under the shared place, with this pass's real track on it.
  // `home` (the site's own card) puts the wordmark where the name goes.
  const scene = passScene({ ecefAt, sel, minElevDeg: decoded.minElevDeg ?? 10 });
  // `card` overrides the words (the MCP page's card); `home` is the site's.
  const lines = opts.card?.lines ?? (opts.home
    ? ["Satellite passes over you", "By eye or by radio · seeksat.com"]
    : passLines({ ecefAt, sel }));
  const words = opts.card ? { title: opts.card.title, titleColor: opts.card.titleColor ?? null } : { title };
  return rasterizeCard(buildGlobeCardSvg({ ...scene, ...words, lines }));
}
