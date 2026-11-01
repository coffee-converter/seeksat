// lib/pwa/offline.mjs - the offline banner's text (components/OfflineBanner.tsx).

/** "You're offline.", plus a note about saved satellites only when the page
 *  is showing them (the home's records came from the worker's cache). */
export function offlineText(fromCache) {
  return fromCache ? "You're offline. Showing the last saved satellites." : "You're offline.";
}
