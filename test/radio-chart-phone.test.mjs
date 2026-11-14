import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSvgRoot } from '../lib/og/dom.mjs';
import {
  paintRadioChart, paintRadioChartCompact, radioChartCaption, radioMethodsNote,
  tuneRows, COMPACT_FONT_PX, ADVANCE_EM, elevationMarks, tuneLabel, radioChartHeading,
} from '../lib/pass-finder/radio-chart.js';
import { radioPassSamples } from '../lib/pass-finder/radio-pass.js';
import { geodeticToEcef } from '../lib/coords.js';

// The phone view of the radio chart: a narrow live SVG plus HTML built from
// the same helpers the full image uses, so the two never disagree.

const E = geodeticToEcef(90, 0, 0);
const T0 = Date.UTC(2026, 8, 7, 9, 25, 0);
const stateAt = (d) => {
  const t = (d.getTime() - T0) / 1000;
  const p = [7500 * t, 0, E[2] + 739800];
  return { rTeme: [...p], vTeme: [7500, 0, 0], rEcef: [...p], gmst: 0 };
};
const series = (freqHz) => radioPassSamples(
  { latDeg: 90, lonDeg: 0 }, { startMs: T0 - 660000, endMs: T0 + 660000 },
  { satStateAt: stateAt, obsEcef: E, upEcef: [0, 0, 1] }, { freqHz, stepMs: 2000 });

const BASE = {
  satelliteName: 'ISS', observerName: 'My location',
  downlinkLabel: 'FM cross-band repeater', duty: 'on-demand',
  tz: 'America/Chicago', elevM: 244, elevSource: 'lookup', minElevDeg: 10,
  workableStartMs: T0 - 120000, workableEndMs: T0 + 120000,
};

const texts = (svg) => [...svg.querySelectorAll('text')].map((t) => t.textContent).join(' | ');

/** Text that runs outside [0, viewBox width], measured like the full chart's guard. */
function compactOverflows(meta, freqHz) {
  const svg = newSvgRoot('0 0 100 100');
  paintRadioChartCompact(svg, series(freqHz), meta);
  const vw = Number(svg.getAttribute('viewBox').split(' ')[2]);
  const bad = [];
  for (const t of svg.querySelectorAll('text')) {
    const px = COMPACT_FONT_PX[t.getAttribute('class')];
    if (!px) continue;
    const w = (t.textContent ?? '').length * px * ADVANCE_EM;
    const x = Number(t.getAttribute('x'));
    const anchor = t.getAttribute('text-anchor') ?? 'start';
    const left = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x;
    if (left < 0 || left + w > vw) bad.push(`${left.toFixed(1)}..${(left + w).toFixed(1)} of ${vw}: ${t.textContent}`);
  }
  return { bad, svg, vw };
}

test('the caption helper says what the full chart says', () => {
  const s = series(437.8e6);
  const meta = { ...BASE, freqHz: 437.8e6, jointStartMs: T0 - 60000, jointEndMs: T0 + 45000 };
  assert.equal(radioChartCaption(s, meta),
    'Swing is horizon-to-horizon. Shaded: above 10°. Brighter: every observer can hear it. Dots: Doppler at 10° and 30° up. Coloured on the left: the frequency at rise and set.');
  const svg = newSvgRoot('0 0 320 250');
  paintRadioChart(svg, s, meta);
  assert.ok(texts(svg).replace(/ \| /g, ' ').includes(radioChartCaption(s, meta)));
});

test('the caption helper keeps the truncated-window warning', () => {
  const cap = radioChartCaption(series(437.8e6), { ...BASE, freqHz: 437.8e6, clamped: true });
  assert.match(cap, /^WINDOW TRUNCATED/);
});

test('the methods note names the frequency, or says there is none', () => {
  assert.match(radioMethodsNote(series(437.8e6), { ...BASE, freqHz: 437.8e6 }), /437\.800 MHz/);
  assert.match(radioMethodsNote(series(null), { ...BASE, freqHz: null }), /No downlink frequency is set/);
});

