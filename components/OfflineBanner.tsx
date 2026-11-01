"use client";

import { useSyncExternalStore } from "react";
import { offlineText } from "@/lib/pwa/offline.mjs";

const subscribe = (onChange: () => void) => {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
};

/** Shown while the browser is offline. The service worker (public/sw.js) then
 *  serves the last saved pages and satellites; their element-age tags still
 *  run on the live clock, so the data says how old it is. fromCache: the
 *  page's satellites came from the worker's cache, so say they are saved. */
export default function OfflineBanner({ fromCache = false }: { fromCache?: boolean }) {
  const offline = useSyncExternalStore(subscribe, () => !navigator.onLine, () => false);
  if (!offline) return null;
  return (
    <p className="offline-banner" role="status">
      {(offlineText as (saved: boolean) => string)(fromCache)}
    </p>
  );
}
