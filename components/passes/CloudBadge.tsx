import { cloudBadge, type CloudBadge as Badge } from "@/lib/sky/cloud-badge.mjs";
import { cloudAt } from "@/lib/pass-finder/weather.js";
import type { Forecast } from "@/lib/sky/use-clouds";

const DAY_MS = 86_400_000;
const badgeOf = cloudBadge as (cloudPct: number | null | undefined, ageDays: number) => Badge | null;
const cloudPctAt = cloudAt as (forecast: Forecast | null, ms: number) => number | null;

/** The cloud badge for a pass from the forecast at its peak, or null. */
export function passCloud(forecast: Forecast | null, pass: { peakMs: number }, nowMs: number): Badge | null {
  if (!forecast) return null;
  return badgeOf(cloudPctAt(forecast, pass.peakMs), (pass.peakMs - nowMs) / DAY_MS);
}

/** Clear, Some cloud or Cloudy at the pass peak: always a word, the colour backs it up. */
export default function CloudBadge({ forecast, pass, nowMs }: {
  forecast: Forecast | null;
  pass: { peakMs: number };
  nowMs: number;
}) {
  const badge = passCloud(forecast, pass, nowMs);
  if (!badge) return null;
  return <span className={`cloud cloud--${badge.level}`} title={badge.title}>{badge.label}</span>;
}
