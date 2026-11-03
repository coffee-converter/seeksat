import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTrack } from '../lib/sat/track.mjs';
import { findPasses } from '../lib/passes/engine.mjs';
import { passRows, compass, printAccuracyNote, zoneLabel, initialRowCount, dayHeading, groupRowsByDay, isRowOpen, directionText, nextPassText } from '../lib/sat/pass-rows.mjs';
import { ISS_LINE1, ISS_LINE2 } from './fixtures/omm-iss.mjs';
import { GOES16_LINE1, GOES16_LINE2, EN52VE, recordFrom } from './fixtures/orbits.mjs';

const iss = makeTrack(recordFrom(ISS_LINE1, ISS_LINE2, 'ISS'));
const ISS_T0 = Date.parse('2026-03-01T12:00:00Z');
const ISS_EPOCH = iss.epochMs;
const DAY = 86_400_000;
const goes = makeTrack(recordFrom(GOES16_LINE1, GOES16_LINE2, 'GOES 16'));
const GOES_T0 = Date.parse('2026-10-31T15:00:00Z');
const opts = { epochMs: ISS_EPOCH, nowMs: ISS_T0, minElevDeg: 10, mode: 'radio', timeZone: 'UTC', locale: 'en-GB' };

test('rows for ISS passes', () => {
  const v = passRows(findPasses({ track: iss, observers: [EN52VE], startMs: ISS_T0 }), opts);
  assert.equal(v.kind, 'rows');
  assert.match(v.rows[0].startLabel, /^\d\d:\d\d$/);
  assert.match(v.rows[0].dayLabel, /^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}$/);
  assert.match(v.rows[0].maxElevLabel, /^\d+°$/);
  assert.match(v.rows[0].azLabel, /^(N|NE|E|SE|S|SW|W|NW) \d+° to (N|NE|E|SE|S|SW|W|NW) \d+°$/);
});
test('a pass far from the epoch carries the accuracy note', () => {
  const v = passRows(findPasses({ track: iss, observers: [EN52VE], startMs: ISS_EPOCH + 5 * DAY }), { ...opts, nowMs: ISS_EPOCH + 5 * DAY });
  assert.match(v.rows[0].accuracy, /days old at this pass/);
});
test('GOES 16 stationary text is rounded', () => {
  const v = passRows(findPasses({ track: goes, observers: [EN52VE], startMs: GOES_T0 }), opts);
  assert.equal(v.kind, 'stationary');
  assert.match(v.text, /^Fixed in your sky at azimuth \d+\.\d°, elevation \d+\.\d°\./);
});
test('stationary that never rises', () => {
  const r = { kind: 'stationary', visible: false, pointing: [{ obsId: 'home', azDeg: 1, elDeg: -5, elMinDeg: -6, elMaxDeg: -4 }] };
  assert.equal(passRows(r, opts).text, 'It never rises here.');
  r.pointing[0].elMaxDeg = 4;
  assert.equal(passRows(r, opts).text, 'It never rises above 10° here.');
});
test('messages', () => {
  assert.equal(passRows({ kind: 'passes', passes: [] }, { ...opts, mode: 'visual' }).text, 'No visible passes in the next 10 days.');
  assert.equal(passRows({ kind: 'passes', passes: [] }, opts).text, 'No passes above 10° in the next 10 days.');
  assert.equal(passRows({ kind: 'unavailable' }, opts).text, "These elements can't be used to compute passes.");
});
test('compass', () => {
  assert.deepEqual([0, 22, 23, 180, 337, 338].map(compass), ['N', 'N', 'NE', 'S', 'NW', 'N']);
});
test('up now follows nowMs', () => {
  const r = findPasses({ track: iss, observers: [EN52VE], startMs: ISS_T0 });
  const p = r.passes[0];
  assert.equal(passRows(r, { ...opts, nowMs: p.startMs + 60_000 }).rows[0].inProgress, true);
  assert.equal(passRows(r, { ...opts, nowMs: p.startMs - 60_000 }).rows[0].inProgress, false);
});
test('no finite epoch means no accuracy note, not a huge age', () => {
  const r = findPasses({ track: iss, observers: [EN52VE], startMs: ISS_EPOCH + 5 * DAY });
  assert.equal(passRows(r, { ...opts, epochMs: null, nowMs: ISS_EPOCH + 5 * DAY }).rows[0].accuracy, null);
});
test('joint GEO: the text names the place that cannot see it', () => {
  const names = { home: 'Home', 'obs-1': 'Sydney' };
  const r = {
    kind: 'stationary', visible: false,
    pointing: [
      { obsId: 'home', azDeg: 180, elDeg: 30, elMinDeg: 29, elMaxDeg: 31 },
      { obsId: 'obs-1', azDeg: 1, elDeg: -40, elMinDeg: -41, elMaxDeg: -39 },
    ],
  };
  assert.equal(passRows(r, { ...opts, names }).text, 'It never rises above 10° at Sydney.');
  // Home is the first place that cannot see it: the home texts stay.
  r.pointing[0].elMaxDeg = 4;
  assert.equal(passRows(r, { ...opts, names }).text, 'It never rises above 10° here.');
  r.pointing[0].elMaxDeg = -2;
  assert.equal(passRows(r, { ...opts, names }).text, 'It never rises here.');
});
test('a pass already up shows when it sets and how long is left', () => {
  const r = findPasses({ track: iss, observers: [EN52VE], startMs: ISS_T0 });
  const p = r.passes[0];
  const nowMs = p.startMs + 60_000;
  const row = passRows(r, { ...opts, nowMs }).rows[0];
  const until = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }).format(p.endMs);
  assert.equal(row.timesLabel, `up now, until ${until}`);
  const leftS = Math.round((p.endMs - nowMs) / 1000);
  assert.equal(row.durationLabel, `${Math.floor(leftS / 60)}m${String(leftS % 60).padStart(2, '0')}s left`);
  const later = passRows(r, { ...opts, nowMs: p.startMs - 60_000 }).rows[0];
  assert.equal(later.timesLabel, `${later.startLabel} to ${later.endLabel}`);
  assert.doesNotMatch(later.durationLabel, /left/);
});

