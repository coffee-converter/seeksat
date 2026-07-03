// lib/pass-finder/sky-helpers.js - pure utilities for the polar-plot
// renderers (both the small per-card icon and the fullscreen modal):
//
//   - SVG namespace constant
//   - altAzToSvg: project apparent (alt, az) onto a polar SVG ring,
//     "looking up" convention (N top, E LEFT, W RIGHT) via the
//     negated-sin azimuth.
//   - skyShadeRgb / chartPalette: twilight-aware background shading
//     + luminance-derived line palette used by both renderers.
//   - naturalSkyLimMag: limiting visual magnitude at zenith as a
//     function of sun altitude - drives which stars + the ISS arc
//     are drawn vs. faded out at any given moment.
//   - starAltAzForObs: project a unit ECEF direction into an
//     observer's local alt/az without subtracting observer position
//     (stars sit at "infinity").
//
// Nothing here depends on scene state, viewer, or store - these are
// safe to import from anywhere.

export const SVG_NS = "http://www.w3.org/2000/svg";

// Project alt/az onto an SVG circle of radius `R` centered at (cx,cy).
// Defaults match the small obs-card plot (100×100 viewBox, r=45 ring).
// Pass cx=cy=100, R=90 for the fullscreen modal; or cx=cy=50, R=42 for
// the 3D-scene observer-icon overlay.
//
// East-on-left convention: standard astronomical sky-chart "lying on
// your back looking up" projection. Negated sin of azimuth flips the
// east/west axis vs. a top-down map.
export function altAzToSvg(altDeg, azDeg, cx = 50, cy = 50, R = 45) {
  const r = ((90 - altDeg) / 90) * R;
  const a = azDeg * Math.PI / 180;
  return [cx - r * Math.sin(a), cy - r * Math.cos(a)];
}

const rgbStr = ([r, g, b]) => `rgb(${r}, ${g}, ${b})`;

// Twilight-aware chart shade. Linear interpolation between standard
// twilight breakpoints - daylight blue at sun overhead, deep navy
// after astronomical twilight (sun < -18°). Returns an [r, g, b]
// triple in 0-255; callers can convert to a CSS string or derive
// a luminance-aware palette from it.
export function skyShadeRgb(altDeg) {
  const stops = [
    [ 10, [ 95, 168, 214]],
    [  0, [ 60, 100, 150]],
    [ -6, [ 35,  55, 100]],
    [-12, [ 18,  28,  60]],
    [-18, [  8,  12,  24]],
    [-90, [  4,   8,  20]],
  ];
  if (altDeg >= stops[0][0]) return stops[0][1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [aH, cH] = stops[i], [aL, cL] = stops[i + 1];
    if (altDeg <= aH && altDeg >= aL) {
      const t = (aH - altDeg) / (aH - aL);
      return cH.map((v, k) => Math.round(v + t * (cL[k] - v)));
    }
  }
  return stops[stops.length - 1][1];
}
export const skyShadeForSunAlt = (altDeg) => rgbStr(skyShadeRgb(altDeg));

// Luminance-aware palette: derive grid + spoke + arc grays from the
// horizon disc's perceived luminance. Light grays on dark sky, dark
// grays on bright sky, asymmetric magnitudes tuned for legibility
// (eyes accept lighter-on-dark with smaller delta than darker-on-light).
// Arc gets stronger contrast than grid so the pass trajectory reads
// as the primary visual against the chart's structural lines.
export function chartPalette(sunAltDeg) {
  const bg = skyShadeRgb(sunAltDeg);
  const bgLuma = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2];
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const dark = bgLuma >= 128;
  // Asymmetric deltas: bigger swings against bright bg because gray
  // doesn't visually "punch" out of pale blue without a big drop.
  const gridDelta = dark ? -45 : 30;
  const arcDelta  = dark ? -150 : 130;
  const gridGray = clamp(bgLuma + gridDelta);
  const arcGray  = clamp(bgLuma + arcDelta);
  const lineColor = `rgb(${gridGray}, ${gridGray}, ${gridGray})`;
  return {
    grid:       lineColor,
    spoke:      lineColor,
    minorSpoke: lineColor,
    arc:        `rgb(${arcGray}, ${arcGray}, ${arcGray})`,
  };
}

// Approximate limiting visual magnitude at zenith given sun altitude
// - objects fainter than this aren't visible to the naked eye through
// the prevailing twilight glow. Looser than rigorous photometric
// thresholds (real dark-sky limit is ~6.5) so the chart doesn't go
// completely empty in deep night; tighter than reality near horizon
// so we don't pretend stars are visible during daylight.
export function naturalSkyLimMag(altDeg) {
  const stops = [
    [ 10, -4.0],
    [  0, -2.5],
    [ -6,  1.5],
    [-12,  3.5],
    [-18,  5.0],
    [-90,  6.0],
  ];
  if (altDeg >= stops[0][0]) return stops[0][1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [aH, mH] = stops[i], [aL, mL] = stops[i + 1];
    if (altDeg <= aH && altDeg >= aL) {
      const t = (aH - altDeg) / (aH - aL);
      return mH + t * (mL - mH);
    }
  }
  return stops[stops.length - 1][1];
}

// Project a unit ECEF direction vector into an observer's local alt/az.
// Stars are "at infinity" so we don't subtract the observer's ECEF
// position - just rotate the direction into the observer's ENU basis.
// Returns { alt: degrees, az: degrees (0 = N, 90 = E) }.
export function starAltAzForObs(obs, starDirEcef) {
  const DEG = Math.PI / 180;
  const lat = obs.latDeg * DEG, lon = obs.lonDeg * DEG;
  const sinLat = Math.sin(lat), cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon), cosLon = Math.cos(lon);
  const [dx, dy, dz] = starDirEcef;
  const e = -sinLon * dx + cosLon * dy;
  const n = -sinLat * cosLon * dx - sinLat * sinLon * dy + cosLat * dz;
  const u =  cosLat * cosLon * dx + cosLat * sinLon * dy + sinLat * dz;
  const alt = Math.atan2(u, Math.hypot(e, n)) / DEG;
  let az = Math.atan2(e, n) / DEG;
  if (az < 0) az += 360;
  return { alt, az };
}
