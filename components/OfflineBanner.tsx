"use client";

import { useSyncExternalStore } from "react";

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
 *  run on the live clock, so the data says how old it is. */
export default function OfflineBanner() {
  const offline = useSyncExternalStore(subscribe, () => !navigator.onLine, () => false);
  if (!offline) return null;
  return (
    <p className="offline-banner" role="status">
      You&apos;re offline. Showing the last saved satellites.
    </p>
  );
}
