// lib/radio/uplink.mjs - transmitting to a satellite: its uplink, the tone a
// repeater wants, and where to transmit as it moves. Pure.

const MHZ = (hz) => (hz / 1e6).toFixed(3);

/** Where to transmit relative to the uplink's nominal frequency, from the
 *  downlink's Doppler (Hz, received minus nominal) at the same moment. The
 *  same range rate shifts both links: the downlink is heard high while the
 *  satellite approaches, so transmit low, by the uplink's share
 *  (uplinkHz / downlinkHz). Null without the numbers. */
export function uplinkDopplerHz(downDopplerHz, downlinkHz, uplinkHz) {
  if (!Number.isFinite(downDopplerHz) || !(downlinkHz > 0) || !(uplinkHz > 0)) return null;
  return -downDopplerHz * uplinkHz / downlinkHz;
}

/** "Uplink 145.850 MHz FM, 67.0 Hz tone" or "Uplink 145.935–145.995 MHz LSB, inverting". */
export function uplinkText(uplink) {
  if (!uplink || !(uplink.hz > 0)) return null;
  const band = uplink.highHz > uplink.hz ? `${MHZ(uplink.hz)}–${MHZ(uplink.highHz)}` : MHZ(uplink.hz);
  const mode = uplink.mode ? ` ${uplink.mode.toUpperCase()}` : '';
  const extras = [];
  if (Number.isFinite(uplink.tone)) extras.push(`${uplink.tone.toFixed(1)} Hz tone`);
  if (uplink.invert) extras.push('inverting');
  return `Uplink ${band} MHz${mode}${extras.length ? `, ${extras.join(', ')}` : ''}`;
}

// CTCSS tones run from 67.0 to 254.1 Hz.
const TONE_MIN = 67;
const TONE_MAX = 254.1;

/** A CTCSS tone written into a description ("CTCSS 67.0 Hz", "141.3Hz tone"), or null. */
export function toneFrom(text) {
  if (typeof text !== 'string') return null;
  for (const m of text.matchAll(/(\d{2,3}(?:\.\d)?)\s*hz/gi)) {
    const hz = Number(m[1]);
    if (hz >= TONE_MIN && hz <= TONE_MAX) return hz;
  }
  return null;
}
