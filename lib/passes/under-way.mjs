// lib/passes/under-way.mjs - one rule for whether a pass is happening now,
// and one for whether a pass's start is its real rise.

/** Not yet started at nowMs. */
export function notStarted(pass, nowMs) {
  return nowMs < pass.startMs;
}

/** Happening at nowMs: started and not yet over. */
export function underWay(pass, nowMs) {
  return pass.startMs <= nowMs && nowMs < pass.endMs;
}

/**
 * Whether startMs is the pass's rise. The engine starts a pass that was
 * already up when it searched at the search time (it sets inProgress), with
 * numbers for only what was left: its start bearing and elevation are where
 * the satellite was then, and its real peak may be earlier.
 */
export function startIsRise(pass) {
  return !pass.inProgress;
}
