// Round a coordinate in degrees to 1 decimal place (about 11 km).
export function roundCoord(deg) {
  return Math.round(deg * 10) / 10;
}
