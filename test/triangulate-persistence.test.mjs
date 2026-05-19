import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Mock localStorage + location globally before the modules under test
// import. node:test runs files in order but module imports happen
// eagerly, so attaching the mock BEFORE the dynamic import is the
// safe form. Each test scopes its own mock state via beforeEach.
function installLocalStorageMock() {
  const store = new Map();
  globalThis.localStorage = {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
    clear() { store.clear(); },
    get length() { return store.size; },
    key(i) { return Array.from(store.keys())[i] ?? null; },
  };
  return store;
}

function uninstallLocalStorageMock() {
  delete globalThis.localStorage;
}

const {
  USER_ATTEMPTS_KEY,
  MANIFEST_OVERRIDES_KEY,
  loadUserAttempts,
  saveUserAttempts,
  loadManifestOverrides,
  saveManifestOverride,
} = await import('../lib/store.ts');

// pickInitialAttemptId lives in triangulate-attempts.ts, which imports
// "./store" (no extension) — Next/TS handles that fine but raw Node
// ESM under --experimental-strip-types refuses to resolve it. Skipping
// those tests until we have a test runner that does TS resolution.

// ---- USER_ATTEMPTS_KEY / MANIFEST_OVERRIDES_KEY constants ---------------

test('localStorage keys: namespaced + stable across releases', () => {
  // Renaming either key silently orphans existing users' data — pin
  // the literal values here so any change shows up loudly.
  assert.equal(USER_ATTEMPTS_KEY, 'triangulation-user-attempts');
  assert.equal(MANIFEST_OVERRIDES_KEY, 'triangulation-manifest-overrides');
});

// ---- loadUserAttempts ---------------------------------------------------

test('loadUserAttempts: returns [] when localStorage is undefined', () => {
  uninstallLocalStorageMock();
  assert.deepEqual(loadUserAttempts(), []);
});

test('loadUserAttempts: returns [] when key is missing', () => {
  installLocalStorageMock();
  assert.deepEqual(loadUserAttempts(), []);
  uninstallLocalStorageMock();
});

test('loadUserAttempts: returns [] when value is malformed JSON', () => {
  const store = installLocalStorageMock();
  store.set(USER_ATTEMPTS_KEY, '{not valid json');
  assert.deepEqual(loadUserAttempts(), []);
  uninstallLocalStorageMock();
});

test('loadUserAttempts: returns [] when value is not an array', () => {
  const store = installLocalStorageMock();
  store.set(USER_ATTEMPTS_KEY, '{"id":"x"}');
  assert.deepEqual(loadUserAttempts(), []);
  uninstallLocalStorageMock();
});

test('loadUserAttempts: deserializes + adds source="user" to each entry', () => {
  const store = installLocalStorageMock();
  store.set(USER_ATTEMPTS_KEY, JSON.stringify([
    { id: 'a', label: 'A', createdAt: '2025-01-01', timestampUTC: '', observations: [] },
    { id: 'b', label: 'B', createdAt: '2025-01-02', timestampUTC: '', observations: [] },
  ]));
  const out = loadUserAttempts();
  assert.equal(out.length, 2);
  assert.equal(out[0].id, 'a');
  assert.equal(out[0].source, 'user');
  assert.equal(out[1].source, 'user');
  uninstallLocalStorageMock();
});

// ---- saveUserAttempts ---------------------------------------------------

test('saveUserAttempts: silent no-op when localStorage is undefined', () => {
  uninstallLocalStorageMock();
  assert.doesNotThrow(() =>
    saveUserAttempts([
      { source: 'user', id: 'x', label: 'X', createdAt: '', timestampUTC: '', observations: [] },
    ]),
  );
});

test('saveUserAttempts: strips transient source flag before serialize', () => {
  const store = installLocalStorageMock();
  saveUserAttempts([
    { source: 'user', id: 'x', label: 'X', createdAt: '', timestampUTC: '', observations: [] },
  ]);
  const raw = store.get(USER_ATTEMPTS_KEY);
  assert.ok(raw);
  const parsed = JSON.parse(raw);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, 'x');
  assert.equal(parsed[0].source, undefined,
    'source flag should not survive serialize');
  uninstallLocalStorageMock();
});

test('saveUserAttempts → loadUserAttempts round trips (with source restored)', () => {
  installLocalStorageMock();
  const orig = [
    { source: 'user', id: 'a', label: 'Alpha', createdAt: '2025-03-01', timestampUTC: '2025-03-01T00:00Z', observations: [] },
  ];
  saveUserAttempts(orig);
  const out = loadUserAttempts();
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'a');
  assert.equal(out[0].label, 'Alpha');
  assert.equal(out[0].source, 'user');
  uninstallLocalStorageMock();
});

// ---- loadManifestOverrides ----------------------------------------------

test('loadManifestOverrides: empty object when localStorage is undefined', () => {
  uninstallLocalStorageMock();
  assert.deepEqual(loadManifestOverrides(), {});
});

test('loadManifestOverrides: empty object when key is missing', () => {
  installLocalStorageMock();
  assert.deepEqual(loadManifestOverrides(), {});
  uninstallLocalStorageMock();
});

test('loadManifestOverrides: empty object on malformed JSON', () => {
  const store = installLocalStorageMock();
  store.set(MANIFEST_OVERRIDES_KEY, '{not json');
  assert.deepEqual(loadManifestOverrides(), {});
  uninstallLocalStorageMock();
});

test('loadManifestOverrides: parses an overrides map', () => {
  const store = installLocalStorageMock();
  store.set(MANIFEST_OVERRIDES_KEY, JSON.stringify({
    monday: { timestampUTC: '2025-04-01', observations: [] },
  }));
  const out = loadManifestOverrides();
  assert.equal(out.monday.timestampUTC, '2025-04-01');
  uninstallLocalStorageMock();
});

// ---- saveManifestOverride -----------------------------------------------

test('saveManifestOverride: silent no-op when localStorage is undefined', () => {
  uninstallLocalStorageMock();
  assert.doesNotThrow(() =>
    saveManifestOverride('monday', { timestampUTC: '', observations: [] }),
  );
});

test('saveManifestOverride: adds a new key without disturbing existing ones', () => {
  const store = installLocalStorageMock();
  store.set(MANIFEST_OVERRIDES_KEY, JSON.stringify({
    monday: { timestampUTC: '2025-04-01', observations: [] },
  }));
  saveManifestOverride('tuesday', { timestampUTC: '2025-04-02', observations: [] });
  const out = JSON.parse(store.get(MANIFEST_OVERRIDES_KEY));
  assert.equal(out.monday.timestampUTC, '2025-04-01');
  assert.equal(out.tuesday.timestampUTC, '2025-04-02');
  uninstallLocalStorageMock();
});

test('saveManifestOverride: overwrites an existing key', () => {
  const store = installLocalStorageMock();
  store.set(MANIFEST_OVERRIDES_KEY, JSON.stringify({
    monday: { timestampUTC: 'OLD', observations: [] },
  }));
  saveManifestOverride('monday', { timestampUTC: 'NEW', observations: [] });
  const out = JSON.parse(store.get(MANIFEST_OVERRIDES_KEY));
  assert.equal(out.monday.timestampUTC, 'NEW');
  uninstallLocalStorageMock();
});

// Final cleanup — leave globals in a known state for any test files
// that might run after this one.
afterEach(() => {
  uninstallLocalStorageMock();
});
beforeEach(() => {
  // Ensure prior tests don't leak state.
  uninstallLocalStorageMock();
});
