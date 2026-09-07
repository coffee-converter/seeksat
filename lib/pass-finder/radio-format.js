// lib/pass-finder/radio-format.js - the transmit-oscillator assumption,
// shared by the radio chart and the CSV export.
//
// This holds the transmit-oscillator assumption, which the chart and the CSV
// must state identically: when it was duplicated - one copy in each, each
// with its own literal 2.5 - the two could quietly disagree about the
// accuracy of the same number, which is worse than either being wrong alone.
//
// Generic string helpers live in text.js instead, so the sky-chart export
// path does not have to import from a radio module.

/** Assumed stability of a satellite's own transmit oscillator, in ppm.
 *
 *  A typical amateur-radio TCXO holds ~2.5 ppm; a good one is nearer 0.5.
 *  This is an ASSUMPTION, not a published figure for any spacecraft - both
 *  consumers state it in their output so a reader can substitute their own.
 *
 *  It is the dominant uncertainty in any ABSOLUTE frequency this feature
 *  reports, and it cancels out of every relative one: the offset is constant
 *  across a pass, so the Doppler curve's shape is unaffected. */
export const TX_OSC_PPM = 2.5;

/** Transmit-oscillator tolerance at `freqHz`, as a magnitude with units and
 *  no sign prefix ("1.09 kHz", "365 Hz") - callers supply their own "+/-" or
 *  "±" to suit their character set. Null when no frequency is known.
 *
 *  Scales with the carrier, which is why it must be computed rather than
 *  written down: 2.5 ppm is ~1.09 kHz at 437.800 MHz but only ~365 Hz at
 *  145.800. A hardcoded UHF figure was three times too pessimistic on 2 m. */
export function txOscTolerance(freqHz) {
  if (!freqHz || !Number.isFinite(freqHz)) return null;
  const hz = (freqHz * TX_OSC_PPM) / 1e6;
  return hz >= 1000 ? `${(hz / 1000).toFixed(2)} kHz` : `${hz.toFixed(0)} Hz`;
}