test('tuneRows lists the 10 and 30 degree crossings and closest approach in time order', () => {
  const s = series(437.8e6);
  const rows = tuneRows(s, { ...BASE, freqHz: 437.8e6 });
  assert.deepEqual(rows.map((r) => r.label),
    ['10° rising', '30° rising', 'Closest approach', '30° setting', '10° setting']);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].tMs > rows[i - 1].tMs);
  const marks = elevationMarks(s.samples);
  const rise10 = marks.find((m) => m.deg === 10 && m.leg === 'rise');
  assert.equal(rows[0].tune, tuneLabel(437.8e6, rise10.dopplerHz / 1000));
  assert.match(rows[0].offset, /^\+\d+\.\d kHz$/);
  assert.match(rows[0].time, /^\d\d:\d\d:\d\d$/);
  assert.equal(rows[2].tune, '437.800');
  assert.equal(rows[2].offset, '0.0 kHz');
});

test('tuneRows is empty without a frequency', () => {
  assert.deepEqual(tuneRows(series(null), { ...BASE, freqHz: null }), []);
});

test('tuneRows falls back to UTC with no usable zone', () => {
  const rows = tuneRows(series(437.8e6), { ...BASE, freqHz: 437.8e6, tz: 'Not/AZone' });
  assert.equal(rows[2].time, new Date(Math.round(series(437.8e6).summary.tcaMs)).toISOString().slice(11, 19));
});

test('the phone chart has no title, tiles, caption or methods text', () => {
  const { svg } = compactOverflows({ ...BASE, freqHz: 437.8e6 }, 437.8e6);
  const t = texts(svg);
  assert.ok(!t.includes('ISS'));
  assert.ok(!/horizon-to-horizon|Predicted|SWING/i.test(t));
  assert.match(t, /Doppler \(kHz\)/);
  assert.match(t, /Tune \(MHz\)/);
  assert.match(t, /TCA/);
});

test('the phone chart keeps the 10 and 30 degree dots but not their labels', () => {
  const { svg } = compactOverflows({ ...BASE, freqHz: 437.8e6 }, 437.8e6);
  assert.equal(svg.querySelector('[data-layer="dopplerHz"]').querySelectorAll('circle').length, 4);
  assert.ok(!/10° \+/.test(texts(svg)));
});

test('the phone chart has three time ticks per row', () => {
  const { svg } = compactOverflows({ ...BASE, freqHz: 437.8e6 }, 437.8e6);
  const times = [...svg.querySelectorAll('text')].filter((t) => /^\d\d:\d\d:\d\d$/.test(t.textContent));
  assert.equal(times.length, 6);
});

test('no phone chart text runs outside its viewBox', () => {
  for (const [meta, f] of [
    [{ ...BASE, freqHz: 437.8e6 }, 437.8e6],
    [{ ...BASE, freqHz: 10489.55e6 }, 10489.55e6],
    [{ ...BASE, freqHz: null, downlinkLabel: undefined }, null],
    [{ ...BASE, freqHz: 437.8e6, jointStartMs: T0 - 60000, jointEndMs: T0 + 45000 }, 437.8e6],
  ]) {
    const { bad } = compactOverflows(meta, f);
    assert.deepEqual(bad, [], `overflowing:\n${bad.join('\n')}`);
  }
});

test('the phone chart is narrow enough for readable type on a 360 px phone', () => {
  // 360 px viewport, 96vw modal, 12 px padding each side: about 322 px of chart.
  const { vw } = compactOverflows({ ...BASE, freqHz: 437.8e6 }, 437.8e6);
  const scale = 322 / vw;
  assert.ok(COMPACT_FONT_PX['rc-tick'] * scale >= 9.5, `ticks ${(COMPACT_FONT_PX['rc-tick'] * scale).toFixed(1)} px`);
  assert.ok(COMPACT_FONT_PX['rc-panel'] * scale >= 10.5);
});

