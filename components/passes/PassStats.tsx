"use client";

import { passStats, timeFormat } from "@/lib/home/view.mjs";
import { useFlash } from "@/lib/ui/use-flash";

type Stat = { label: string; value: string; sub?: string | null };
type StatPass = { startMs: number; endMs: number; peakMs: number; durationMs: number; maxElevDeg: number; peakAzDeg?: number | null; inProgress?: boolean };
const statsOf = passStats as (pass: StatPass, nowMs: number, o: {
  timeZone?: string; clock: (ms: number, tz?: string) => string; weekday?: boolean;
}) => { first: Stat; max: Stat; last: Stat };

/** The site's pass clock, with no-break spaces so "6:27 PM" never wraps apart. */
export const passTime = (ms: number, timeZone?: string) =>
  (timeFormat as (l: undefined, tz?: string) => Intl.DateTimeFormat)(undefined, timeZone).format(ms).replace(/\s/g, " ");

/** Text that flashes when it changes, such as a countdown ticking down. */
export function FlashText({ value }: { value: string }) {
  const flash = useFlash(value);
  return <span className={flash ? `flash-text ${flash}` : "flash-text"}>{value}</span>;
}

/** One stat column: a small label, the value, and a quieter line under it. */
function StatCell({ stat, live = false }: { stat: Stat; live?: boolean }) {
  return (
    <div className="pass-card__stat">
      <dt>{stat.label}</dt>
      <dd className="pass-card__stat-value">{stat.value}</dd>
      {stat.sub && (
        <dd className={`pass-card__stat-sub${live ? " pass-card__stat-sub--live" : ""}`}>
          <FlashText value={stat.sub} />
        </dd>
      )}
    </div>
  );
}

/**
 * A pass's three stat columns, Starts (or Ends), Max and Lasts (or Left), in
 * the same place on every home card and satellite page row. `mag` goes under
 * Lasts in visual mode; `weekday: false` suits a list under day headings.
 */
export default function PassStats({ pass, nowMs, timeZone, mag = null, maxSub, weekday = true, className = "" }: {
  pass: StatPass; nowMs: number; timeZone?: string; mag?: string | null;
  /** Replaces the line under Max (its compass point); null leaves it empty. */
  maxSub?: string | null;
  weekday?: boolean; className?: string;
}) {
  const stats = statsOf(pass, nowMs, { timeZone, clock: passTime, weekday });
  return (
    <dl className={`pass-card__stats${className ? ` ${className}` : ""}`}>
      <StatCell stat={stats.first} live={stats.first.label === "Ends"} />
      <StatCell stat={maxSub === undefined ? stats.max : { ...stats.max, sub: maxSub }} />
      <StatCell stat={{ ...stats.last, sub: mag }} />
    </dl>
  );
}
