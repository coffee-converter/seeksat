// lib/a11y/focus-trap.mjs - which control Tab moves to inside a modal dialog.

/** Index to focus next among `count` controls, wrapping at both ends.
 *  `current` -1 means focus is outside: Tab enters first, Shift+Tab last. */
export function nextFocusIndex(count, current, shift) {
  if (count <= 0) return -1;
  if (current < 0) return shift ? count - 1 : 0;
  return shift ? (current - 1 + count) % count : (current + 1) % count;
}
