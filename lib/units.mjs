// lib/units.mjs - Distances and speeds in the viewer's units: kilometres, or
// miles where that is the everyday unit. The setting (prefs.units) is
// 'auto' (from the device's region), 'metric' or 'imperial'.

export const UNIT_PREFS = ['auto', 'metric', 'imperial'];
export const KM_PER_MI = 1.609344;

/** Regions where distances are everyday miles (the US, Liberia, Myanmar). */
const MILE_REGIONS = new Set(['US', 'LR', 'MM']);

/** The region of a locale tag ("en-US" is US), or null. */
function regionOf(locale) {
  if (!locale) return null;
  try {
    return new Intl.Locale(locale).maximize().region ?? null;
  } catch {
    const m = /[-_]([A-Za-z]{2})\b/.exec(locale);
    return m ? m[1].toUpperCase() : null;
  }
}

/** 'metric' or 'imperial' for a setting and the device's locale. */
export function resolveUnits(pref, locale) {
  if (pref === 'metric' || pref === 'imperial') return pref;
  return MILE_REGIONS.has(regionOf(locale) ?? '') ? 'imperial' : 'metric';
}

// The units pure modules (the map's labels) format with, kept in step with
// the setting by useUnits (lib/ui/use-units.ts).
let current = 'metric';
export function setCurrentUnits(units) {
  current = units === 'imperial' ? 'imperial' : 'metric';
}
export function currentUnits() {
  return current;
}

/** A length in km as { value, unit } in `units`. */
export function lengthIn(km, units = current) {
  return units === 'imperial' ? { value: km / KM_PER_MI, unit: 'mi' } : { value: km, unit: 'km' };
}

/** "1,578 km" or "981 mi", rounded to `digits` decimals. */
export function distanceText(km, units = current, digits = 0) {
  if (!Number.isFinite(km)) return '';
  const { value, unit } = lengthIn(km, units);
  return `${value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${unit}`;
}

/** A speed in km/s as { value, unit } ('km/s' or 'mi/s'). */
export function speedIn(kmS, units = current) {
  return units === 'imperial' ? { value: kmS / KM_PER_MI, unit: 'mi/s' } : { value: kmS, unit: 'km/s' };
}