test('printAccuracyNote names the day and start of the first noted pass', () => {
  const rows = [
    { dayLabel: 'Sat Nov 1', startLabel: '18:02', accuracy: null },
    { dayLabel: 'Tue Nov 4', startLabel: '05:41', accuracy: 'Elements are 3.1 days old at this pass, so times may be off by a minute or more.' },
    { dayLabel: 'Tue Nov 4', startLabel: '07:15', accuracy: 'Elements are 3.2 days old at this pass, so times may be off by a minute or more.' },
  ];
  assert.equal(
    printAccuracyNote(rows),
    'Passes from Tue Nov 4 05:41 on may be off by a minute or more: the elements will be over 3 days old by then.',
  );
  assert.equal(printAccuracyNote(rows.slice(0, 1)), null);
  assert.equal(printAccuracyNote([]), null);
});

test('zoneLabel names the zone with its short name at that moment', () => {
  const nov = Date.parse('2026-11-02T04:00:00Z');
  const jul = Date.parse('2026-07-02T04:00:00Z');
  assert.equal(zoneLabel('America/Chicago', nov, 'en-US'), 'CST (America/Chicago)');
  assert.equal(zoneLabel('America/Chicago', jul, 'en-US'), 'CDT (America/Chicago)');
  assert.equal(zoneLabel('UTC', nov, 'en-US'), 'UTC');
  assert.equal(zoneLabel(undefined, nov, 'en-US'), 'UTC');
  assert.equal(zoneLabel('Not/AZone', nov, 'en-US'), 'UTC');
});

test('initialRowCount keeps the next 48 hours, at least 3 rows, and the shared row', () => {
  const H = 3_600_000;
  const rows = [1, 5, 20, 47, 49, 60, 100].map((h) => ({ key: String(h), pass: { startMs: h * H } }));
  assert.equal(initialRowCount(rows, 0), 4);
  assert.equal(initialRowCount(rows, 0, { sharedKey: '60' }), 6);
  assert.equal(initialRowCount(rows, 0, { sharedKey: 'gone' }), 4);
  assert.equal(initialRowCount(rows.slice(4), 0), 3);
  assert.equal(initialRowCount(rows.slice(0, 2), 0), 2);
  assert.equal(initialRowCount([], 0), 0);
});

