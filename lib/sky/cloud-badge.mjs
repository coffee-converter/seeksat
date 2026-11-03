/**
 * @typedef {{ level: 'clear' | 'some' | 'cloudy', label: string, title: string }} CloudBadge
 */

/**
 * Badge for a pass given the forecast cloud percent at its peak and how many
 * days ahead the pass is. Graded on the raw forecast so the badge says what
 * the forecast says. Null when there is no forecast or it is too far out.
 * @param {number | null | undefined} cloudPct
 * @param {number} ageDays
 * @returns {CloudBadge | null}
 */
export function cloudBadge(cloudPct, ageDays) {
  if (cloudPct == null || ageDays > 4) return null;
  let level;
  let label;
  if (cloudPct <= 30) { level = 'clear'; label = 'Clear'; }
  else if (cloudPct <= 60) { level = 'some'; label = 'Some cloud'; }
  else { level = 'cloudy'; label = 'Cloudy'; }
  if (ageDays >= 2) label += ' (forecast)';
  const days = Math.floor(ageDays);
  const when = ageDays < 1 ? 'under a day ahead' : `${days} ${days === 1 ? 'day' : 'days'} ahead`;
  return { level, label, title: `${Math.round(cloudPct)}% cloud forecast, ${when}` };
}

const SHARED_WORDS = { clear: 'Clear skies', some: 'Some cloud', cloudy: 'Cloudy' };

/**
 * One line for the top of the list when two or more passes all have the same
 * cloud level, so each card need not repeat it. Null otherwise.
 * @param {(CloudBadge | null)[]} badges
 * @returns {string | null}
 */
export function sharedCloudNote(badges) {
  if (badges.length < 2 || badges.some((b) => !b)) return null;
  const level = badges[0].level;
  if (badges.some((b) => b.level !== level)) return null;
  return `${SHARED_WORDS[level]} forecast for every pass below.`;
}
