// lib/home/list-origin.mjs - whether the open satellite page was reached from
// the home list, so Close can go back to it. Module state; pure.

let listed = false;

/** Note that the page was opened from the home list. */
export function markFromList() {
  listed = true;
}

/** True when the page was opened from the home list. */
export function fromList() {
  return listed;
}

/** Forget the list origin. */
export function clearFromList() {
  listed = false;
}

/** Where Close goes given a history entry's state: back only when that entry was marked as from the list. */
export function closeTargetFor(state) {
  return state?.seeksatFromList === true ? 'back' : 'home';
}
