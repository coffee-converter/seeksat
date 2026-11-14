import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downlinksFromTransmitters, fetchTransmitters, SATNOGS_TRANSMITTERS_URL } from '../lib/mirror/satnogs.mjs';

const tx = (over) => ({
  description: 'Beacon', alive: true, type: 'Transmitter', status: 'active', unconfirmed: false,
  downlink_low: 437_800_000, downlink_high: null, mode: 'FM', service: 'Amateur', norad_cat_id: 25544, ...over,
});

test('keeps active, alive, confirmed downlinks of a known satellite', () => {
  const out = downlinksFromTransmitters([
    tx({}),
    tx({ status: 'inactive', downlink_low: 145_800_000 }),
    tx({ alive: false, downlink_low: 145_825_000 }),
    tx({ unconfirmed: true, downlink_low: 437_550_000 }),
    tx({ downlink_low: null, description: 'uplink only' }),
    tx({ norad_cat_id: null, downlink_low: 437_100_000 }),
    tx({ downlink_low: 50, description: 'nonsense' }),
  ]);
  assert.deepEqual(Object.keys(out), ['25544']);
  assert.deepEqual(out['25544'], [{ hz: 437_800_000, label: 'Beacon', mode: 'fm', source: 'satnogs', default: true }]);
});

test('a transponder is listed at the centre of its passband', () => {
  const out = downlinksFromTransmitters([
    tx({ norad_cat_id: 44909, type: 'Transponder', description: 'Mode V/U linear', downlink_low: 435_610_000, downlink_high: 435_670_000, mode: 'USB' }),
  ]);
  assert.equal(out['44909'][0].hz, 435_640_000);
  assert.equal(out['44909'][0].label, 'Mode V/U linear (passband centre)');
});

test('amateur VHF/UHF downlinks come first, the first is the default, duplicates and blanks are tidied', () => {
  const out = downlinksFromTransmitters([
    tx({ description: 'S-band telemetry', downlink_low: 2_265_000_000, service: 'Space Operation', mode: 'QPSK' }),
    tx({ description: 'Telemetry', downlink_low: 436_000_000, service: 'Unknown', mode: 'GMSK' }),
    tx({ description: '  ', downlink_low: 145_800_000, mode: 'FM' }),
    tx({ description: 'Voice', downlink_low: 145_800_000, mode: 'FM' }),
  ]);
  const list = out['25544'];
  assert.deepEqual(list.map((d) => d.hz), [145_800_000, 436_000_000, 2_265_000_000]);
  assert.equal(list[0].label, 'FM downlink');
  assert.equal(list[0].default, true);
  assert.ok(list.slice(1).every((d) => !d.default));
});

test('at most 12 downlinks per satellite', () => {
  const many = Array.from({ length: 20 }, (_, i) => tx({ downlink_low: 435_000_000 + i * 10_000 }));
  assert.equal(downlinksFromTransmitters(many)['25544'].length, 12);
});

test('not a list gives nothing', () => {
  for (const bad of [null, {}, 'x', [null, 1]]) assert.deepEqual(downlinksFromTransmitters(bad), {});
});

test('fetchTransmitters asks SatNOGS DB once, identifies itself, and rejects a failed answer', async () => {
  const seen = [];
  const ok = async (url, opts) => { seen.push({ url, opts }); return new Response(JSON.stringify([tx({})]), { status: 200 }); };
  const list = await fetchTransmitters({ fetchImpl: ok });
  assert.equal(list.length, 1);
  assert.equal(seen[0].url, SATNOGS_TRANSMITTERS_URL);
  assert.match(seen[0].opts.headers['User-Agent'], /seeksat\.com/);
  await assert.rejects(fetchTransmitters({ fetchImpl: async () => new Response('busy', { status: 503 }) }), /503/);
  await assert.rejects(fetchTransmitters({ fetchImpl: async () => new Response('{"a":1}', { status: 200 }) }), /not a list/);
});

test('a repeater keeps its uplink, mode, inversion and tone', () => {
  const out = downlinksFromTransmitters([
    tx({ norad_cat_id: 27607, type: 'Transceiver', description: 'Mode V/U FM Voice CTCSS 67.0 Hz', downlink_low: 436_795_000, uplink_low: 145_850_000, uplink_mode: 'FM' }),
    tx({ norad_cat_id: 44909, type: 'Transponder', description: 'Linear', downlink_low: 435_610_000, downlink_high: 435_670_000, uplink_low: 145_935_000, uplink_high: 145_995_000, uplink_mode: 'LSB', invert: true, mode: 'USB' }),
  ]);
  assert.deepEqual(out['27607'][0].uplink, { hz: 145_850_000, mode: 'fm', tone: 67 });
  assert.deepEqual(out['44909'][0].uplink, { hz: 145_935_000, highHz: 145_995_000, mode: 'lsb', invert: true });
  assert.equal(downlinksFromTransmitters([tx({})])['25544'][0].uplink, undefined);
});

test('downlinks keep their SatNOGS transmitter uuid', () => {
  const out = downlinksFromTransmitters([tx({ uuid: 'ism4mBBuTeSBYsF67yno8j' }), tx({ downlink_low: 145_800_000, uuid: '' })]);
  const byHz = Object.fromEntries(out['25544'].map((d) => [d.hz, d]));
  assert.equal(byHz[437_800_000].uuid, 'ism4mBBuTeSBYsF67yno8j');
  assert.equal('uuid' in byHz[145_800_000], false);
});
