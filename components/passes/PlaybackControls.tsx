"use client";

import { useEffect, useState } from "react";
import { usePassFinderStore } from "@/lib/pass-finder-store";
import { useViewer } from "@/lib/cesium-viewer-context";
import { trueNow } from "@/lib/pass-finder/clock-sync.js";

// Play / Pause / Reset buttons + speed picker. Clock manipulation is
// pure Cesium API; Reset also clears the active window via the store
// (the scene subscribes to activeWindowIdx and handles the visual
// teardown). Viewer comes from the CesiumViewerProvider — null until
// the CDN script + container both land.
export default function PlaybackControls() {
  const { viewer } = useViewer();
  const setActiveWindowIdx = usePassFinderStore((s) => s.setActiveWindowIdx);
  // The dropdown shows whatever value React state holds; viewer.clock
  // is the actual source of truth. Initial state is a placeholder
  // that gets overwritten the moment the viewer becomes available
  // (the sync effect below). Without this, the dropdown would show
  // 10× even when the scene parked the clock at 1× (no-observers
  // bootstrap) — visible mismatch between the dropdown and reality.
  const [multiplier, setMultiplier] = useState(1);

  // Sync local state FROM viewer the first time we see it (or any
  // time it reappears). After that, user-driven changes in the
  // dropdown push back into viewer.clock via the next effect.
  useEffect(() => {
    if (!viewer) return;
    const current = viewer.clock.multiplier ?? 1;
    setMultiplier(current);
  }, [viewer]);

  // Push user-driven multiplier changes into the viewer's clock.
  useEffect(() => {
    if (!viewer) return;
    viewer.clock.multiplier = multiplier;
  }, [viewer, multiplier]);

  const onPlay = () => {
    if (viewer) viewer.clock.shouldAnimate = true;
  };
  const onPause = () => {
    if (viewer) viewer.clock.shouldAnimate = false;
  };
  const onReset = () => {
    if (!viewer) return;
    // Snap the clock to current real-world UTC. trueNow() comes from
    // the clock-sync offset (HTTP Date header sample) so a user with a
    // wrong system clock still gets accurate "now." Preserves
    // shouldAnimate so a playing clock keeps ticking forward.
    viewer.clock.currentTime = window.Cesium.JulianDate.fromDate(new Date(trueNow()));
    setActiveWindowIdx(-1);
  };

  return (
    <>
      <div className="ctl-group playback">
        <button id="play-btn"  type="button" title="Play"  onClick={onPlay}>▶</button>
        <button id="pause-btn" type="button" title="Pause" onClick={onPause}>⏸</button>
        <button id="reset-btn" type="button" title="Jump clock to current real-world time" onClick={onReset}>Now</button>
      </div>
      <label className="speed-label">
        Speed
        <select
          id="speed-select"
          value={multiplier}
          onChange={(e) => setMultiplier(Number(e.target.value))}
        >
          <option value="1">×1</option>
          <option value="10">×10</option>
          <option value="60">×60</option>
          <option value="600">×600</option>
          <option value="1000">×1000</option>
          <option value="4000">×4000</option>
          <option value="10000">×10000</option>
          <option value="30000">×30000</option>
        </select>
      </label>
    </>
  );
}
