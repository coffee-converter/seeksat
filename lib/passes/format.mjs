// lib/passes/format.mjs - pass duration label: 5m18s under an hour, 8h07m after.

export function formatPassDuration(durationSec) {
  const s = Math.round(durationSec);
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
}
