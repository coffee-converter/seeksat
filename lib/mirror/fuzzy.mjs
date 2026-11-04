// lib/mirror/fuzzy.mjs - typo-tolerant, tiered name matching for search.

export function normalizeName(s) {
  const tokens = String(s ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  return { tokens, compact: tokens.join('') };
}

// Optimal string alignment distance (transposition = 1). Returns max + 1 as
// soon as the distance must exceed max.
export function editDistance(a, b, max) {
  const n = a.length, m = b.length;
  if (Math.abs(n - m) > max) return max + 1;
  let prev2 = null;
  let prev = new Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    const cur = new Array(m + 1);
    cur[0] = i;
    let rowMin = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      const bj = b.charCodeAt(j - 1);
      let v = prev[j - 1] + (ai === bj ? 0 : 1);
      if (prev[j] + 1 < v) v = prev[j] + 1;
      if (cur[j - 1] + 1 < v) v = cur[j - 1] + 1;
      if (prev2 && i > 1 && j > 1 && ai === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === bj
        && prev2[j - 2] + 1 < v) v = prev2[j - 2] + 1;
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev; prev = cur;
  }
  return prev[m] > max ? max + 1 : prev[m];
}

// Adds normalized forms (name plus aliases) once, so search can reuse them.
export function prepareEntry(entry) {
  if (entry.forms) return entry;
  return {
    ...entry,
    forms: [entry.name, ...(entry.aliases ?? [])].filter(Boolean).map(normalizeName)
      .filter((f) => f.compact),
  };
}

function tokenTypoDist(q, t) {
  const n = q.length;
  if (n < 3 || /^\d+$/.test(q)) return t.startsWith(q) ? 0 : -1;
  const max = n >= 8 ? 2 : 1;
  let best = max + 1;
  // Only longer tokens may lose or gain a character; short ones compare
  // against the same-length prefix so "hst" does not match "st...".
  const lo = n >= 5 ? n - 1 : n, hi = n >= 5 ? n + 1 : n;
  for (let L = lo; L <= hi; L++) {
    if (L < 1 || L > t.length) continue;
    const d = editDistance(q, t.slice(0, L), best - 1);
    if (d < best) best = d;
    if (best === 0) break;
  }
  return best > max ? -1 : best;
}

function typoDist(qTokens, form) {
  let total = 0;
  for (const q of qTokens) {
    let best = -1;
    for (const t of form.tokens) {
      const d = tokenTypoDist(q, t);
      if (d >= 0 && (best < 0 || d < best)) { best = d; if (d === 0) break; }
    }
    if (best < 0) return -1;
    total += best;
  }
  return total;
}

function formTier(q, form) {
  const { compact, tokens } = form;
  if (compact === q.compact) return 1;
  if (compact.startsWith(q.compact)) return 2;
  if (q.tokens.every((qt) => tokens.some((t) => t.startsWith(qt)))) return 3;
  if (compact.includes(q.compact)) return 5;
  return 99;
}

function match(q, raw, e) {
  const digits = /^\d+$/.test(raw);
  const id = String(e.noradId);
  if (digits && id === raw) return { tier: 0, dist: 0 };
  let tier = 99;
  for (const f of e.forms) {
    const t = formTier(q, f);
    if (t < tier) tier = t;
  }
  if (digits && id.startsWith(raw) && tier > 4) tier = 4;
  if (tier < 99) return { tier, dist: 0 };
  let bestDist = -1;
  for (const f of e.forms) {
    const d = typoDist(q.tokens, f);
    if (d >= 0 && (bestDist < 0 || d < bestDist)) bestDist = d;
  }
  return bestDist < 0 ? null : { tier: 6, dist: bestDist };
}

// entry: { noradId, name, aliases } (or prepared). null or { tier, dist }.
export function matchTier(query, entry) {
  const raw = String(query ?? '').trim();
  const q = normalizeName(raw);
  if (!q.compact) return null;
  return match(q, raw, prepareEntry(entry));
}

function compareHits(a, b) {
  const x = a.entry, y = b.entry;
  return a.tier - b.tier || a.dist - b.dist
    || (x.curated ? 0 : 1) - (y.curated ? 0 : 1)
    || (x.inGroups ? 0 : 1) - (y.inGroups ? 0 : 1)
    || (x.debris ? 1 : 0) - (y.debris ? 1 : 0)
    || x.name.length - y.name.length
    || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0);
}

// entries: prepared index entries { noradId, name, curated, inGroups, debris, forms }.
export function rankEntries(query, entries, limit = 20) {
  const raw = String(query ?? '').trim();
  const q = normalizeName(raw);
  if (!q.compact) return [];
  const hits = [];
  for (const entry of entries) {
    const m = match(q, raw, entry);
    if (m) hits.push({ entry, tier: m.tier, dist: m.dist });
  }
  hits.sort(compareHits);
  return hits.slice(0, Math.max(0, limit)).map((h) => h.entry);
}
