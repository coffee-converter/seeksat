"use client";

import { useEffect } from "react";

// How long after the worker takes over to keep handing it late fetches.
const WARM_MS = 30_000;

/** Registers /sw.js after load, in production only (public/sw.js). The first
 *  load runs before the worker controls the page, so once it takes control
 *  this hands it the page and every fetch that went around it (workerStart 0),
 *  including ones still in flight, to save for offline use. Renders nothing. */
export default function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    const sw = navigator.serviceWorker;
    let observer: PerformanceObserver | null = null;
    let stopTimer: ReturnType<typeof setTimeout> | null = null;

    const warm = () => {
      const seen = new Set<string>();
      const send = (entries: PerformanceEntryList) => {
        const urls: string[] = [];
        for (const e of entries as PerformanceResourceTiming[]) {
          if (e.workerStart === 0 && !seen.has(e.name)) {
            seen.add(e.name);
            urls.push(e.name);
          }
        }
        if (urls.length) sw.controller?.postMessage({ type: "warm", urls });
      };
      sw.controller?.postMessage({ type: "warm", page: location.href, urls: [] });
      send(performance.getEntriesByType("resource"));
      observer = new PerformanceObserver((list) => send(list.getEntries()));
      observer.observe({ type: "resource" });
      stopTimer = setTimeout(() => observer?.disconnect(), WARM_MS);
    };
    if (!sw.controller) sw.addEventListener("controllerchange", warm, { once: true });

    const register = () => {
      sw.register("/sw.js").catch(() => {
        /* no worker: SeekSat still works online */
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    return () => {
      window.removeEventListener("load", register);
      sw.removeEventListener("controllerchange", warm);
      observer?.disconnect();
      if (stopTimer) clearTimeout(stopTimer);
    };
  }, []);

  return null;
}
