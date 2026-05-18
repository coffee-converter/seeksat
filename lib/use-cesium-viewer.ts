"use client";

import { useEffect, useRef, useState } from "react";
import { makeViewer, wireSimTime, MakeViewerOptions } from "./cesium-viewer";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCesiumViewer = any;

// Creates a Cesium.Viewer in the supplied container once window.Cesium
// loads. Polls every 100ms with a 10s timeout — matches the legacy
// strategy that the wrap-and-mount bootstrap used. Returns:
//   - viewer: the created Viewer, or null until ready
//   - status: "waiting" | "ready" | "error"
//
// On unmount, calls viewer.destroy(). Cleanup is idempotent; the
// effect uses a `cancelled` flag so a teardown during the polling
// phase doesn't accidentally instantiate a viewer after unmount.
export function useCesiumViewer(
  containerRef: React.RefObject<HTMLDivElement | null>,
  opts: MakeViewerOptions = {},
): { viewer: AnyCesiumViewer | null; status: "waiting" | "ready" | "error" } {
  const [viewer, setViewer] = useState<AnyCesiumViewer | null>(null);
  const [status, setStatus] = useState<"waiting" | "ready" | "error">(
    "waiting",
  );
  // Stash opts in a ref so the effect can read them without resubscribing
  // when the caller passes a fresh object every render.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    let cancelled = false;
    let v: AnyCesiumViewer | null = null;
    const start = Date.now();
    const interval = window.setInterval(() => {
      if (cancelled) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (typeof (window as any).Cesium !== "undefined" && containerRef.current) {
        window.clearInterval(interval);
        try {
          v = makeViewer(containerRef.current, optsRef.current);
          wireSimTime(v, { precision: 4 });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).__viewer = v;
          setViewer(v);
          setStatus("ready");
        } catch (err) {
          console.error("Cesium init failed:", err);
          setStatus("error");
        }
        return;
      }
      if (Date.now() - start > 10_000) {
        window.clearInterval(interval);
        setStatus("error");
      }
    }, 100);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      if (v && typeof v.destroy === "function") {
        try { v.destroy(); } catch { /* ignore */ }
      }
    };
  }, [containerRef]);

  return { viewer, status };
}
