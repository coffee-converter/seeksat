"use client";

import { useEffect, useState } from "react";
import { getClockSkewMs, hasClockSyncSample } from "@/lib/pass-finder/clock-sync.js";

// Surfaces a short inline note when the user's system clock is far
// enough off real-world UTC that they'd see confusingly-shifted pass
// times. The threshold (60 s) is well above normal NTP-synced clock
// drift + the natural network-latency component of the skew sample.
//
// SeekSat's pass-search code paths use trueNow() (from clock-sync)
// rather than new Date(), so the forecasts are already correct
// regardless of system-clock skew. The banner just tells the user
// why their wall clock might disagree with what we display.
const THRESHOLD_MS = 60_000;

function formatSkew(ms: number): string {
  const abs = Math.abs(ms);
  const fast = ms < 0; // client clock faster than server → negative offset
  if (abs < 60_000) {
    return `${(abs / 1000).toFixed(0)} s ${fast ? "fast" : "slow"}`;
  }
  if (abs < 3_600_000) {
    return `${Math.round(abs / 60_000)} min ${fast ? "fast" : "slow"}`;
  }
  return `${Math.round(abs / 3_600_000)} h ${fast ? "fast" : "slow"}`;
}

export default function ClockSkewBanner() {
  const [skewMs, setSkewMs] = useState<number | null>(null);

  useEffect(() => {
    // Sample once after the TLE fetch has had a chance to settle. The
    // clock-sync module updates on every TLE response; we poll a few
    // times across the first 15s so we don't miss a slow source.
    let cancelled = false;
    const samples = [2500, 5000, 10_000, 15_000];
    const timers = samples.map((delay) =>
      window.setTimeout(() => {
        if (cancelled) return;
        if (hasClockSyncSample()) setSkewMs(getClockSkewMs());
      }, delay),
    );
    return () => {
      cancelled = true;
      timers.forEach(window.clearTimeout);
    };
  }, []);

  if (skewMs === null || Math.abs(skewMs) < THRESHOLD_MS) return null;

  return (
    <div className="clock-skew-banner" role="status">
      <strong>Heads up:</strong> your device clock is ~{formatSkew(skewMs)} -
      forecasts use server time, so they'll still be right.
    </div>
  );
}
