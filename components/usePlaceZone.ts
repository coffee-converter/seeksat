"use client";

import { useEffect, useState } from "react";
import { zoneFrom } from "@/lib/time/zone.mjs";

type Lookup = (latDeg: number, longDeg: number) => string;

// The zone map is 28 KB, so it loads once, on the first page with a place.
let lookup: Lookup | null = null;
let loading: Promise<Lookup | null> | null = null;
function loadLookup(): Promise<Lookup | null> {
  loading ??= import("@photostructure/tz-lookup")
    .then((m) => (lookup = (m.default ?? m) as Lookup))
    .catch(() => {
      loading = null; // try again on the next page
      return null;
    });
  return loading;
}

export const viewerZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The place's time zone; the viewer's own until the zone map has loaded. */
export function usePlaceZone(latDeg: number | null | undefined, lonDeg: number | null | undefined): string {
  const [ready, setReady] = useState<Lookup | null>(() => lookup);
  const hasPlace = latDeg != null && lonDeg != null;
  useEffect(() => {
    if (!hasPlace || ready) return;
    let live = true;
    loadLookup().then((f) => { if (live && f) setReady(() => f); });
    return () => { live = false; };
  }, [hasPlace, ready]);
  return hasPlace ? zoneFrom(ready, latDeg, lonDeg, viewerZone()) as string : viewerZone();
}
