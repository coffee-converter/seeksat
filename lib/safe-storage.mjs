// lib/safe-storage.mjs - localStorage that never throws to reach.
//
// Reading window.localStorage itself throws a SecurityError when the browser
// blocks site data (a cookie setting, some sandboxed frames), and `typeof
// localStorage` reads it too. Callers take this instead and treat null as
// "no storage": settings then just don't persist.

/** localStorage, or null on the server or where reaching it throws. */
export function localStore() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
