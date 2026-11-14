// lib/radio/modes.mjs - the kinds of downlink a listener can ask for by
// word ("fm", "sstv", "beacon"), and whether a downlink is one. Pure; shared
// by the catalog search and the MCP radio scan so they agree.

/** Words that name a kind of downlink rather than part of a satellite name. */
export const RADIO_WORDS = Object.freeze([
  'fm', 'ssb', 'usb', 'lsb', 'cw', 'sstv', 'aprs', 'afsk', 'bpsk', 'gmsk', 'fsk', 'lrpt', 'apt',
  'repeater', 'transponder', 'beacon', 'digipeater', 'voice', 'telemetry',
]);

const patterns = new Map();

/** True when the downlink's mode is the word, or its label has it as a whole
 *  word ("FM repeater", "CW beacon", "Voice / SSTV"). */
export function downlinkHasWord(downlink, word) {
  const w = String(word).toLowerCase();
  let re = patterns.get(w);
  if (!re) {
    re = new RegExp(`(^|[^a-z0-9])${w.replace(/[^a-z0-9]/g, '')}([^a-z0-9]|$)`, 'i');
    patterns.set(w, re);
  }
  return downlink?.mode === w || re.test(String(downlink?.label ?? ''));
}
