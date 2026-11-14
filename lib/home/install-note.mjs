// lib/home/install-note.mjs - the "Add SeekSat to your home screen" note under
// the home pass list. It waits for a second visit, picks the install path the
// browser supports, and stays gone once dismissed or installed. Storage is
// passed in and every access is guarded: no storage means no note.

export const VISITS_KEY = 'seeksat.home.visits';
export const DISMISSED_KEY = 'seeksat.home.install-dismissed';
const COUNTED_KEY = 'seeksat.home.visit-counted';

export const INSTALL_TEXT = 'Add SeekSat to your home screen for one-tap access.';
export const IOS_TEXT = 'Tap Share, then Add to Home Screen.';
/** The steps for each iPhone browser (iosBrowser). */
export const IOS_STEPS = {
  safari: IOS_TEXT,
  chrome: 'Tap Share in the address bar, then Add to Home Screen.',
  other: 'Open it in Safari, then tap Share and Add to Home Screen.',
};

/** The visits so far, counting this one the first time it is asked in a
 *  browser session (`session` is sessionStorage), so a reload is not a new
 *  visit. Unreadable storage is zero visits. */
export function countVisit(local, session) {
  try {
    const n = Number.parseInt(local.getItem(VISITS_KEY) ?? '', 10);
    const prior = Number.isInteger(n) && n > 0 ? n : 0;
    let counted = false;
    try { counted = session.getItem(COUNTED_KEY) === '1'; } catch { /* count it */ }
    if (counted && prior > 0) return prior;
    local.setItem(VISITS_KEY, String(prior + 1));
    try { session.setItem(COUNTED_KEY, '1'); } catch { /* ignore */ }
    return prior + 1;
  } catch {
    return 0;
  }
}

/** True once the note was dismissed. Unreadable storage counts as dismissed. */
export function installDismissed(local) {
  try {
    return local.getItem(DISMISSED_KEY) != null;
  } catch {
    return true;
  }
}

export function dismissInstall(local) {
  try { local.setItem(DISMISSED_KEY, '1'); } catch { /* nothing to do */ }
}

/** Safari on an iPhone or iPad (iPadOS asks for a desktop site, so a Mac user
 *  agent with a touch screen counts). Chrome, Firefox, Edge and Opera on iOS
 *  cannot add to the home screen the same way, so they are left out. */
export function isIosSafari({ userAgent = '', maxTouchPoints = 0 } = {}) {
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  if (!ios) return false;
  return /Safari\//.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\//.test(userAgent);
}

/** Which iPhone or iPad browser this is, for the install steps: 'safari',
 *  'chrome' (which adds to the home screen from its own Share button), or
 *  'other' (Brave, Firefox, Edge and the rest: the way is through Safari);
 *  null off iOS. Brave reports itself as Safari, so `brave` (navigator.brave
 *  is defined) says it is not. */
export function iosBrowser({ userAgent = '', maxTouchPoints = 0, brave = false } = {}) {
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  if (!ios) return null;
  if (/CriOS/.test(userAgent)) return 'chrome';
  if (brave) return 'other';
  return isIosSafari({ userAgent, maxTouchPoints }) ? 'safari' : 'other';
}

/** Which install note to show: 'prompt' (a browser install button), 'ios'
 *  (the steps for the iPhone browser in `ios`, from iosBrowser; `iosSafari`
 *  true is ios 'safari'), or null (nothing). */
export function installPath({ visits, dismissed, standalone, iosSafari = false, ios = null, hasPrompt }) {
  if (dismissed || standalone || !(visits >= 2)) return null;
  if (hasPrompt) return 'prompt';
  if (ios || iosSafari) return 'ios';
  return null;
}
