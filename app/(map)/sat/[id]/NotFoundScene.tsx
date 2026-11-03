"use client";

// Gives the not-found drawer a map scene: an empty sky, working header
// search, and the saved projection.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useHomeStore } from "@/lib/home/store";
import { usePublishMapScene } from "@/lib/map/scene-store";
import { satPath } from "@/lib/sat/page-data.mjs";

export default function NotFoundScene() {
  const router = useRouter();
  const hydrate = useHomeStore((s) => s.hydrate);
  const setPrefs = useHomeStore((s) => s.setPrefs);
  const projection = useHomeStore((s) => s.prefs.projection);
  useEffect(() => { hydrate(); }, [hydrate]);

  usePublishMapScene({
    sats: [],
    observer: null,
    selectedSub: null,
    projectionId: projection,
    onProjectionChange: (id) => setPrefs({ projection: id }),
    selectedId: null,
    minElevDeg: 0,
    onSelect: () => {},
    search: { onView: (id) => router.push(satPath(id) as string), onClearFocus: () => {} },
  });
  return null;
}
