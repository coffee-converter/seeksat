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
  const selectWindow = usePassFinderStore((s) => s.selectWindow);
  // viewer.clock.multiplier is the source of truth. The dropdown just
  // mirrors it. The scene writes the clock directly (10× after a
  // search, 1× on the no-observers boot), so we can't sync once on
  // mount — we'd go stale. Instead we track the clock every frame via
  // onTick (fires continuously even while paused) so the dropdown
  // always shows the real speed.
  const [multiplier, setMultiplier] = useState(1);

  useEffect(() => {
    if (!viewer) return;
    const sync = () => {
      const m = viewer.clock.multiplier ?? 1;
      setMultiplier((prev) => (prev === m ? prev : m));
    };
    sync(); // immediate, don't wait for the first tick
    return viewer.clock.onTick.addEventListener(sync);
  }, [viewer]);

  // User-driven dropdown change: write the clock directly (the onTick
  // sync above will mirror it straight back). We deliberately do NOT
  // push multiplier → clock from an effect, so React's value can never
  // clobber a speed the scene just set.
  const onSpeedChange = (value: number) => {
    setMultiplier(value);
    if (viewer) viewer.clock.multiplier = value;
  };

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
    // wrong system clock still gets accurate "now." Drop back to live
    // 1× speed and start playing so "Now" means "watch real time."
    viewer.clock.currentTime = window.Cesium.JulianDate.fromDate(new Date(trueNow()));
    viewer.clock.multiplier = 1;
    viewer.clock.shouldAnimate = true;
    setMultiplier(1);
    selectWindow(-1);
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
          onChange={(e) => onSpeedChange(Number(e.target.value))}
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
