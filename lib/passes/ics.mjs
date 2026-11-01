// lib/passes/ics.mjs - one satellite pass as an RFC 5545 iCalendar event.
import { slug } from '../pass-finder/text.js';

const pad = (n, w = 2) => String(n).padStart(w, '0');

function parts(ms) {
  const d = new Date(Math.floor(ms / 1000) * 1000);
  return {
    date: `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`,
    hm: `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`,
    s: pad(d.getUTCSeconds()),
    clock: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`,
  };
}

const utc = (ms) => { const p = parts(ms); return `${p.date}T${p.hm}${p.s}Z`; };

const escapeText = (s) => String(s)
  .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

const utf8 = new TextEncoder();

// First physical line holds 75 octets; continuations are a space plus 74.
function fold(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = utf8.encode(ch).length;
    if (bytes + n > limit) {
      out.push(cur);
      cur = ' ';
      bytes = 1;
      limit = 75;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n');
}

export function passToIcs({ satName, noradId, observer, pass, mode, nowMs, url = null,
  observerCount = 1, inProgress = false }) {
  const elev = Math.round(pass.maxElevDeg);
  const Mode = mode === 'radio' ? 'Radio' : 'Visual';
  const lowMode = Mode.toLowerCase();
  const A = Math.round(pass.startAzDeg);
  const B = Math.round(pass.endAzDeg);
  const T = parts(pass.peakMs).clock;
  let description;
  if (observerCount > 1) {
    description = `Joint ${lowMode} pass for ${observerCount} observers. All see it above ${elev}° at the peak, ${T} UTC. `
      + `Azimuths for ${observer.name}: ${A}° at the start, ${B}° at the end.`;
  } else if (inProgress) {
    description = `${Mode} pass, already in progress. Peaks at ${elev}° at ${T} UTC, ends at azimuth ${B}°.`;
  } else if (mode !== 'radio') {
    description = `Visual pass. Appears at azimuth ${A}°, peaks at ${elev}° at ${T} UTC, disappears at azimuth ${B}°.`;
  } else {
    description = `Radio pass. Rises at azimuth ${A}°, peaks at ${elev}° at ${T} UTC, sets at azimuth ${B}°.`;
  }
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SeekSat//Passes//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${noradId}-${pass.startMs}-${slug(observer.name, 'observer')}@seeksat.app`,
    `DTSTAMP:${utc(nowMs)}`,
    `DTSTART:${utc(pass.startMs)}`,
    `DTEND:${utc(pass.endMs)}`,
    `SUMMARY:${escapeText(`${satName} pass, max ${elev}°`)}`,
    `LOCATION:${escapeText(observer.name)}`,
    `GEO:${observer.latDeg.toFixed(4)};${observer.lonDeg.toFixed(4)}`,
    `DESCRIPTION:${escapeText(url ? `${description}\nDetails: ${url}` : description)}`,
  ];
  if (url) lines.push(`URL:${url}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function icsFileName(satShortName, observerName, startMs) {
  const p = parts(startMs);
  return `${slug(satShortName, 'sat')}-pass-${slug(observerName, 'observer')}-${p.date}T${p.hm}Z.ics`;
}
