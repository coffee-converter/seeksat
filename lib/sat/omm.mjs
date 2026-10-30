// lib/sat/omm.mjs - pure helpers for CelesTrak OMM (GP JSON) records.
// No I/O.

const NUMERIC = [
  'MEAN_MOTION', 'ECCENTRICITY', 'INCLINATION', 'RA_OF_ASC_NODE', 'ARG_OF_PERICENTER',
  'MEAN_ANOMALY', 'EPHEMERIS_TYPE', 'NORAD_CAT_ID', 'ELEMENT_SET_NO', 'REV_AT_EPOCH',
  'BSTAR', 'MEAN_MOTION_DOT', 'MEAN_MOTION_DDOT',
];
const REQUIRED = [
  'MEAN_MOTION', 'ECCENTRICITY', 'INCLINATION', 'RA_OF_ASC_NODE', 'ARG_OF_PERICENTER',
  'MEAN_ANOMALY', 'NORAD_CAT_ID', 'BSTAR',
];

// EPOCH is UTC without a trailing Z.
export function ommEpochMs(omm) {
  const s = String(omm.EPOCH);
  return Date.parse(/(Z|[+-]\d\d:?\d\d)$/.test(s) ? s : `${s}Z`);
}

export function normalizeOmm(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const o = { ...raw };
  for (const k of NUMERIC) {
    if (o[k] === undefined || o[k] === null || o[k] === '') continue;
    o[k] = Number(o[k]);
  }
  for (const k of REQUIRED) {
    if (!Number.isFinite(o[k])) return null;
  }
  if (!Number.isInteger(o.NORAD_CAT_ID) || o.NORAD_CAT_ID < 0) return null;
  if (typeof o.EPOCH !== 'string' || !Number.isFinite(ommEpochMs(o))) return null;
  if (!Number.isFinite(o.MEAN_MOTION_DOT)) o.MEAN_MOTION_DOT = 0;
  if (!Number.isFinite(o.MEAN_MOTION_DDOT)) o.MEAN_MOTION_DDOT = 0;
  if (!Number.isFinite(o.EPHEMERIS_TYPE)) o.EPHEMERIS_TYPE = 0;
  if (!Number.isFinite(o.ELEMENT_SET_NO)) o.ELEMENT_SET_NO = 0;
  if (!Number.isFinite(o.REV_AT_EPOCH)) o.REV_AT_EPOCH = 0;
  if (!o.CLASSIFICATION_TYPE) o.CLASSIFICATION_TYPE = 'U';
  return o;
}

function checksum(line) {
  let sum = 0;
  for (const c of line) {
    if (c >= '0' && c <= '9') sum += Number(c);
    else if (c === '-') sum += 1;
  }
  return sum % 10;
}

// Implied-decimal exponent form: 10270-3 means 0.10270e-3. Width 8 with sign.
function expField(x) {
  if (!x) return ' 00000+0';
  const sign = x < 0 ? '-' : ' ';
  let a = Math.abs(x);
  let exp = Math.floor(Math.log10(a)) + 1;
  let mant = Math.round((a / 10 ** exp) * 1e5);
  if (mant >= 100000) { mant = Math.round(mant / 10); exp += 1; }
  return `${sign}${String(mant).padStart(5, '0')}${exp < 0 ? '-' : '+'}${Math.abs(exp)}`;
}

function epochField(ms) {
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  const day = (ms - Date.UTC(year, 0, 1)) / 86_400_000 + 1;
  return `${String(year % 100).padStart(2, '0')}${day.toFixed(8).padStart(12, '0')}`;
}

function designator(objectId) {
  const m = /^(\d{4})-(\d{3})([A-Z]*)$/.exec(String(objectId ?? ''));
  return m ? `${m[1].slice(2)}${m[2]}${m[3]}`.padEnd(8) : ''.padEnd(8);
}

// Expects a normalizeOmm'd object. Rev and element set numbers wrap to their field widths.
export function ommToTleLines(omm) {
  if (omm.NORAD_CAT_ID > 99999) return null;
  const id = String(omm.NORAD_CAT_ID).padStart(5, '0');
  const ndot = omm.MEAN_MOTION_DOT;
  const ndotStr = `${ndot < 0 ? '-' : ' '}${Math.abs(ndot).toFixed(8).slice(1)}`;
  const l1 = [
    '1 ', id, omm.CLASSIFICATION_TYPE || 'U', ' ', designator(omm.OBJECT_ID), ' ',
    epochField(ommEpochMs(omm)), ' ', ndotStr, ' ', expField(omm.MEAN_MOTION_DDOT), ' ',
    expField(omm.BSTAR), ' ', String(omm.EPHEMERIS_TYPE || 0), ' ',
    String(omm.ELEMENT_SET_NO % 10000).padStart(4),
  ].join('');
  const ecc = String(Math.round(omm.ECCENTRICITY * 1e7)).padStart(7, '0');
  const l2 = [
    '2 ', id, ' ', omm.INCLINATION.toFixed(4).padStart(8), ' ',
    omm.RA_OF_ASC_NODE.toFixed(4).padStart(8), ' ', ecc, ' ',
    omm.ARG_OF_PERICENTER.toFixed(4).padStart(8), ' ', omm.MEAN_ANOMALY.toFixed(4).padStart(8), ' ',
    omm.MEAN_MOTION.toFixed(8).padStart(11), String(omm.REV_AT_EPOCH % 100000).padStart(5),
  ].join('');
  return { line1: l1 + checksum(l1), line2: l2 + checksum(l2) };
}
