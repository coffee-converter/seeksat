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

/** Where Close goes: back to the list when the page came from it, else home. */
export function closeTarget(fromListFlag) {
  return fromListFlag ? 'back' : 'home';
}
