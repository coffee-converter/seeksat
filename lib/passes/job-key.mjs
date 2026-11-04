// lib/passes/job-key.mjs - keys for pass jobs, so a result is shown only
// under the inputs it was computed for. The clock (refresh ticks) is not
// part of a key: a refresh keeps the old rows until the new ones land.

const place = (o) => (o ? [o.id, o.latDeg, o.lonDeg] : null);

export function passJobKey({ observers, mode, minElevDeg, recordId }) {
  return JSON.stringify([recordId ?? null, mode, minElevDeg, (observers ?? []).map(place)]);
}

export function cardJobKey({ following, custom, observer, mode, minElevDeg }) {
  return JSON.stringify([
    following ?? [],
    (custom ?? []).map((c) => [c.noradId, c.line1, c.line2]),
    place(observer),
    mode,
    minElevDeg,
  ]);
}
