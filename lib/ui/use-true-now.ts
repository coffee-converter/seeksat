"use client";

import { useEffect, useState } from "react";
import { trueNow } from "@/lib/pass-finder/clock-sync.js";

/**
 * The skew-corrected clock, ticking on whole seconds of the displayed time:
 * one timeout to the next boundary, then an interval. It starts after mount
 * (so server render and hydration agree) and pauses while the tab is hidden.
 * Null until then, unless initialMs gives the first render a value.
 */
export function useTrueNow(intervalMs = 1000, initialMs: number | null = null): number | null {
  const [nowMs, setNowMs] = useState<number | null>(initialMs);
  useEffect(() => {
    let first: number | undefined;
    let id: number | undefined;
    const stop = () => {
      if (first !== undefined) window.clearTimeout(first);
      if (id !== undefined) window.clearInterval(id);
      first = undefined;
      id = undefined;
    };
    const start = () => {
      stop();
      setNowMs(trueNow());
      first = window.setTimeout(() => {
        first = undefined;
        setNowMs(trueNow());
        id = window.setInterval(() => setNowMs(trueNow()), intervalMs);
      }, intervalMs - (trueNow() % intervalMs));
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    if (document.hidden) setNowMs(trueNow());
    else start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs]);
  return nowMs;
}
