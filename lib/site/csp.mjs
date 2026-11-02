// Content-Security-Policy for every response. See next.config.ts for the
// reasoning behind each directive.
export const CONNECT_ORIGINS = [
  'https://nominatim.openstreetmap.org', // geocoder
  'https://tiles.openfreemap.org', // map tiles, glyphs, sprites
];

export function buildCsp({ dev = false } = {}) {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob: https://tiles.openfreemap.org",
    `connect-src 'self' ${CONNECT_ORIGINS.join(' ')}`,
    'upgrade-insecure-requests',
  ].join('; ');
}
