// lib/og/sat-card.mjs - 1200x630 link-preview card for /sat/<id> pages.
// Same dark look and Exo 2 wordmark as the pass card (build-card.mjs).
import { wrapText } from '../pass-finder/text.js';
import { formatNumber } from '../sat/numbers.mjs';
import { wordmarkSvg, wordmarkUrlSvg } from './wordmark.mjs';

const W = 1200, H = 630;
const SEEK = '#8aa0c8', SAT = '#7eb8ff', URL_GRAY = '#6a7a9a', TAGLINE = '#aab8d4', TEXT = '#e6ecf8';
const SANS = "'Atkinson Hyperlegible Next', Helvetica, Arial, sans-serif";
const NAME_CHARS = 24;
const MAX_LINES = 2;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function nameLines(name) {
  const lines = wrapText(name, NAME_CHARS);
  if (lines.length <= MAX_LINES) return lines;
  const second = `${lines[1]}...`;
  return [lines[0], second.length > NAME_CHARS ? `${second.slice(0, NAME_CHARS - 3)}...` : second];
}

export function buildSatCardSvg({ name, noradId, intlDesignator, elements, ageText }) {
  const lines = nameLines(name);
  const nameSvg = lines.map((l, i) =>
    `<text data-name-line="1" x="80" y="${200 + i * 76}" font-family="${SANS}" font-weight="600" font-size="68" fill="${TEXT}">${esc(l)}</text>`).join('\n  ');
  let y = 200 + (lines.length - 1) * 76 + 70;
  const detail = [];
  const idLine = intlDesignator ? `NORAD ${noradId} · ${intlDesignator}` : `NORAD ${noradId}`;
  detail.push(`<text x="80" y="${y}" font-family="${SANS}" font-size="34" fill="${TAGLINE}">${esc(idLine)}</text>`);
  if (elements) {
    y += 52;
    const o = `Orbit ${formatNumber(elements.perigeeAltKm, 0)} by ${formatNumber(elements.apogeeAltKm, 0)} km · ${formatNumber(elements.periodMin, 1)} min · ${formatNumber(elements.inclinationDeg, 1)}°`;
    detail.push(`<text x="80" y="${y}" font-family="${SANS}" font-size="34" fill="${TAGLINE}">${esc(o)}</text>`);
  }
  if (ageText) {
    y += 52;
    detail.push(`<text x="80" y="${y}" font-family="${SANS}" font-size="28" fill="${URL_GRAY}">${esc(ageText)}</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs><radialGradient id="vign" cx="50%" cy="40%" r="75%">
    <stop offset="0%" stop-color="#0e1428"/><stop offset="100%" stop-color="#070a14"/>
  </radialGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#vign)"/>
  ${wordmarkSvg({ x: 80, y: 96, size: 52, seekFill: SEEK, satFill: SAT, letterSpacing: 1 })}
  ${nameSvg}
  ${detail.join('\n  ')}
  ${wordmarkUrlSvg({ x: 80, y: 590, size: 22, fill: URL_GRAY, letterSpacing: 2 })}
</svg>`;
}
