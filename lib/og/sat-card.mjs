// lib/og/sat-card.mjs - 1200x630 link-preview card for /sat/<id> pages: the
// share globe (globe-card) under where the satellite is now, its track for
// one orbit around it, and its name, catalog number and orbit.
import { formatNumber, periodShort } from '../sat/numbers.mjs';
import { buildGlobeCardSvg } from './globe-card.mjs';

const BLANK = { centre: { lonDeg: 0, latDeg: 0 } };

export function buildSatCardSvg({ name, noradId, intlDesignator, elements, ageText, scene = null }) {
  const lines = [intlDesignator ? `NORAD ${noradId} · ${intlDesignator}` : `NORAD ${noradId}`];
  if (elements) {
    lines.push(`Orbit ${formatNumber(elements.perigeeAltKm, 0)} by ${formatNumber(elements.apogeeAltKm, 0)} km · ${[periodShort(elements.periodMin), `${formatNumber(elements.inclinationDeg, 1)}°`].filter(Boolean).join(' · ')}`);
  }
  if (ageText) lines.push(ageText);
  return buildGlobeCardSvg({ ...(scene ?? BLANK), title: name, lines });
}
