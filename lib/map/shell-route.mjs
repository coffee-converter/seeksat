// lib/map/shell-route.mjs - Route helpers for the shared map shell.
// Pure functions: the shell reads the pathname and decides which page
// classes to put on the map frame.

/** True for the home page only. */
export function isHomePath(pathname) {
  return pathname === '/';
}

/**
 * The class list for the shell: "sat" on satellite pages, then the extra
 * page class. Undefined when neither applies.
 */
export function shellClassFor(pathname, extra) {
  const parts = [];
  if (pathname.startsWith('/sat/')) parts.push('sat');
  if (extra) parts.push(extra);
  return parts.length ? parts.join(' ') : undefined;
}
