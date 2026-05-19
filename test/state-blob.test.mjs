import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LS_STATE_KEY,
  encodeStateBlob, decodeStateBlob,
  readPersistedBlob, writePersistedBlob,
} from '../lib/pass-finder/state-blob.js';

// ---- LS_STATE_KEY constant ----------------------------------------------

test('LS_STATE_KEY: namespaced + versioned (so future schema changes are safe)', () => {
  // Keep the literal value in the test so a casual rename of the key
  // shows up here loudly — silently changing it would orphan every
  // user's previously-saved observer set.
  assert.equal(LS_STATE_KEY, 'iss-triangulation/state/v1');
});

// ---- encodeStateBlob → decodeStateBlob round trips ----------------------

test('round-trip: single observer with name preserved', () => {
  const snap = {
    observers: [{ name: 'Chicago', latDeg: 41.8781, lonDeg: -87.6298 }],
  };
  const out = decodeStateBlob(encodeStateBlob(snap));
  assert.equal(out.observers.length, 1);
  assert.equal(out.observers[0].name, 'Chicago');
  // latDeg/lonDeg pinned to 5 decimals on encode, so the round-trip is
  // close-but-not-bitwise-equal.
  assert.ok(Math.abs(out.observers[0].latDeg - 41.8781) < 1e-4);
  assert.ok(Math.abs(out.observers[0].lonDeg - (-87.6298)) < 1e-4);
});

test('round-trip: multi-observer preserves order', () => {
  const snap = {
    observers: [
      { name: 'A', latDeg: 1.1, lonDeg: 2.2 },
      { name: 'B', latDeg: 3.3, lonDeg: 4.4 },
      { name: 'C', latDeg: 5.5, lonDeg: 6.6 },
    ],
  };
  const out = decodeStateBlob(encodeStateBlob(snap));
  assert.equal(out.observers.length, 3);
  assert.equal(out.observers[0].name, 'A');
  assert.equal(out.observers[1].name, 'B');
  assert.equal(out.observers[2].name, 'C');
});

test('round-trip: activePassMs preserved when set', () => {
  const ms = 1730000000000;
  const out = decodeStateBlob(encodeStateBlob({
    observers: [{ name: 'X', latDeg: 0, lonDeg: 0 }],
    activePassMs: ms,
  }));
  assert.equal(out.passTimeMs, ms);
});

test('round-trip: passTimeMs is null when activePassMs is null/missing', () => {
  assert.equal(
    decodeStateBlob(encodeStateBlob({
      observers: [{ name: 'X', latDeg: 0, lonDeg: 0 }],
      activePassMs: null,
    })).passTimeMs,
    null,
  );
  assert.equal(
    decodeStateBlob(encodeStateBlob({
      observers: [{ name: 'X', latDeg: 0, lonDeg: 0 }],
    })).passTimeMs,
    null,
  );
});

test('round-trip: radio mode preserved', () => {
  const out = decodeStateBlob(encodeStateBlob({
    observers: [{ name: 'X', latDeg: 0, lonDeg: 0 }],
    mode: 'radio',
  }));
  assert.equal(out.mode, 'radio');
});

test('round-trip: visual mode is the default (omitted from blob)', () => {
  const blob = encodeStateBlob({
    observers: [{ name: 'X', latDeg: 0, lonDeg: 0 }],
    mode: 'visual',
  });
  // Visual is the default — encoder omits the field, decoder fills it.
  assert.equal(decodeStateBlob(blob).mode, 'visual');
});

test('round-trip: minElevDeg preserved when non-default', () => {
  const out = decodeStateBlob(encodeStateBlob({
    observers: [{ name: 'X', latDeg: 0, lonDeg: 0 }],
    minElevDeg: 25,
  }));
  assert.equal(out.minElevDeg, 25);
});

