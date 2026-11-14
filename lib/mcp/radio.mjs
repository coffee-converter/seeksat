// lib/mcp/radio.mjs - the radio chart's numbers for the MCP server: the
// satellite's known frequencies, and for one pass (or, for a satellite that
// never sets, the next 24 hours) the Doppler swing, when to tune where, and
// where to point. The same series the site's radio chart and CSV are built
// from (lib/passes/charts.js radioSeries), so the answers agree.

import { makeTrack } from '../sat/track.mjs';
import { findPasses as engineFindPasses } from '../passes/engine.mjs';
import { radioSeries, radioChartOptions, uplinkCentreHz } from '../passes/charts.js';
import { tuneRows } from '../pass-finder/radio-chart.js';
import { txOscTolerance } from '../pass-finder/radio-format.js';
import { uplinkDopplerHz } from '../radio/uplink.mjs';
import { defaultDownlink } from '../catalog.mjs';
import { cleanText } from './text.mjs';
import { receptionFor } from '../reception/tally.mjs';
import { receptionView } from './reception.mjs';

const DAY_MS = 86_400_000;
/** Rows in the pointing and tuning table, at most. */
export const MAX_TABLE_ROWS = 40;

const iso = (ms) => new Date(Math.round(ms)).toISOString();
const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
const mhz = (hz) => (Number.isFinite(hz) && hz > 0 ? Math.round(hz) / 1e6 : null);

/** The satellite's known downlinks, in MHz, default first. With `reception`
 *  (a SatNOGS tally index) each carries its counts, they are ordered most
 *  recently heard first (heard in 48 h, 7 d, 30 d, unknown, probably silent;
 *  then the latest lastHeard; then as before), and the default is the first
 *  when it was heard, else the catalog default. */
export function downlinkList(track, { reception = null, noradId = null, nowMs = Date.now() } = {}) {
  const def = defaultDownlink(track);
  const base = [...track.downlinks].sort((a, b) => (a === def ? -1 : b === def ? 1 : 0));
  if (!reception) {
    return base.map((d) => ({ ...downlinkItem(d), isDefault: d === def }));
  }
  const rated = base.map((d, i) => ({ d, i, r: receptionFor(reception, noradId, d, nowMs) }));
  rated.sort((a, b) => (a.r.recency - b.r.recency)
    || ((b.r.lastHeard ? Date.parse(b.r.lastHeard) : 0) - (a.r.lastHeard ? Date.parse(a.r.lastHeard) : 0))
    || (a.i - b.i));
  const lead = rated[0]?.r.state === 'heard' ? rated[0].d : def;
  return rated.map(({ d, r }) => ({ ...downlinkItem(d), isDefault: d === lead, reception: receptionView(r) }));
}

function downlinkItem(d) {
  return {
    frequencyMHz: mhz(d.hz),
    label: cleanText(d.label, 80),
    mode: d.mode ?? null,
    uplinkMHz: mhz(uplinkCentreHz(d.uplink)),
  };
}

/** A satellite's reception as its rows show it: its best downlink's (the
 *  first after ordering), or null without reception data. */
export function satelliteReception(items) {
  return items?.[0]?.reception ?? null;
}

/** Evenly spaced rows, ends included, at most `max`. */
function thin(samples, max) {
  if (samples.length <= max) return samples;
  const out = [];
  for (let i = 0; i < max; i++) out.push(samples[Math.round((i * (samples.length - 1)) / (max - 1))]);
  return out;
}

/**
 * @param {{ record: any, entry?: any, observer: { latDeg: number, lonDeg: number },
 *   startMs: number, minElevationDeg?: number, frequencyHz?: number | null,
 *   passPeakMs?: number | null, windowHours?: number, reception?: any, nowMs?: number }} args
 * @returns the radio summary, or { window: null, message } when there is no pass
 */
