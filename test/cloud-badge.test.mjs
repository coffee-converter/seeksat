import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloudBadge, sharedCloudNote } from '../lib/sky/cloud-badge.mjs';
import { roundCoord } from '../lib/sky/round-coords.mjs';

test('cloudBadge grades on the raw forecast cloud percent', () => {
  assert.equal(cloudBadge(0, 0.5).level, 'clear');
  assert.equal(cloudBadge(30, 0.5).level, 'clear');
  assert.equal(cloudBadge(30, 0.5).label, 'Clear');
  assert.equal(cloudBadge(30.1, 0.5).level, 'some');
  assert.equal(cloudBadge(60, 0.5).level, 'some');
  assert.equal(cloudBadge(60, 0.5).label, 'Some cloud');
  assert.equal(cloudBadge(60.1, 0.5).level, 'cloudy');
  assert.equal(cloudBadge(90, 0.5).label, 'Cloudy');
});

test('cloudBadge does not drift toward some cloud as the forecast ages', () => {
  assert.equal(cloudBadge(0, 3.9).level, 'clear');
  assert.equal(cloudBadge(100, 3.9).level, 'cloudy');
});

test('cloudBadge appends (forecast) from 2 days out', () => {
  assert.equal(cloudBadge(10, 2).label, 'Clear (forecast)');
  assert.equal(cloudBadge(80, 3.5).label, 'Cloudy (forecast)');
  assert.equal(cloudBadge(10, 1.99).label, 'Clear');
});

test('cloudBadge is null without data or beyond 4 days', () => {
  assert.equal(cloudBadge(null, 1), null);
  assert.equal(cloudBadge(undefined, 1), null);
  assert.notEqual(cloudBadge(10, 4), null);
  assert.equal(cloudBadge(10, 4.01), null);
  assert.equal(cloudBadge(10, 8), null);
});

test('cloudBadge title gives percent and age', () => {
  assert.equal(cloudBadge(42.4, 0.5).title, '42% cloud forecast, under a day ahead');
  assert.equal(cloudBadge(42.4, 0.99).title, '42% cloud forecast, under a day ahead');
  assert.equal(cloudBadge(42.4, 1).title, '42% cloud forecast, 1 day ahead');
  assert.equal(cloudBadge(42.4, 1.6).title, '42% cloud forecast, 1 day ahead');
  assert.equal(cloudBadge(42.4, 2).title, '42% cloud forecast, 2 days ahead');
  assert.equal(cloudBadge(42.4, 3.9).title, '42% cloud forecast, 3 days ahead');
});

test('roundCoord rounds to 1 decimal', () => {
  assert.equal(roundCoord(41.8781), 41.9);
  assert.equal(roundCoord(-87.6298), -87.6);
});

test('sharedCloudNote: one line when every pass has the same cloud', () => {
  const b = (level) => ({ level, label: '', title: '' });
  assert.equal(sharedCloudNote([b('cloudy'), b('cloudy')]), 'Cloudy forecast for every pass below.');
  assert.equal(sharedCloudNote([b('some'), b('some'), b('some')]), 'Some cloud forecast for every pass below.');
  assert.equal(sharedCloudNote([b('clear'), b('clear')]), 'Clear skies forecast for every pass below.');
  assert.equal(sharedCloudNote([b('cloudy'), b('some')]), null);
  assert.equal(sharedCloudNote([b('cloudy'), null]), null);
  assert.equal(sharedCloudNote([b('cloudy')]), null);
  assert.equal(sharedCloudNote([]), null);
});
