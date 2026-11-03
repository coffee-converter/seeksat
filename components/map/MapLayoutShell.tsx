"use client";

// The one MapShell for / and /sat/<id>. It stays mounted across navigation, so
// the MapLibre map persists; each page publishes its scene to the store.

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import "@/app/home.css";
import "@/app/sat.css";
import FlatMap from "@/components/home/FlatMap";
import MapShell from "@/components/MapShell";
import { shellClassFor } from "@/lib/map/shell-route.mjs";
import { useMapScene } from "@/lib/map/scene-store";
import { useHomeStore } from "@/lib/home/store";
import { useFollow } from "@/lib/map/follow-store";
import SiteHeader from "./SiteHeader";

const noop = () => {};

export default function MapLayoutShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const scene = useMapScene((s) => s.scene);
  const projection = useHomeStore((s) => s.prefs.projection);
  const setPrefs = useHomeStore((s) => s.setPrefs);

  // Lock on is off whenever a page loads, including a hop between satellites.
  useEffect(() => {
    useFollow.getState().setFollowing(false);
  }, [pathname]);

  // A new page starts at the top of the panel, but the first render does not.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    document.querySelector(".map-shell__panel")?.scrollTo(0, 0);
  }, [pathname]);

  return (
    <MapShell
      className={shellClassFor(pathname, scene?.shellClass)}
      top={<SiteHeader />}
      notice={scene?.notice}
      offlineFromCache={scene?.offlineFromCache ?? false}
      map={(
        <>
          {scene?.above}
          <FlatMap
            fill
            sats={scene?.sats ?? []}
            observer={scene?.observer ?? null}
            projectionId={scene?.projectionId ?? projection}
            onProjectionChange={scene?.onProjectionChange ?? ((id) => setPrefs({ projection: id }))}
            selectedId={scene?.selectedId ?? null}
            minElevDeg={scene?.minElevDeg ?? 0}
            onSelect={scene?.onSelect ?? noop}
            top={scene?.top ?? null}
            chips={scene?.chips ?? null}
          />
        </>
      )}
      panel={children}
    />
  );
}
