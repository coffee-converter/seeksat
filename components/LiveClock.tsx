"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/ui/Icon";
import { otherClock } from "@/components/passes/PassStats";

/** "14:12:07" in UTC. */
export function utcClock(ms: number): string {
  return new Date(ms).toISOString().slice(11, 19);
}

/** "2:12:07 PM CST" (or "14:12:07 CST", as the viewer's clock is set), in
 *  `timeZone` or the browser's zone. */
export function localClock(ms: number, timeZone?: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short", timeZone,
  }).format(new Date(ms));
}

/**
 * The current time: UTC large with a live dot, then the viewer's local time.
 * The first render uses the passed `nowMs` and leaves the local line empty
 * (the browser's zone isn't known on the server), so hydration matches.
 * A null `nowMs` (a page whose clock starts after mount) shows dashes.
 */
export default function LiveClock({
  nowMs, timeZone, compact = false, pausedMs = null, place = null,
}: {
  nowMs: number | null;
  timeZone?: string;
  compact?: boolean;
  /** The map is paused at this time (an opened pass): shown in place of now. */
  pausedMs?: number | null;
  /** The location the passes are for: when its clock differs from the
   *  viewer's, the second line gives its time ("at Mendoza"), not "your time". */
  place?: { name: string; timeZone: string } | null;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const paused = pausedMs != null;
  const ms = paused ? pausedMs : nowMs;
  const utc = ms == null ? "--:--:--" : utcClock(ms);
  const elsewhere = mounted && ms != null && place != null && otherClock(ms, place.timeZone);
  const local = !mounted || ms == null ? ""
    : elsewhere && place ? `${localClock(ms, place.timeZone)} at ${place.name}`
      : `${localClock(ms, timeZone)}, your time`;

  return (
    <div
      className={["live-clock", compact && "live-clock--compact", paused && "live-clock--paused"].filter(Boolean).join(" ")}
      role="group"
      aria-label={paused ? "Map time, paused" : "Current time"}
    >
      <p className="live-clock__utc">
        {paused
          ? <Icon name="pause" className="live-clock__pause" />
          : <span className="live-clock__dot" aria-hidden="true" />}
        <span className="live-clock__live">{paused ? "Paused" : "Live"}</span>
        <time className="live-clock__time num" dateTime={ms == null ? undefined : new Date(ms).toISOString()}>
          {utc}
        </time>
        <span className="live-clock__zone">UTC</span>
      </p>
      <p className="live-clock__local num">{local || "\u00a0"}</p>
    </div>
  );
}
