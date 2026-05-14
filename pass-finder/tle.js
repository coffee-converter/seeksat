// pass-finder/tle.js -- fetch the ISS TLE from Celestrak.
// Returns { name, line1, line2 } or null on failure.

const ISS_URL = "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE";

export async function fetchIssTle() {
  try {
    const r = await fetch(ISS_URL);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text();
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 3) throw new Error("unexpected TLE response shape");
    return { name: lines[0], line1: lines[1], line2: lines[2] };
  } catch (e) {
    console.warn(`TLE fetch failed: ${e.message}`);
    return null;
  }
}
