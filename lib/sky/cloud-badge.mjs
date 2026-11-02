import { effectivePClear } from '../pass-finder/ratings.js';

/**
 * @typedef {{ level: 'clear' | 'some' | 'cloudy', label: string, title: string }} CloudBadge
 */

/**
 * Badge for a pass given the forecast cloud percent at its peak and how many
 * days ahead the pass is. Null when there is no forecast or it is too far out.
 * @param {number | null | undefined} cloudPct
 * @param {number} ageDays
 * @returns {CloudBadge | null}
 */
export function cloudBadge(cloudPct, ageDays) {
  if (cloudPct == null || ageDays > 7) return null;
  const p = effectivePClear(cloudPct, ageDays);
  let level;
  let label;
  if (p >= 0.7) { level = 'clear'; label = 'Clear'; }
  else if (p >= 0.4) { level = 'some'; label = 'Some cloud'; }
  else { level = 'cloudy'; label = 'Cloudy'; }
  if (ageDays >= 3) label += ' (forecast)';
  const days = Math.round(ageDays);
  const when = ageDays < 1 ? 'today' : `${days} ${days === 1 ? 'day' : 'days'} ahead`;
  return { level, label, title: `${Math.round(cloudPct)}% cloud forecast, ${when}` };
}
