// lib/sat/track.mjs - a Track bundles a satrec, its samplers and its orbit class.

import * as sat from 'satellite.js';
import { satrecFromRecord } from './satrec.mjs';
import { makeSatStateAt } from '../pass-finder/sat-state.js';

const UNIX_EPOCH_JD = 2440587.5;
const DAY_MS = 86_400_000;

export function epochMsFromSatrec(satrec) {
  const jd = satrec.jdsatepoch + (satrec.jdsatepochF ?? 0);
  return Math.round((jd - UNIX_EPOCH_JD) * DAY_MS);
}

/** 'leo' | 'meo' | 'heo' | 'geo', checked in that priority order. */
export function classifyOrbit({ meanMotionRevPerDay: n, eccentricity: e }) {
  if (n >= 0.9 && n <= 1.1 && e < 0.1) return 'geo';
  if (e >= 0.25) return 'heo';
  if (n >= 11.25) return 'leo';
  return 'meo';
}

export function makeTrack(record, entry = null) {
  const satrec = satrecFromRecord(record);
  const stateAt = makeSatStateAt(sat, satrec);
  const meanMotionRevPerDay = (satrec.no * 1440) / (2 * Math.PI);
  const eccentricity = satrec.ecco;
  const fallback = record.name ?? String(record.noradId);
  return {
    noradId: record.noradId,
    name: entry?.name ?? fallback,
    shortName: entry?.shortName ?? fallback,
    standardMag: entry?.standardMag ?? null,
    downlinks: entry?.downlinks ?? [],
    record,
    epochMs: Number.isFinite(record.epochMs) ? record.epochMs : epochMsFromSatrec(satrec),
    satrec,
    meanMotionRevPerDay,
    eccentricity,
    inclinationDeg: (satrec.inclo * 180) / Math.PI,
    periodMs: DAY_MS / meanMotionRevPerDay,
    orbitClass: classifyOrbit({ meanMotionRevPerDay, eccentricity }),
    ecefAt: (date) => stateAt(date)?.rEcef ?? null,
    stateAt,
  };
}

/** One period of the orbit centred on centerDate, in the Earth-fixed frame at
 *  centerDate (the geometric orbit shape, not a wobbly ground track). */
export function orbitTrackEcef(track, centerDate, samples = 360) {
  const dt = track.periodMs / (samples - 1);
  const gmstCenter = sat.gstime(centerDate);
  const points = [];
  for (let i = 0; i < samples; i++) {
    const t = new Date(centerDate.getTime() - track.periodMs / 2 + i * dt);
    const pv = sat.propagate(track.satrec, t);
    if (!pv || !pv.position) continue;
    const ecf = sat.eciToEcf(pv.position, gmstCenter);
    points.push([ecf.x * 1000, ecf.y * 1000, ecf.z * 1000]);
  }
  return points;
}
