// lib/share/legacy-redirect.mjs - map old share URLs to satellite pages.
// Pure and Edge-safe: used by middleware.ts.

import { decodeStateBlob } from '../pass-finder/state-blob.js';
import { sharePath } from './share-link.mjs';
import { parseSatParam } from '../sat/sat-param.mjs';

const ISS = 25544;

function goodBlob(s) {
  if (!s || !/^[A-Za-z0-9_-]+$/.test(s)) return null;
  let decoded = null;
  try { decoded = decodeStateBlob(s); } catch (_) { return null; }
  return decoded && decoded.observers && decoded.observers.length >= 1 ? decoded : null;
}

export function legacyRedirect(pathname, searchParams) {
  const isRoot = pathname === '/';
  const isClassic = pathname === '/classic' || pathname.startsWith('/classic/');
  if (!isRoot && !isClassic) return null;
  if (!searchParams.has('s')) return isRoot ? null : '/';
  const s = searchParams.get('s');
  const decoded = goodBlob(s);
  if (!decoded) return `/sat/${ISS}`;
  return sharePath(decoded.noradId ?? ISS, s);
}

/**
 * /sat/<id>-slug and zero-padded ids go to /sat/<id>, and a share link whose
 * blob does not decode goes to the plain page. Done here rather than in the
 * page, where generateMetadata and the page would both send the redirect and
 * the response would carry two Location headers. Null when nothing to do.
 */
export function satRedirect(pathname) {
  const m = /^\/sat\/([^/]+)(?:\/share\/([^/]+))?\/?$/.exec(pathname);
  if (!m) return null;
  let param, blob;
  try {
    param = decodeURIComponent(m[1]);
    blob = m[2] == null ? null : decodeURIComponent(m[2]);
  } catch (_) {
    return null;
  }
  const parsed = parseSatParam(param);
  if (!parsed) return null;
  if (blob != null && !goodBlob(blob)) return `/sat/${parsed.id}`;
  if (parsed.canonical) return null;
  return blob == null ? `/sat/${parsed.id}` : sharePath(parsed.id, blob);
}