test('the phone chart uses its own clip ids, so it can share a page with the full chart', () => {
  const full = newSvgRoot('0 0 320 250');
  paintRadioChart(full, series(437.8e6), { ...BASE, freqHz: 437.8e6 });
  const phone = newSvgRoot('0 0 100 100');
  paintRadioChartCompact(phone, series(437.8e6), { ...BASE, freqHz: 437.8e6 });
  const ids = (svg) => new Set([...svg.querySelectorAll('clipPath')].map((c) => c.getAttribute('id')));
  const a = ids(full), b = ids(phone);
  assert.ok(b.size > 0);
  for (const id of b) assert.ok(!a.has(id), `shared clip id ${id}`);
});

test('the phone chart stylesheet uses the compact type sizes', () => {
  const { svg } = compactOverflows({ ...BASE, freqHz: 437.8e6 }, 437.8e6);
  const style = svg.querySelector('style').textContent;
  for (const [cls, px] of Object.entries(COMPACT_FONT_PX)) {
    assert.ok(style.includes(`.${cls}`) && style.includes(`font-size: ${px}px`), `${cls} = ${px}`);
  }
});

test('an empty series paints a small opaque canvas, not nothing', () => {
  const svg = newSvgRoot('0 0 100 100');
  paintRadioChartCompact(svg, { samples: [], summary: {} }, { ...BASE });
  assert.ok(svg.querySelector('.rc-canvas'));
});

test('the heading helper gives the full chart title and subtitle', () => {
  const h = radioChartHeading(series(437.8e6), { ...BASE, freqHz: 437.8e6 });
  assert.equal(h.title, 'ISS · 437.800 MHz');
  assert.equal(h.sub, 'FM cross-band repeater (on-demand) · My location · 2026-09-07');
  assert.equal(radioChartHeading(series(null), { ...BASE, freqHz: null, downlinkLabel: undefined }).title, 'ISS');
});

// The Doppler panel reads in MHz on the left, the axis people read first,
// with the kHz shift on the right; the rise and set frequencies sit on the
// left axis in the curve's colours, and no plain tick crowds them.
const dopTexts = (svg) => [...svg.querySelector('[data-layer="dopplerHz"]').querySelectorAll('text')];
for (const [name, paint, px, svgBox] of [
  ['full', paintRadioChart, 2.6, '0 0 320 250'],
  ['phone', paintRadioChartCompact, COMPACT_FONT_PX['rc-tick'], '0 0 100 100'],
]) {
  test(`${name} chart: Doppler panel in MHz on the left, kHz shift on the right`, () => {
    const svg = newSvgRoot(svgBox);
    paint(svg, series(437.8e6), { ...BASE, freqHz: 437.8e6 });
    const t = dopTexts(svg);
    const plot = svg.querySelector('[data-layer="dopplerHz"] .rc-bg');
    const x0 = Number(plot.getAttribute('x'));
    const left = t.filter((e) => e.getAttribute('class') === 'rc-tick' && Number(e.getAttribute('x')) < x0);
    const right = t.filter((e) => e.getAttribute('class') === 'rc-tick' && Number(e.getAttribute('x')) > x0);
    assert.ok(left.length >= 1 && left.every((e) => /^437\.\d{3,4}$/.test(e.textContent)), left.map((e) => e.textContent).join());
    assert.ok(right.length >= 1 && right.every((e) => /^([+-]\d+(\.\d+)?|0)$/.test(e.textContent)), right.map((e) => e.textContent).join());
    assert.ok(t.some((e) => e.textContent === 'Tune (MHz)' && e.getAttribute('class') === 'rc-panel'));
    assert.ok(t.some((e) => e.textContent === 'Doppler (kHz)' && e.getAttribute('class') === 'rc-axis'));
  });

  test(`${name} chart: the rise and set frequencies on the left axis, clear of the ticks`, () => {
    const s = series(437.8e6);
    const svg = newSvgRoot(svgBox);
    paint(svg, s, { ...BASE, freqHz: 437.8e6 });
    const t = dopTexts(svg);
    const ends = t.filter((e) => (e.getAttribute('class') ?? '').includes('rc-end'));
    const first = s.samples[0].dopplerHz / 1000, last = s.samples[s.samples.length - 1].dopplerHz / 1000;
    const sign = (v) => (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1));
    assert.deepEqual(ends.map((e) => e.textContent),
      [tuneLabel(437.8e6, first), sign(first), tuneLabel(437.8e6, last), sign(last)]);
    for (const e of ends) assert.match(e.getAttribute('style'), /fill: #/);
    const ticks = t.filter((e) => e.getAttribute('class') === 'rc-tick');
    for (const end of ends) {
      for (const tick of ticks) {
        assert.ok(Math.abs(Number(end.getAttribute('y')) - Number(tick.getAttribute('y'))) >= px * 1.2,
          `${tick.textContent} crowds ${end.textContent}`);
      }
    }
  });
}

