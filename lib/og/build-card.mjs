// lib/og/build-card.mjs - compose the 1200x630 OG card: the centered
// circular chart as the hero, the two-tone Exo 2 wordmark + tagline +
// URL beneath. Centering keeps the key content inside the middle square
// so surfaces that crop the 1.91:1 card to a square still read.
// The tagline is text (Atkinson Hyperlegible Next, loaded by the rasterizer);
// the wordmark and URL are outlines (lib/og/wordmark.mjs).
import { wordmarkSvg, wordmarkUrlSvg } from './wordmark.mjs';

const W = 1200, H = 630;
const SEEK = "#8aa0c8", SAT = "#7eb8ff", URL_GRAY = "#6a7a9a", TAGLINE = "#aab8d4";
const CHART_SIDE = 478;
const CHART_X = Math.round((W - CHART_SIDE) / 2);
const CHART_Y = 12;
const SANS = "'Atkinson Hyperlegible Next', Helvetica, Arial, sans-serif";

export function buildCardSVG(chartSVG) {
  const chart = chartSVG.replace(
    /^<svg\b/,
    `<svg x="${CHART_X}" y="${CHART_Y}" width="${CHART_SIDE}" height="${CHART_SIDE}" preserveAspectRatio="xMidYMid meet"`,
  );
  const cx = W / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs><radialGradient id="vign" cx="50%" cy="40%" r="75%">
    <stop offset="0%" stop-color="#0e1428"/><stop offset="100%" stop-color="#070a14"/>
  </radialGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#vign)"/>
  ${chart}
  ${wordmarkSvg({ x: cx, y: 548, size: 62, anchor: 'middle', seekFill: SEEK, satFill: SAT, letterSpacing: 1 })}
  <text x="${cx}" y="582" text-anchor="middle" font-family="${SANS}" font-size="22" letter-spacing="0.4" fill="${TAGLINE}">Track any satellite · live map · passes · radio Doppler</text>
  ${wordmarkUrlSvg({ x: cx, y: 612, size: 18, anchor: 'middle', fill: URL_GRAY, letterSpacing: 2 })}
</svg>`;
}
