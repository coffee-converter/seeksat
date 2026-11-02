// lib/live/heading.mjs - which way to turn a phone to face a satellite.

/** Signed turn from `headingDeg` to `targetAzDeg` in (-180, 180], right positive. */
export function turnHint(targetAzDeg, headingDeg) {
  let d = ((targetAzDeg - headingDeg) % 360 + 360) % 360;
  if (d > 180) d -= 360;
  const deltaDeg = Math.round(d);
  const abs = Math.abs(deltaDeg);
  const text = abs <= 10 ? 'Ahead'
    : abs >= 170 ? 'Turn around'
      : `Turn ${deltaDeg > 0 ? 'right' : 'left'} ${abs}°`;
  return { deltaDeg, text };
}

/** Compass heading in degrees from a deviceorientation event, or null when
 *  the event has no true north (relative orientation only). */
export function headingFromOrientation(e) {
  if (Number.isFinite(e?.webkitCompassHeading)) return e.webkitCompassHeading;
  if (e?.absolute === true && Number.isFinite(e.alpha)) return (360 - e.alpha) % 360;
  return null;
}
