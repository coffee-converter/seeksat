// lib/brand/marks.mjs - The SeekSat mark: the pass card's sky plot,
// simplified (COMPASS, the A2 design), and its small cut for 16 and 32 px
// (SMALL, A16). The icons (scripts/build-icons.mjs) and the share images
// (lib/og/globe-card.mjs) draw from these.

export const COMPASS = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="29" fill="#1c2b53" stroke="#7eb8ff" stroke-width="3.5"/>
  <circle cx="32" cy="32" r="13" fill="none" stroke="#7eb8ff" stroke-width="1.6" stroke-opacity="0.4"/>
  <path d="M15 45 Q20 20 43 18" fill="none" stroke="#ff9b54" stroke-width="7" stroke-linecap="round"/>
  <path d="M54 17 L42 10.5 L43 24.5 Z" fill="#ff9b54"/>
  <circle cx="15" cy="45" r="5" fill="#1c2b53" stroke="#ff9b54" stroke-width="3.5"/>
</svg>`;

export const SMALL = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="29" fill="#1c2b53" stroke="#7eb8ff" stroke-width="5"/>
  <path d="M14 47 Q18 18 48 16" fill="none" stroke="#ff9b54" stroke-width="10" stroke-linecap="round"/>
</svg>`;

/** The mark on the page's background, filling a square (app icons, which the
 *  system rounds or masks itself), with room around it. */
export function onSquare(mark) {
  const inner = mark.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="#0e1428"/>
  <g transform="translate(6.4 6.4) scale(0.8)">${inner}</g>
</svg>`;
}

