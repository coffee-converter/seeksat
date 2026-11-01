// lib/share/legacy-redirect.mjs - map old share URLs to satellite pages.
// Pure and Edge-safe: used by middleware.ts.

import { decodeStateBlob } from '../pass-finder/state-blob.js';
import { sharePath } from './share-link.mjs';

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
