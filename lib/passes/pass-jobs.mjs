// lib/passes/pass-jobs.mjs - pure pass-search jobs, run in a worker or inline.
import { tracksFor } from '../home/records.mjs';
import { followedTracks } from '../home/view.mjs';
import { nextUp } from '../home/next-up.mjs';
import { findPasses } from './engine.mjs';
import { makeTrack } from '../sat/track.mjs';
import { CATALOG } from '../catalog.mjs';

/** Run one job from plain data. Throws only on an unknown job kind. */
export function runPassJob(job) {
  if (job.kind === 'next-up') {
    const records = new Map(job.records.map((r) => [r.noradId, r]));
    const tracks = followedTracks(tracksFor(records, job.custom ?? []), job.following);
    return nextUp({
      tracks, missing: job.missing, observer: job.observer,
      mode: job.mode, minElevDeg: job.minElevDeg, nowMs: job.nowMs,
    });
  }
  if (job.kind === 'passes') {
    let track;
    try {
      const entry = CATALOG.find((s) => s.noradId === job.record.noradId) ?? null;
      track = makeTrack(job.record, entry);
      // Garbage lines can parse into NaN elements without throwing.
      if (!Number.isFinite(track.periodMs) || !Number.isFinite(track.epochMs)) throw new Error('bad elements');
    } catch {
      return { kind: 'unavailable', reason: 'elements' };
    }
    const { observers, mode, minElevDeg, startMs, endMs } = job;
    return findPasses({ track, observers, mode, minElevDeg, startMs, ...(endMs == null ? {} : { endMs }) });
  }
  throw new Error(`Unknown pass job: ${job.kind}`);
}
