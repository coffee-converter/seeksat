"use client";

import { useEffect, useState } from "react";

/** "14:12:07" in UTC. */
export function utcClock(ms: number): string {
  return new Date(ms).toISOString().slice(11, 19);
}

/** "14:12:07 CST", in `timeZone` or the browser's zone. */
export function localClock(ms: number, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    timeZoneName: "short", timeZone,
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("hour")}:${get("minute")}:${get("second")} ${get("timeZoneName")}`.trim();
}

/**
 * The current time: UTC large with a live dot, then the viewer's local time.
 * The first render uses the passed `nowMs` and leaves the local line empty
 * (the browser's zone isn't known on the server), so hydration matches.
 * A null `nowMs` (a page whose clock starts after mount) shows dashes.
 */
export default function LiveClock({
  nowMs, timeZone, compact = false,
}: { nowMs: number | null; timeZone?: string; compact?: boolean }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const utc = nowMs == null ? "--:--:--" : utcClock(nowMs);
  const local = mounted && nowMs != null ? `${localClock(nowMs, timeZone)}, your time` : "";

  return (
    <div className={compact ? "live-clock live-clock--compact" : "live-clock"} role="group" aria-label="Current time">
      <p className="live-clock__utc">
        <span className="live-clock__dot" aria-hidden="true" />
        <span className="live-clock__live">Live</span>
        <time className="live-clock__time" dateTime={nowMs == null ? undefined : new Date(nowMs).toISOString()}>
          {utc}
        </time>
        <span className="live-clock__zone">UTC</span>
      </p>
      <p className="live-clock__local">{local || "\u00a0"}</p>
    </div>
  );
}
