import test from 'node:test';
import assert from 'node:assert/strict';
import { localStore } from '../lib/safe-storage.mjs';
import { loadPrefs, savePrefs, defaultPrefs, migrateClassicState } from '../lib/home/prefs.mjs';
import { readMode, writeMode, readNight, writeNight, syncTheme } from '../lib/ui/theme.mjs';
import { readPersistedBlob, writePersistedBlob } from '../lib/pass-finder/state-blob.js';

// What a browser with site data blocked does: reading localStorage throws.
function withBlockedStorage(fn) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
  });
  try { fn(); } finally {
    if (had) Object.defineProperty(globalThis, 'localStorage', had);
    else delete globalThis.localStorage;
  }
}

test('blocked storage: nothing that reads or writes settings throws', () => {
  withBlockedStorage(() => {
    assert.equal(localStore(), null);
    assert.deepEqual(loadPrefs(), defaultPrefs());
    assert.equal(savePrefs(defaultPrefs()), false);
    assert.equal(migrateClassicState(), null);
    assert.equal(readMode(), 'auto');
    assert.doesNotThrow(() => writeMode('dark'));
    assert.equal(readNight(), false);
    assert.doesNotThrow(() => writeNight(true));
    assert.equal(readPersistedBlob(), null);
    assert.doesNotThrow(() => writePersistedBlob('x'));
    const doc = { documentElement: { dataset: {} }, getElementById: () => null };
    assert.equal(syncTheme(doc, localStore(), { matches: true }), 'dark');
  });
});
