"use client";

import { useEffect, useState } from "react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyViewer = any;

// Play / Pause / Reset buttons + speed picker. Clock manipulation is
// pure Cesium API; no store slice needed yet. Reset also fires a
// `passes-reset` CustomEvent so the bootstrap can deselect the active
// pass window (that state still lives there; will move to the store
// when the windows list migrates).
export default function PlaybackControls({ viewer }: { viewer: AnyViewer | null }) {
  const [multiplier, setMultiplier] = useState(10);

  // Apply the current multiplier to the viewer's clock whenever either
  // changes (handles the case where viewer arrives after the user
  // already picked a speed).
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Cesium = (window as any).Cesium;
    viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date());
    viewer.clock.shouldAnimate = false;
    window.dispatchEvent(new CustomEvent("passes-reset"));
  };

  return (
    <>
      <div className="ctl-group playback">
        <button id="play-btn"  type="button" title="Play"  onClick={onPlay}>▶</button>
        <button id="pause-btn" type="button" title="Pause" onClick={onPause}>⏸</button>
        <button id="reset-btn" type="button" title="Reset to now" onClick={onReset}>⏮</button>
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
