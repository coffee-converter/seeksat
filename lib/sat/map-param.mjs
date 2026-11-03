// lib/sat/map-param.mjs - the satellite page's Show all, kept in ?map=all so
// a refresh or a copied URL draws every followed satellite again.

/** Whether a query string asks for every followed satellite on the map. */
export function isMapAll(search) {
  return new URLSearchParams(search).get('map') === 'all';
}

/** The page URL with map=all set (all) or removed, other params kept. */
export function mapAllHref(pathname, search, all) {
  const params = new URLSearchParams(search);
  if (all) params.set('map', 'all');
  else params.delete('map');
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
