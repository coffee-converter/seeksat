// lib/sat/sat-param.mjs - the /sat/<id> route parameter. No imports, so the
// middleware can use it.

const MAX_PARAM_ID = 999_999_999;

/** "25544" or "25544-any-slug"; canonical only for the bare id. Null otherwise. */
export function parseSatParam(param) {
  const m = /^(\d{1,9})(-[a-z0-9-]*)?$/i.exec(String(param ?? ''));
  if (!m) return null;
  const id = Number(m[1]);
  if (!Number.isInteger(id) || id < 1 || id > MAX_PARAM_ID) return null;
  return { id, canonical: param === String(id) };
}
