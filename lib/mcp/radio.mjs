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

const DAY_MS = 86_400_000;
/** Rows in the pointing and tuning table, at most. */
export const MAX_TABLE_ROWS = 40;

const iso = (ms) => new Date(Math.round(ms)).toISOString();
const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
const mhz = (hz) => (Number.isFinite(hz) && hz > 0 ? Math.round(hz) / 1e6 : null);

/** The satellite's known downlinks, in MHz, default first. */
export function downlinkList(track) {
  const def = defaultDownlink(track);
  return [...track.downlinks]
    .sort((a, b) => (a === def ? -1 : b === def ? 1 : 0))
    .map((d) => ({
      frequencyMHz: mhz(d.hz),
      label: d.label ?? null,
      mode: d.mode ?? null,
      uplinkMHz: mhz(uplinkCentreHz(d.uplink)),
      isDefault: d === def,
    }));
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
 *   passPeakMs?: number | null, windowHours?: number }} args
 * @returns the radio summary, or { window: null, message } when there is no pass
 */
export function radioPass({ record, entry = null, observer, startMs, minElevationDeg = 10, frequencyHz = null, passPeakMs = null, windowHours = 48 }) {
  const obs = { id: 'observer', name: 'Observer', latDeg: observer.latDeg, lonDeg: observer.lonDeg, tz: 'UTC' };
  const track = makeTrack(record, entry);
  const downlinks = downlinkList(track);
  const freqHz = frequencyHz ?? defaultDownlink(track)?.hz ?? null;

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
      label: t.label,
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
