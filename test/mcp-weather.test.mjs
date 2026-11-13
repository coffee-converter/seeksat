// test/mcp-weather.test.mjs - get_pass_weather answers with a forecast or
// says plainly why it cannot, offline with a made-up forecast.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPassWeatherTool } from '../lib/mcp/tools.mjs';

const NOW = Date.parse('2026-11-14T12:00:00Z');
// Hourly from midnight UTC for 7 days: 20% cloud.
const FORECAST = { startMs: Date.parse('2026-11-14T00:00:00Z'), hours: Array.from({ length: 7 * 24 }, () => 20) };
const deps = (fetchWeather) => ({ now: () => NOW, geocode: async () => null, fetchWeather });
const AT = { lat: 41.88, lon: -87.63 };

test('a time inside the forecast gets cloud cover and a viewing probability', async () => {
  const out = await getPassWeatherTool({ ...AT, time: '2026-11-14T20:00' }, deps(async () => FORECAST));
  assert.equal(out.available, true);
  assert.equal(out.time, '2026-11-15T02:00:00.000Z', 'read on the Chicago clock');
  assert.equal(out.cloudCoverPct, 20);
  assert.ok(out.viewingProbability > 0.5 && out.viewingProbability <= 0.8);
  assert.equal(out.forecastSource, 'open-meteo+met.no');
  assert.equal(out.forecastUntil, '2026-11-20T23:00:00.000Z');
});

test('no forecast for the time, a failed fetch or an unreadable time: available false with a reason, no number', async () => {
  const cases = [
    [{ time: '2026-12-01T03:00:00Z' }, async () => FORECAST, /beyond the forecast, which reaches about 6 days ahead/],
    [{ time: '2026-11-01T03:00:00Z' }, async () => FORECAST, /before the forecast starts/],
    [{ time: '2026-11-14T20:00:00Z' }, async () => null, /could not be fetched/],
    [{ time: '2026-11-14T20:00:00Z' }, async () => { throw new Error('offline'); }, /could not be fetched/],
    [{ time: 'tonight' }, async () => FORECAST, /time "tonight" is not a time I can read\. Use ISO 8601, e\.g\./],
  ];
  for (const [input, fetchWeather, reason] of cases) {
    const out = await getPassWeatherTool({ ...AT, ...input }, deps(fetchWeather));
    assert.equal(out.available, false, input.time);
    assert.match(out.reason, reason);
    assert.equal(out.viewingProbability, undefined);
    assert.equal(out.cloudCoverPct, undefined);
  }
});
