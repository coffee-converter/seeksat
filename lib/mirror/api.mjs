// lib/mirror/api.mjs - pure handlers for the public read routes.
// Each returns { status, body, headers }; routes are thin wrappers.
import { tleAgeHours } from '../mcp/tle-record.mjs';

const MAX_IDS = 50;
// Ids not in the snapshot are fetched from CelesTrak one at a time, at most
// this many per request: a burst of parallel fetches is what gets an IP
// firewalled there, and one request should not spend an instance's budget.
const MAX_ON_DEMAND = 3;
const MAX_ID_VALUE = 999_999_999;
const MAX_QUERY_LEN = 64;
const OK_HEADERS = { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600' };
const MISS_HEADERS = { 'Cache-Control': 'public, s-maxage=60' };
const NO_STORE = { 'Cache-Control': 'no-store' };

const fail = (status, error) => ({ status, body: { error }, headers: { ...NO_STORE } });
const unavailable = () => fail(503, 'The satellite catalog is not available right now. Please try again shortly.');

function parseIds(raw) {
  if (raw == null) return { error: 'Provide ids as a comma separated list of NORAD IDs.' };
  const seen = new Set();
  const ids = [];
  for (const part of raw.split(',')) {
    const t = part.trim();
    if (!/^\d+$/.test(t)) return { error: 'Each id must be a positive whole number.' };
    const n = Number(t);
    if (n < 1 || n > MAX_ID_VALUE) return { error: 'Each id must be a positive whole number.' };
    if (!seen.has(n)) { seen.add(n); ids.push(n); }
  }
  if (ids.length > MAX_IDS) return { error: `Ask for at most ${MAX_IDS} satellites at a time.` };
  return { ids };
}

export async function satsHandler(reader, searchParams, nowMs) {
  const parsed = parseIds(searchParams.get('ids'));
  if (parsed.error) return fail(400, parsed.error);
  try {
    // Snapshot hits first (no CelesTrak), then the misses in order.
    const found = await Promise.all(parsed.ids.map((id) => reader.getSnapshotRecord(id)));
    let fetched = 0;
    for (let i = 0; i < parsed.ids.length; i++) {
      if (found[i]) continue;
      if (fetched >= MAX_ON_DEMAND) { found[i] = undefined; continue; }
      fetched++;
      found[i] = await reader.getRecord(parsed.ids[i]);
    }
    const objects = [];
    const missing = [];
    // undefined from getRecord means "not known right now" (budget spent or
    // fetch failed), not "does not exist": reported apart and never cached.
    const unknown = [];
    parsed.ids.forEach((id, i) => {
      const r = found[i];
      if (r === undefined) { unknown.push(id); return; }
      if (!r) { missing.push(id); return; }
      const age = tleAgeHours(r, nowMs);
      objects.push({ ...r, tleAgeHours: age == null ? null : Number(age.toFixed(2)) });
    });
    if (objects.length === 0 && !(await reader.ready())) return unavailable();
    const headers = unknown.length ? NO_STORE : missing.length ? MISS_HEADERS : OK_HEADERS;
    return {
      status: 200,
      body: { generatedAtMs: reader.generatedAtMs(), objects, missing, unknown },
      headers: { ...headers },
    };
  } catch (err) {
    console.error('satsHandler failed', err);
    return unavailable();
  }
}

export async function searchHandler(reader, searchParams) {
  const q = (searchParams.get('q') ?? '').trim();
  if (!q) return fail(400, 'Provide a search term in q.');
  if (q.length > MAX_QUERY_LEN) return fail(400, `Search terms can be at most ${MAX_QUERY_LEN} characters.`);
  try {
    const results = await reader.search(q, 20);
    if (results.length === 0 && !(await reader.ready())) return unavailable();
    return { status: 200, body: { results }, headers: { ...OK_HEADERS } };
  } catch (err) {
    console.error('searchHandler failed', err);
    return unavailable();
  }
}
