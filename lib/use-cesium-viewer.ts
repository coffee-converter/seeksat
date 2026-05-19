"use client";

import { useEffect, useRef, useState } from "react";
import { makeViewer, wireSimTime, MakeViewerOptions } from "./cesium-viewer";
import { cesiumReady } from "./cesium-loaded";
import type { CesiumViewer } from "@/types/cesium";

// Creates a Cesium.Viewer in the supplied container once the CDN
// script reports ready (via the layout's CesiumLoader / cesium-loaded
// promise — no polling). Returns:
//   - viewer: the created Viewer, or null until ready
//   - status: "waiting" | "ready" | "error"
//
// On unmount, calls viewer.destroy(). A `cancelled` flag inside the
// effect guarantees a teardown during the await doesn't instantiate
// a viewer after unmount.
export function useCesiumViewer(
  containerRef: React.RefObject<HTMLDivElement | null>,
  opts: MakeViewerOptions = {},
): { viewer: CesiumViewer | null; status: "waiting" | "ready" | "error" } {
  const [viewer, setViewer] = useState<CesiumViewer | null>(null);
  const [status, setStatus] = useState<"waiting" | "ready" | "error">(
    "waiting",
  );
  // Stash opts in a ref so the effect can read them without resubscribing
  // when the caller passes a fresh object every render.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    let cancelled = false;
    let v: CesiumViewer | null = null;

    cesiumReady()
      .then(() => {
        if (cancelled || !containerRef.current) return;
        try {
          v = makeViewer(containerRef.current, optsRef.current);
          wireSimTime(v, { precision: 4 });
          setViewer(v);
          setStatus("ready");
        } catch (err) {
          console.error("Cesium init failed:", err);
          setStatus("error");
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Cesium script load failed:", err);
        setStatus("error");
      });

    return () => {
      cancelled = true;
      if (v && typeof v.destroy === "function") {
        try { v.destroy(); } catch { /* ignore */ }
      }
    };
  }, [containerRef]);

  return { viewer, status };
}
