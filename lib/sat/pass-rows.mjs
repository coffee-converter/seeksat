// lib/sat/pass-rows.mjs - turns a pass-engine result into the rows and
// messages the satellite page shows.
import { accuracyNote, DEFAULT_SEARCH_DAYS } from '../passes/engine.mjs';
import { formatPassDuration } from '../passes/format.mjs';

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function compass(azDeg) {
  const i = Math.round((((azDeg % 360) + 360) % 360) / 45) % 8;
  return POINTS[i];
}

function azText(az) {
  const deg = ((Math.round(az) % 360) + 360) % 360;
  return `${compass(az)} ${deg}°`;
}

// names: { [obsId]: place name } for the joint-observer GEO message.
export function passRows(result, { epochMs, nowMs, minElevDeg, mode, timeZone, locale, names = {} }) {
  if (!result || result.kind === 'unavailable') {
    return { kind: 'message', text: "These elements can't be used to compute passes." };
  }
  if (result.kind === 'stationary') {
    const p = result.pointing?.[0];
    if (!p) return { kind: 'message', text: "These elements can't be used to compute passes." };
    const f = (n) => n.toFixed(1);
    if (result.visible) {
      return {
        kind: 'stationary',
        text: `Fixed in your sky at azimuth ${f(p.azDeg)}°, elevation ${f(p.elDeg)}°. Over a day it stays between ${f(p.elMinDeg)}° and ${f(p.elMaxDeg)}° up.`,
      };
    }
    // The first place that cannot see it is the one to name.
    const blocked = result.pointing.find((q) => q.elMaxDeg < minElevDeg) ?? p;
    if (blocked !== p && blocked.obsId !== 'home') {
      const place = names[blocked.obsId] || 'one of your places';
      return { kind: 'stationary', text: `It never rises above ${minElevDeg}° at ${place}.` };
    }
    return {
      kind: 'stationary',
      text: p.elMaxDeg < 0 ? 'It never rises here.' : `It never rises above ${minElevDeg}° here.`,
    };
  }
  if (!result.passes.length) {
    return {
      kind: 'message',
      text: mode === 'visual'
        ? `No visible passes in the next ${DEFAULT_SEARCH_DAYS} days.`
        : `No passes above ${minElevDeg}° in the next ${DEFAULT_SEARCH_DAYS} days.`,
    };
  }
  const day = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone });
  const clock = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone });
  const hm = (ms) => clock.format(ms);
  const rows = result.passes.map((pass) => ({
    key: String(pass.startMs),
    dayLabel: day.format(pass.startMs).replace(/,/g, ''),
    startLabel: hm(pass.startMs),
    peakLabel: hm(pass.peakMs),
    endLabel: hm(pass.endMs),
    durationLabel: formatPassDuration(pass.durationMs / 1000),
    maxElevLabel: `${Math.round(pass.maxElevDeg)}°`,
    azLabel: `${azText(pass.startAzDeg)} to ${azText(pass.endAzDeg)}`,
    visible: Boolean(pass.visible),
    inProgress: pass.startMs <= nowMs && nowMs < pass.endMs,
    runsPastEnd: Boolean(pass.runsPastEnd),
    accuracy: Number.isFinite(epochMs) ? (accuracyNote(epochMs, pass.peakMs)?.text ?? null) : null,
    pass,
  }));
  return { kind: 'rows', rows };
}
