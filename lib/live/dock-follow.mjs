// lib/live/dock-follow.mjs - The map camera while the live view is docked
// in the desktop panel: it locks on to the live satellite, and on close goes
// back to whatever Lock on was before. Pure, so node can test it.
//
// FlatMap turns Lock on off whenever its selected satellite changes, so the
// lock waits for the map to show the live satellite as selected, and the
// restore waits for the map to show the page's own selection again.

/**
 * One step, run whenever the dock or the map's selection changes.
 * @param {null | { id: number, prev: boolean, on: boolean }} state what the
 *   dock has done so far (null when it has nothing to undo)
 * @param {{ dockId: number | null, shownId: number | null, publishedId: number | null, following: boolean }} now
 *   dockId: the docked satellite, or null once closed; shownId: the
 *   selection the map was last given; publishedId: the selection the page
 *   last published (the map catches up a commit later); following: Lock on now.
 * @returns {{ state: null | { id: number, prev: boolean, on: boolean }, follow: boolean | null }}
 *   follow is the Lock on value to set, or null to leave it.
 */
export function dockFollowStep(state, { dockId, shownId, publishedId, following }) {
  if (dockId != null) {
    // A new dock notes Lock on as it was; switching satellites keeps the
    // first note, so closing still goes back to before any dock.
    const s = state && state.id === dockId ? state : { id: dockId, prev: state ? state.prev : following, on: false };
    if (!s.on && shownId === dockId) return { state: { ...s, on: true }, follow: true };
    return { state: s, follow: null };
  }
  if (!state) return { state: null, follow: null };
  // Closed: wait until the map shows the page's own selection again.
  if (shownId !== publishedId) return { state, follow: null };
  return { state: null, follow: state.prev };
}
