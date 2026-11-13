// lib/home/mode-hint.mjs - the one-time note under the Visual/Radio switch.
// It shows until the person taps either option, then never again. Every
// storage access is guarded: no storage means the note simply stays hidden.

export const MODE_HINT_KEY = 'seeksat.home.mode-hint-seen';

export const MODE_HINT_TEXT =
  'Visual: passes you can see by eye. Radio: passes in range to receive voice, data or images.';

/** True when the hint has not been dismissed. Unreadable storage counts as
 *  seen, so a blocked store never shows a note that cannot be dismissed. */
export function modeHintWanted(storage) {
  try {
    return storage.getItem(MODE_HINT_KEY) == null;
  } catch {
    return false;
  }
}

/** Remember that the hint was dismissed. */
export function dismissModeHint(storage) {
  try {
    storage.setItem(MODE_HINT_KEY, '1');
  } catch { /* nothing to do */ }
}
