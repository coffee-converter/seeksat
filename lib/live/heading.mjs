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
 *  the event has no true north (relative orientation only). `screenAngleDeg`
 *  (screen.orientation.angle) turns it to where the top of the screen faces. */
export function headingFromOrientation(e, screenAngleDeg = 0) {
  let raw = null;
  if (Number.isFinite(e?.webkitCompassHeading)) raw = e.webkitCompassHeading;
  else if (e?.absolute === true && Number.isFinite(e.alpha)) raw = 360 - e.alpha;
  if (raw === null) return null;
  return (((raw + screenAngleDeg) % 360) + 360) % 360;
}

/** Whether to offer the phone compass: only a touch device (pointer: coarse)
 *  with DeviceOrientationEvent. Laptops expose the event with no compass
 *  behind it, so the event alone is not enough. `win` is a window. */
export function compassOffered(win) {
  if (!win || !('DeviceOrientationEvent' in win)) return false;
  try {
    return Boolean(win.matchMedia?.('(pointer: coarse)').matches);
  } catch {
    return false;
  }
}