test('round-trip: minElevDeg defaults to 10 when omitted', () => {
  const out = decodeStateBlob(encodeStateBlob({
    observers: [{ name: 'X', latDeg: 0, lonDeg: 0 }],
  }));
  assert.equal(out.minElevDeg, 10);
});

test('encode keeps blob URL-safe (no +, /, =)', () => {
  // Build a snapshot heavy enough to exercise base64 padding.
  const snap = {
    observers: Array.from({ length: 12 }, (_, i) => ({
      name: `Observer ${i}`,
      latDeg: i * 7.5,
      lonDeg: i * 11.3,
    })),
    activePassMs: Date.now(),
    minElevDeg: 17,
    mode: 'radio',
  };
  const blob = encodeStateBlob(snap);
  assert.ok(!blob.includes('+'), `blob contains +: ${blob}`);
  assert.ok(!blob.includes('/'), `blob contains /: ${blob}`);
  assert.ok(!blob.includes('='), `blob contains =: ${blob}`);
});

// ---- decodeStateBlob: defensive parsing ---------------------------------

test('decode: null / empty input returns null', () => {
  assert.equal(decodeStateBlob(null), null);
  assert.equal(decodeStateBlob(undefined), null);
  assert.equal(decodeStateBlob(''), null);
});

test('decode: malformed base64 returns null', () => {
  assert.equal(decodeStateBlob('not-base64-at-all-%%%'), null);
});

test('decode: malformed JSON inside valid base64 returns null', () => {
  // Encode a non-JSON string and feed it through.
  const garbage = btoa('not json').replace(/=+$/, '');
  assert.equal(decodeStateBlob(garbage), null);
});

test('decode: drops observer entries missing coords', () => {
  // Hand-craft a blob with malformed entries:
  //   ['missing'] — too short (filtered by length check)
  //   ['bad', 'oops', 0] — non-numeric lat → +"oops" = NaN → finite check drops it
  // Note: NaN can't survive JSON serialization (becomes null → +null = 0,
  // which IS finite), so we use a non-numeric string instead.
  const obj = { o: [['ok', 1, 2], ['missing'], ['bad', 'oops', 0]] };
  const blob = btoa(JSON.stringify(obj))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const out = decodeStateBlob(blob);
  assert.equal(out.observers.length, 1);
  assert.equal(out.observers[0].name, 'ok');
});

test('decode: clamps minElevDeg to [0, 80]', () => {
  const mkBlob = (e) => {
    const obj = { o: [['X', 0, 0]], e };
    return btoa(JSON.stringify(obj))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  assert.equal(decodeStateBlob(mkBlob(-50)).minElevDeg, 0);
  assert.equal(decodeStateBlob(mkBlob(500)).minElevDeg, 80);
  assert.equal(decodeStateBlob(mkBlob(45)).minElevDeg, 45);
});

test('decode: missing observers array returns empty observers (not null)', () => {
  const obj = { /* no o */ };
  const blob = btoa(JSON.stringify(obj))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const out = decodeStateBlob(blob);
  assert.deepEqual(out.observers, []);
});

test('decode: NaN observer name becomes "Observer" fallback', () => {
  // Empty name → falsy → fallback to "Observer".
  const obj = { o: [['', 1, 2]] };
  const blob = btoa(JSON.stringify(obj))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const out = decodeStateBlob(blob);
  assert.equal(out.observers[0].name, 'Observer');
});

// ---- localStorage wrappers (silent on undefined) ------------------------

test('readPersistedBlob: returns null when localStorage is undefined', () => {
  // localStorage is undefined in Node — the wrapper should silently
  // return null instead of throwing.
  assert.equal(typeof localStorage, 'undefined');
  assert.equal(readPersistedBlob(), null);
});

test('writePersistedBlob: silent no-op when localStorage is undefined', () => {
  // Just verify it doesn't throw — there's nothing observable to assert.
  assert.doesNotThrow(() => writePersistedBlob('whatever'));
});
