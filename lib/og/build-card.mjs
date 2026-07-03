// lib/og/build-card.mjs - compose the 1200x630 OG card: the centered
// circular chart as the hero, the two-tone Exo 2 wordmark + tagline +
// URL beneath. Centering keeps the key content inside the middle square
// so surfaces that crop the 1.91:1 card to a square still read.
// Fonts resolve at rasterize time (resvg loads Exo 2 + Arimo buffers),
// so text uses font-family directly - no outline-path workaround.
const W = 1200, H = 630;
const SEEK = "#8aa0c8", SAT = "#7eb8ff", URL_GRAY = "#6a7a9a", TAGLINE = "#aab8d4";
const CHART_SIDE = 478;
const CHART_X = Math.round((W - CHART_SIDE) / 2);
const CHART_Y = 12;
const SANS = "Arimo, Helvetica, Arial, sans-serif";

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
  <text x="${cx}" y="548" text-anchor="middle" font-family="Exo 2" font-weight="600" font-size="62" letter-spacing="1"><tspan fill="${SEEK}">Seek</tspan><tspan fill="${SAT}">Sat</tspan></text>
  <text x="${cx}" y="582" text-anchor="middle" font-family="${SANS}" font-size="22" letter-spacing="0.4" fill="${TAGLINE}">Satellite pass forecasts · visual &amp; radio · multi-station</text>
  <text x="${cx}" y="612" text-anchor="middle" font-family="Exo 2" font-weight="400" font-size="18" letter-spacing="2" fill="${URL_GRAY}">seeksat.com</text>
</svg>`;
}
