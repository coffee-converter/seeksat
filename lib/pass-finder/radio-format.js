// lib/pass-finder/radio-format.js - presentation helpers shared by the radio
// chart and the CSV export.
//
// These live together because the chart and the CSV describe the SAME pass to
// the same person. When the transmit-oscillator assumption was duplicated -
// one copy here, one there, each with its own literal 2.5 - the two could
// quietly disagree about the accuracy of the same number, which is worse than
// either being wrong on its own.

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

/** Greedy word wrap to a character budget. Never splits a word, even one
 *  longer than the budget - a truncated identifier is worse than a ragged
 *  line. Collapses runs of whitespace. */
export function wrapText(text, maxChars) {
  const out = [];
  let line = "";
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (!line) { line = word; continue; }
    if (line.length + 1 + word.length <= maxChars) line += ` ${word}`;
    else { out.push(line); line = word; }
  }
  if (line) out.push(line);
  return out;
}

/** Filename-safe slug: lowercase, non-alphanumerics collapsed to hyphens,
 *  no leading or trailing hyphen. Shared so the satellite and observer parts
 *  of an export filename cannot be slugged two different ways. */
export function slug(text, fallback = "unknown") {
  const out = String(text ?? "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return out || fallback;
}
