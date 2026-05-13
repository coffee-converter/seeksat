// coords.js -- pure JS coord helpers. No Cesium dependency.

const DEG = Math.PI / 180;
const HOUR = Math.PI / 12;

// "42°09'15.9\"N" | "42.1544" | "-88.2" -> decimal degrees. N/E positive, S/W negative.
export function parseDmsToDecimal(str) {
  if (str == null) throw new Error('parseDmsToDecimal: null input');
  const s = String(str).trim().replace(/′/g, "'").replace(/″/g, '"');
  if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const m = s.match(
    /^\s*(-?\d+(?:\.\d+)?)\s*°?\s*(?:(\d+(?:\.\d+)?)\s*['m]?\s*(?:(\d+(?:\.\d+)?)\s*["s]?)?)?\s*([NSEWnsew])?\s*$/
  );
  if (!m) throw new Error(`parseDmsToDecimal: cannot parse "${str}"`);
  const deg = parseFloat(m[1]);
  const min = m[2] ? parseFloat(m[2]) : 0;
  const sec = m[3] ? parseFloat(m[3]) : 0;
  const hemi = m[4] && m[4].toUpperCase();
  const baseSign = deg < 0 ? -1 : 1;
  const hemiSign = (hemi === 'S' || hemi === 'W') ? -1 : 1;
  return baseSign * hemiSign * (Math.abs(deg) + min / 60 + sec / 3600);
}

// "5h 30m 52.4110s" | "5 30 52.411" | "5.5145586" -> hours.
export function parseRaToHours(str) {
  const s = String(str).trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const m = s.match(
    /^\s*(\d+(?:\.\d+)?)\s*[h:\s]\s*(\d+(?:\.\d+)?)\s*[m':\s]\s*(\d+(?:\.\d+)?)\s*[s"]?\s*$/
  );
  if (!m) throw new Error(`parseRaToHours: cannot parse "${str}"`);
  return parseFloat(m[1]) + parseFloat(m[2]) / 60 + parseFloat(m[3]) / 3600;
}

// "41° 51' 10.0489\"" | "-12 30 45" | decimal -> decimal degrees.
export function parseDecToDegrees(str) {
  return parseDmsToDecimal(str);
}
