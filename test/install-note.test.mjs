import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DISMISSED_KEY, VISITS_KEY, countVisit, dismissInstall, installDismissed, installPath, isIosSafari,
} from '../lib/home/install-note.mjs';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)) };
};
const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };

test('a visit counts once per browser session, not per reload', () => {
  const local = memory();
  let session = memory();
  assert.equal(countVisit(local, session), 1);
  assert.equal(countVisit(local, session), 1);
  session = memory();
  assert.equal(countVisit(local, session), 2);
  assert.equal(countVisit(local, session), 2);
  assert.equal(local.getItem(VISITS_KEY), '2');
});

test('a junk count restarts at one, and blocked storage counts nothing', () => {
  const local = memory();
  local.setItem(VISITS_KEY, 'lots');
  assert.equal(countVisit(local, memory()), 1);
  assert.equal(countVisit(broken, memory()), 0);
});

test('without session storage each call counts', () => {
  const local = memory();
  assert.equal(countVisit(local, broken), 1);
  assert.equal(countVisit(local, broken), 2);
});

test('dismissal sticks; blocked storage reads as dismissed', () => {
  const local = memory();
  assert.equal(installDismissed(local), false);
  dismissInstall(local);
  assert.equal(local.getItem(DISMISSED_KEY), '1');
  assert.equal(installDismissed(local), true);
  assert.equal(installDismissed(broken), true);
  assert.doesNotThrow(() => dismissInstall(broken));
});

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';

test('iPhone Safari is detected; iOS Chrome, Macs and Android are not', () => {
  assert.equal(isIosSafari({ userAgent: IPHONE }), true);
  assert.equal(isIosSafari({ userAgent: IPHONE_CHROME }), false);
  assert.equal(isIosSafari({ userAgent: MAC, maxTouchPoints: 0 }), false);
  assert.equal(isIosSafari({ userAgent: MAC, maxTouchPoints: 5 }), true); // iPadOS
  assert.equal(isIosSafari({ userAgent: ANDROID }), false);
  assert.equal(isIosSafari(), false);
});

test('the install note: second visit on, one path, never when installed or dismissed', () => {
  const base = { visits: 2, dismissed: false, standalone: false, iosSafari: false, hasPrompt: false };
  assert.equal(installPath({ ...base, hasPrompt: true }), 'prompt');
  assert.equal(installPath({ ...base, iosSafari: true }), 'ios');
  assert.equal(installPath({ ...base, hasPrompt: true, iosSafari: true }), 'prompt');
  assert.equal(installPath(base), null, 'neither path applies');
  assert.equal(installPath({ ...base, visits: 1, hasPrompt: true }), null, 'first visit');
  assert.equal(installPath({ ...base, visits: 0, iosSafari: true }), null);
  assert.equal(installPath({ ...base, visits: 9, hasPrompt: true }), 'prompt');
  assert.equal(installPath({ ...base, hasPrompt: true, standalone: true }), null);
  assert.equal(installPath({ ...base, iosSafari: true, dismissed: true }), null);
});

test('iPhone browsers each get steps that work there; Brave, which reports itself as Safari, is sent to Safari', async () => {
  const { iosBrowser, IOS_STEPS } = await import('../lib/home/install-note.mjs');
  const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
  const CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1';
  const FIREFOX = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/133.0 Mobile/15E148 Safari/605.1.15';
  assert.equal(iosBrowser({ userAgent: SAFARI }), 'safari');
  assert.equal(iosBrowser({ userAgent: SAFARI, brave: true }), 'other');
  assert.equal(iosBrowser({ userAgent: CHROME }), 'chrome');
  assert.equal(iosBrowser({ userAgent: FIREFOX }), 'other');
  assert.equal(iosBrowser({ userAgent: 'Mozilla/5.0 (Linux; Android 15) Chrome/131 Mobile Safari/537.36' }), null);
  assert.match(IOS_STEPS.other, /Safari/);
  assert.equal(installPath({ visits: 2, dismissed: false, standalone: false, ios: 'other', hasPrompt: false }), 'ios');
});