export function radioPass({ record, entry = null, observer, startMs, minElevationDeg = 10, frequencyHz = null, passPeakMs = null, windowHours = 48, reception = null, nowMs = startMs }) {
  const obs = { id: 'observer', name: 'Observer', latDeg: observer.latDeg, lonDeg: observer.lonDeg, tz: 'UTC' };
  const track = makeTrack(record, entry);
  const downlinks = downlinkList(track, { reception, noradId: record.noradId ?? entry?.noradId ?? null, nowMs });
  // A frequency asked for wins; else the default (the most recently heard
  // downlink when there is reception data).
  const lead = downlinks.find((d) => d.isDefault);
  const freqHz = frequencyHz ?? (lead?.frequencyMHz ? Math.round(lead.frequencyMHz * 1e6) : defaultDownlink(track)?.hz ?? null);

  const r = engineFindPasses({
    track, observers: [obs], mode: 'radio', minElevDeg: minElevationDeg,
    startMs, endMs: startMs + windowHours * 3_600_000,
  });
  if (r.kind === 'unavailable') return { downlinks, window: null, message: "These elements can't be propagated." };

  let anchorMs, day = null;
  if (r.kind === 'stationary') {
    if (!r.visible) return { downlinks, window: null, message: `It never rises above ${minElevationDeg}° here.` };
    // Never sets: the next 24 hours stand in for a pass.
    anchorMs = startMs;
    day = { startMs, endMs: startMs + DAY_MS };
  } else {
    if (!r.passes.length) return { downlinks, window: null, message: `No pass above ${minElevationDeg}° in the next ${windowHours} hours.` };
    const pass = passPeakMs == null
      ? r.passes[0]
      : r.passes.reduce((a, b) => (Math.abs(b.peakMs - passPeakMs) < Math.abs(a.peakMs - passPeakMs) ? b : a));
    anchorMs = pass.peakMs;
  }

  const built = radioSeries({ track, obs, anchorMs, minElevDeg: minElevationDeg, freqHz, purpose: 'chart', day });
  if (!built) return { downlinks, window: null, message: 'It is not above the horizon then.' };
  const meta = radioChartOptions(built, { track, obs });
  const { samples, summary } = built.series;
  const upHz = meta.uplinkHz;
  const first = samples[0], last = samples[samples.length - 1];
  const maxEl = samples.reduce((m, s) => Math.max(m, s.elDeg ?? -90), -90);

  const table = thin(samples, MAX_TABLE_ROWS).map((s) => ({
    time: iso(s.tMs),
    azimuthDeg: r1(s.azDeg),
    elevationDeg: r1(s.elDeg),
    rangeKm: r1(s.rangeM / 1000),
    rangeRateMps: r1(s.rangeRateMps),
    ...(freqHz ? { dopplerHz: Math.round(s.dopplerHz), receiveMHz: mhz(freqHz + s.dopplerHz) } : {}),
    ...(freqHz && upHz > 0 ? { transmitMHz: mhz(upHz + uplinkDopplerHz(s.dopplerHz, freqHz, upHz)) } : {}),
  }));

  return {
    downlinks,
    frequencyMHz: mhz(freqHz),
    uplinkMHz: mhz(upHz),
    window: {
      kind: built.day ? 'day' : 'pass',
      start: iso(first.tMs),
      end: iso(last.tMs),
      closestApproach: Number.isFinite(summary.tcaMs) ? iso(summary.tcaMs) : null,
      // A pass charts horizon to horizon; a never-setting satellite, 24 hours.
      note: built.day
        ? 'It never sets here, so this covers 24 hours.'
        : built.clamped ? 'The window was cut short by the search limit.' : 'Horizon to horizon.',
    },
    summary: {
      dopplerSwingHz: summary.dopplerPeakToPeakHz == null ? null : Math.round(summary.dopplerPeakToPeakHz),
      maxDopplerRateHzPerSec: summary.maxDopplerRateHzPerSec == null ? null : Number(summary.maxDopplerRateHzPerSec.toPrecision(3)),
      maxElevationDeg: r1(maxEl),
      closestRangeKm: r1(summary.closestRangeM / 1000),
      maxAngularRateDegPerSec: Number(summary.maxAngRateDegPerSec.toPrecision(3)),
    },
    // When to tune where: elevation crossings on a pass, the highest and
    // lowest frequency over a day, and closest approach.
    tuneAt: tuneRows(built.series, meta).map((t) => ({
      label: cleanText(t.label, 80),
      time: iso(t.tMs),
      dopplerHz: Math.round(t.dopplerHz),
      receiveMHz: mhz(freqHz + t.dopplerHz),
      ...(upHz > 0 ? { transmitMHz: mhz(upHz + uplinkDopplerHz(t.dopplerHz, freqHz, upHz)) } : {}),
    })),
    table,
    note: freqHz
      ? `Predicted from the published elements. The transmitter's own frequency is unknown to about ±${txOscTolerance(freqHz)}, so compare the shape of the curve with a capture, not the exact frequency.`
      : 'No frequency is known or given, so only range rate (frequency-independent) is shown; pass frequencyMHz for Doppler.',
  };
}
