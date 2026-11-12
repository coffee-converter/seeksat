// lib/home/focus.mjs - the one focus model behind the map, chips, cards and
// search. Pure, so node can test it.

/**
 * What the map draws, and how loudly, in following order.
 * Unfocused: followed satellites are normal, hidden ones hidden, and a
 * viewing satellite (opened from search, not followed) is not shown.
 * Focused: the focus is focus (even when hidden), other followed satellites
 * ghost, hidden ones stay hidden, and a viewing focus comes last.
 * Unfocused with a highlight (the satellite of an open pass row, when it is
 * followed): drawn as if focused on it, without moving the camera.
 */
export function mapLayers({ followed = [], hidden = [], focusId = null, viewing = null, highlightId = null } = {}) {
  const lead = focusId ?? (followed.includes(highlightId) ? highlightId : null);
  const out = [];
  for (const id of followed) {
    let emphasis;
    if (lead == null) emphasis = hidden.includes(id) ? 'hidden' : 'normal';
    else if (id === lead) emphasis = 'focus';
    else emphasis = hidden.includes(id) ? 'hidden' : 'ghost';
    out.push({ noradId: id, emphasis });
  }
  if (focusId != null && focusId === viewing && !followed.includes(focusId)) {
    out.push({ noradId: focusId, emphasis: 'focus' });
  }
  return out;
}

/** The focus bar's copy. total is how many satellites Show all would draw. */
export function focusBarText(name, isFollowed, total) {
  return {
    title: `Viewing ${name}`,
    showAll: `Show all (${total})`,
    follow: isFollowed ? '★ Following' : '☆ Follow',
    // The camera toggle. "Follow" already names the star, so this is Lock on.
    lock: { off: 'Lock on', on: 'Locked on' },
  };
}

/** The follow star's aria-label. */
export function followLabel(name, isFollowed) {
  return isFollowed ? `Unfollow ${name}` : `Follow ${name}`;
}

/** The ?focus= value as a NORAD id, else null. */
export function parseFocus(raw) {
  if (typeof raw !== 'string' || !/^[1-9]\d{0,8}$/.test(raw)) return null;
  return Number(raw);
}

/** pathname plus the search string with focus set to id, or dropped for null. */
export function focusHref(pathname, search, id) {
  const params = new URLSearchParams(search);
  if (id == null) params.delete('focus');
  else params.set('focus', String(id));
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/**
 * How to change the URL for a focus change, so Back leaves focus:
 * push to enter a focus, replace to switch focus, and to clear it 'back' when
 * the current entry is one our focus pushed (pushed), else replace.
 * Null when nothing changes.
 */
export function focusNavMethod(currentId, nextId, pushed = false) {
  if (currentId === nextId) return null;
  if (currentId == null) return 'push';
  if (nextId != null) return 'replace';
  return pushed ? 'back' : 'replace';
}

/**
 * The satellite page's layers: the map is always focused on the page
 * satellite, the followed ones ghost, and the page one comes last when it
 * is not followed.
 */
export function satPageLayers({ followed = [], hidden = [], pageId }) {
  return mapLayers({ followed, hidden, focusId: pageId, viewing: pageId });
}

/** How many satellites unfocused layers draw: the n in "Show all (n)". */
export function showAllCount(unfocusedLayers) {
  return unfocusedLayers.filter((l) => l.emphasis !== 'hidden').length;
}

/**
 * Where a satellite's Focus opens: its page at /sat/<id>, or null for a pasted
 * id (not in the catalog, so it stays on home). Builds the path directly
 * rather than importing satPath from lib/sat/page-data.mjs, which pulls in
 * satellite.js and the pass-finder.
 */
export function focusDestination(id, pastedIds) {
  return new Set(pastedIds).has(id) ? null : `/sat/${id}`;
}