test('dayHeading names today and tomorrow in the observer zone', () => {
  const now = Date.parse('2026-11-02T03:00:00Z'); // 21:00 on 1 Nov in Chicago
  const tz = 'America/Chicago';
  assert.equal(dayHeading(Date.parse('2026-11-02T05:50:00Z'), now, tz, 'en-GB'), 'Today');
  assert.equal(dayHeading(Date.parse('2026-11-02T06:10:00Z'), now, tz, 'en-GB'), 'Tomorrow');
  assert.equal(dayHeading(Date.parse('2026-11-03T18:00:00Z'), now, tz, 'en-GB'), 'Tue 3 Nov');
});

test('groupRowsByDay keeps order and puts an in-progress pass under Today', () => {
  const now = Date.parse('2026-11-02T06:05:00Z'); // 00:05 on 2 Nov in Chicago
  const row = (key, startIso) => ({ key, pass: { startMs: Date.parse(startIso) } });
  const rows = [
    row('a', '2026-11-02T05:58:00Z'), // started 23:58 on 1 Nov, still up
    row('b', '2026-11-02T09:00:00Z'),
    row('c', '2026-11-03T09:00:00Z'),
    row('d', '2026-11-03T12:00:00Z'),
  ];
  const groups = groupRowsByDay(rows, now, 'America/Chicago', 'en-GB');
  assert.deepEqual(groups.map((g) => [g.heading, g.rows.map((r) => r.key)]), [
    ['Today', ['a', 'b']],
    ['Tomorrow', ['c', 'd']],
  ]);
});

test('passRows adds from and to compass labels', () => {
  const v = passRows(findPasses({ track: iss, observers: [EN52VE], startMs: ISS_T0 }), opts);
  const r = v.rows[0];
  assert.equal(r.fromLabel, compass(r.pass.startAzDeg));
  assert.equal(r.toLabel, compass(r.pass.endAzDeg));
});

test('isRowOpen: the shared row starts open and its toggle closes it', () => {
  assert.equal(isRowOpen('a', 'a', new Set()), true);
  assert.equal(isRowOpen('a', 'a', new Set(['a'])), false);
  assert.equal(isRowOpen('b', 'a', new Set()), false);
  assert.equal(isRowOpen('b', 'a', new Set(['b'])), true);
  assert.equal(isRowOpen('b', null, new Set(['b'])), true);
});

test('directionText names rise and set bearings', () => {
  assert.equal(
    directionText({ startAzDeg: 352, endAzDeg: 131 }),
    'Rises in the N at 352°, sets in the SE at 131°',
  );
});

test('nextPassText: countdown, day, start in the rows clock, and from-to bearings', () => {
  const now = Date.parse('2026-11-02T03:00:00Z'); // 21:00 on 1 Nov in Chicago
  const tz = 'America/Chicago';
  const pass = (startIso, mins = 6) => {
    const startMs = Date.parse(startIso);
    return { startMs, endMs: startMs + mins * 60_000, startAzDeg: 225, endAzDeg: 135 };
  };
  assert.equal(nextPassText(pass('2026-11-02T03:41:00Z'), now, tz, 'en-GB'), 'in 41 min, Today 21:41, SW to SE');
  assert.equal(nextPassText(pass('2026-11-02T10:12:00Z'), now, tz, 'en-GB'), 'in 7 h 12 min, Tomorrow 04:12, SW to SE');
  assert.equal(nextPassText(pass('2026-11-03T18:00:00Z'), now, tz, 'en-GB'), 'in 1 day 15 h, Tue 3 Nov 12:00, SW to SE');
});

test('nextPassText: a pass already up says until when, and an ended one gives null', () => {
  const tz = 'America/Chicago';
  const startMs = Date.parse('2026-11-02T02:58:00Z');
  const p = { startMs, endMs: startMs + 6 * 60_000, startAzDeg: 0, endAzDeg: 90 };
  assert.equal(nextPassText(p, startMs + 60_000, tz, 'en-GB'), 'up now, until 21:04, N to E');
  assert.equal(nextPassText(p, p.endMs, tz, 'en-GB'), null);
});

test('nextPassText falls back to UTC for a zone the runtime does not know', () => {
  const startMs = Date.parse('2026-11-02T10:12:00Z');
  const p = { startMs, endMs: startMs + 60_000, startAzDeg: 0, endAzDeg: 180 };
  assert.equal(nextPassText(p, startMs - 3_600_000, 'Not/AZone', 'en-GB'), 'in 1 h, Today 10:12, N to S');
});
