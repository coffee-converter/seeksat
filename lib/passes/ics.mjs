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

// First physical line holds 75 octets; continuations are a space plus 74.
function fold(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
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

export function passToIcs({ satName, noradId, observer, pass, mode, nowMs, url = null }) {
  const elev = Math.round(pass.maxElevDeg);
  const kind = mode === 'radio' ? 'Radio' : 'Visual';
  const description = `${kind} pass. Rises at azimuth ${Math.round(pass.startAzDeg)}°, `
    + `peaks at ${elev}° at ${parts(pass.peakMs).clock} UTC, `
    + `sets at azimuth ${Math.round(pass.endAzDeg)}°.`;
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
    `DESCRIPTION:${escapeText(description)}`,
  ];
  if (url) lines.push(`URL:${url}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function icsFileName(satShortName, observerName, startMs) {
  const p = parts(startMs);
  return `${slug(satShortName, 'sat')}-pass-${slug(observerName, 'observer')}-${p.date}T${p.hm}Z.ics`;
}
