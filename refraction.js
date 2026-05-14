// refraction.js -- atmospheric refraction correction.
//
// Uses the Bennett (1982) formula, which matches Nautical Almanac tables
// to better than 0.1 arcmin for apparent altitudes above ~5°:
//
//   R [arcmin] = cot( h + 7.31 / (h + 4.4) )
//
// where h is the apparent altitude in degrees. Refraction makes objects
// appear HIGHER than they truly are, so the correction LOWERS the apparent
// direction toward the horizon by R.

const DEG = Math.PI / 180;

export function bennettRefractionArcmin(apparentAltDeg) {
  if (apparentAltDeg <= -1) return 0; // well below horizon
  const arg = (apparentAltDeg + 7.31 / (apparentAltDeg + 4.4)) * DEG;
  return 1 / Math.tan(arg);
}

// Apply refraction correction to an observed direction vector in ECEF.
// `dir` is the unit apparent direction.
// `up` is the unit local-zenith vector in ECEF at the observer.
// Returns a new unit vector for the TRUE direction (lowered toward horizon).
export function correctRefraction(dir, up) {
  const cosZ = dir[0]*up[0] + dir[1]*up[1] + dir[2]*up[2];
  const apparentAltDeg = 90 - Math.acos(Math.max(-1, Math.min(1, cosZ))) / DEG;
  const Rrad = (bennettRefractionArcmin(apparentAltDeg) / 60) * DEG;
  if (Rrad === 0) return [dir[0], dir[1], dir[2]];

  // Rotation axis k = dir × up (horizontal, perpendicular to the dir-up plane).
  const ax = dir[1]*up[2] - dir[2]*up[1];
  const ay = dir[2]*up[0] - dir[0]*up[2];
  const az = dir[0]*up[1] - dir[1]*up[0];
  const aLen = Math.hypot(ax, ay, az);
  if (aLen < 1e-12) return [dir[0], dir[1], dir[2]]; // at zenith, no rotation

  const k = [ax/aLen, ay/aLen, az/aLen];
  // Rodrigues rotation by -R around k (lower dir toward horizon).
  const c = Math.cos(-Rrad), s = Math.sin(-Rrad);
  const kd = k[0]*dir[0] + k[1]*dir[1] + k[2]*dir[2];
  return [
    dir[0]*c + (k[1]*dir[2] - k[2]*dir[1])*s + k[0]*kd*(1-c),
    dir[1]*c + (k[2]*dir[0] - k[0]*dir[2])*s + k[1]*kd*(1-c),
    dir[2]*c + (k[0]*dir[1] - k[1]*dir[0])*s + k[2]*kd*(1-c),
  ];
}
