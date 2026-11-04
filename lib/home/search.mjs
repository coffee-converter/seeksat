// lib/home/search.mjs - pure helpers for the home search bar.

export const MAX_QUERY = 64;

/** Trimmed query text, or null when too short to search. 1-9 digits is a NORAD ID and always valid. */
export function searchQuery(text) {
  const q = String(text ?? '').trim().slice(0, MAX_QUERY).trim();
  if (/^\d{1,9}$/.test(q)) return q;
  return q.length >= 2 ? q : null;
}

/** The search API URL; radio mode ranks satellites with known downlinks first. */
export function searchUrl(q, mode = 'visual') {
  return `/api/search?q=${encodeURIComponent(q)}${mode === 'radio' ? '&mode=radio' : ''}`;
}
