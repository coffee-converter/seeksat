// lib/mcp/text.mjs - Text from outside SeekSat (OpenStreetMap place names,
// SatNOGS downlink labels) passed on in MCP results: control characters and
// line breaks out, and a length cap, so it reads as data, never as a block
// of instructions to the agent reading it.

/** One clean line of at most `max` characters, or null for nothing. */
export function cleanText(value, max = 120) {
  if (value == null) return null;
  const s = String(value).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
