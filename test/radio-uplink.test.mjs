import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uplinkDopplerHz, uplinkText, toneFrom } from '../lib/radio/uplink.mjs';

test('uplink Doppler mirrors the downlink, scaled by frequency', () => {
  // Approaching: the downlink is heard high, so transmit low, by the uplink's share.
  assert.equal(uplinkDopplerHz(9_000, 437_800_000, 145_990_000), -9_000 * 145_990_000 / 437_800_000);
  assert.equal(uplinkDopplerHz(-3_000, 145_800_000, 437_000_000), 3_000 * 437_000_000 / 145_800_000);
  assert.equal(uplinkDopplerHz(null, 437_800_000, 145_990_000), null);
  assert.equal(uplinkDopplerHz(1000, 0, 145_990_000), null);
});

test('uplinkText: a channel with its tone, a passband, an inverting transponder', () => {
  assert.equal(uplinkText({ hz: 145_850_000, mode: 'fm', tone: 67 }), 'Uplink 145.850 MHz FM, 67.0 Hz tone');
  assert.equal(uplinkText({ hz: 145_935_000, highHz: 145_995_000, mode: 'lsb', invert: true }), 'Uplink 145.935–145.995 MHz LSB, inverting');
  assert.equal(uplinkText({ hz: 435_000_000 }), 'Uplink 435.000 MHz');
  assert.equal(uplinkText(null), null);
});

test('toneFrom reads a CTCSS tone from a description, only in the CTCSS range', () => {
  assert.equal(toneFrom('Mode V/U FM Voice CTCSS 67.0 Hz'), 67);
  assert.equal(toneFrom('FM repeater, 141.3Hz tone'), 141.3);
  assert.equal(toneFrom('1200 baud AFSK'), null);
  assert.equal(toneFrom('9k6 GMSK 20 Hz offset'), null);
  assert.equal(toneFrom(null), null);
});
