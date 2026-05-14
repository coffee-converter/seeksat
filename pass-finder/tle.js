// pass-finder/tle.js -- fetch the current ISS TLE.
// Tries Celestrak first (the canonical source), falls back to
// tle.ivanstanojevic.me (CORS-enabled mirror) when Celestrak 403s or fails.
// Returns { name, line1, line2 } or null if both fail.

const CELESTRAK_URL = "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE";
const FALLBACK_URL  = "https://tle.ivanstanojevic.me/api/tle/25544";

async function fetchFromCelestrak() {
  const r = await fetch(CELESTRAK_URL);
  if (!r.ok) throw new Error(`Celestrak HTTP ${r.status}`);
  const text = await r.text();
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 3) throw new Error("unexpected TLE response shape");
  return { name: lines[0], line1: lines[1], line2: lines[2] };
}

async function fetchFromIvan() {
  const r = await fetch(FALLBACK_URL);
  if (!r.ok) throw new Error(`Fallback HTTP ${r.status}`);
  const j = await r.json();
  if (!j.line1 || !j.line2) throw new Error("malformed fallback TLE JSON");
  return { name: j.name || "ISS (ZARYA)", line1: j.line1, line2: j.line2 };
}

export async function fetchIssTle() {
  try { return await fetchFromCelestrak(); }
  catch (e1) {
    console.warn(`Celestrak TLE failed: ${e1.message} — trying fallback`);
    try { return await fetchFromIvan(); }
    catch (e2) {
      console.warn(`Fallback TLE failed: ${e2.message}`);
      return null;
    }
  }
}