test('without a frequency the range rate panel keeps its plain axis and no end labels', () => {
  const svg = newSvgRoot('0 0 320 250');
  paintRadioChart(svg, series(null), { ...BASE, freqHz: null, downlinkLabel: undefined });
  assert.equal(svg.querySelector('[data-layer="dopplerHz"]'), null);
  assert.equal(svg.querySelectorAll('.rc-end').length, 0);
});

test('the saved full chart carries the SeekSat watermark in its bottom-right corner, clear of the text', () => {
  const svg = newSvgRoot('0 0 320 250');
  paintRadioChart(svg, series(437.8e6), { ...BASE, freqHz: 437.8e6 });
  const [, , vw, vh] = svg.getAttribute('viewBox').split(' ').map(Number);
  const mark = svg.querySelector('.brand-wordmark');
  const url = svg.querySelector('.brand-url');
  assert.equal(mark.textContent, 'SeekSat');
  assert.equal(url.textContent, 'seeksat.com');
  assert.equal(svg.lastChild, url);
  assert.ok(svg.querySelector('style').textContent.includes("font-family: 'Exo 2'"));
  const x = Number(mark.getAttribute('x'));
  assert.ok(x <= vw && x > vw - 8, `x ${x} of ${vw}`);
  assert.ok(Number(url.getAttribute('y')) < vh && Number(url.getAttribute('y')) > vh - 8);
  // Every methods line ends left of the wordmark.
  const left = x - 'SeekSat'.length * 8 * 0.6;
  const wordTop = Number(mark.getAttribute('y')) - 8;
  for (const t of svg.querySelectorAll('.rc-meth, .rc-tick, .rc-axis')) {
    const ty = Number(t.getAttribute('y'));
    if (ty < wordTop) continue;
    const px = t.getAttribute('class').includes('rc-meth') ? 2.6 : 2.6;
    const tx = Number(t.getAttribute('x'));
    const anchor = t.getAttribute('text-anchor') ?? 'start';
    const right = anchor === 'end' ? tx : anchor === 'middle' ? tx + t.textContent.length * px * 0.3 : tx + t.textContent.length * px * 0.6;
    assert.ok(right < left, `${t.textContent} runs into the watermark`);
  }
});

test('the transmit panel labels both sides and carries its caption, full and phone', () => {
  const meta = { ...BASE, freqHz: 437_800_000, uplinkHz: 145_990_000 };
  const caption = 'Transmit low while it approaches and high as it leaves; it hears you on 145.990.';
  const full = newSvgRoot('0 0 100 100');
  paintRadioChart(full, series(437_800_000), meta);
  const phone = newSvgRoot('0 0 100 100');
  paintRadioChartCompact(phone, series(437_800_000), meta);
  for (const [name, svg] of [['full', full], ['phone', phone]]) {
    const layer = [...svg.querySelectorAll('g')].find((g) => g.getAttribute('data-layer') === 'uplinkDopplerHz');
    assert.ok(layer, `${name}: transmit panel drawn`);
    const t = [...layer.querySelectorAll('text')].map((x) => x.textContent);
    assert.ok(t.includes('approaching'), `${name}: approaching label`);
    assert.ok(t.includes('receding'), `${name}: receding label`);
    // The caption may wrap; its lines joined are the copy.
    const lines = t.filter((s) => caption.includes(s) && s.split(' ').length > 2);
    assert.equal(lines.join(' '), caption, `${name}: caption`);
  }
  assert.deepEqual(compactOverflows(meta, 437_800_000).bad, []);
});
