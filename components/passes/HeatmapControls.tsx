"use client";

import { usePassFinderStore } from "@/lib/pass-finder-store";

// Floating heatmap controls. The toggle is always visible; the window
// selector, metric toggle, and legend appear only while heatmap mode is
// on. Inconspicuous overlay style, matching the app's other floating
// controls (no reserved header chrome).
export default function HeatmapControls() {
  const on = usePassFinderStore((s) => s.heatmapMode);
  const windowDays = usePassFinderStore((s) => s.heatmapWindowDays);
  const metric = usePassFinderStore((s) => s.heatmapMetric);
  const maxCount = usePassFinderStore((s) => s.heatmapMaxCount);
  const cloudAvailable = usePassFinderStore((s) => s.heatmapCloudAvailable);
  const computing = usePassFinderStore((s) => s.heatmapComputing);

  const setMode = usePassFinderStore((s) => s.setHeatmapMode);
  const setWindowDays = usePassFinderStore((s) => s.setHeatmapWindowDays);
  const setMetric = usePassFinderStore((s) => s.setHeatmapMetric);

  return (
    <div id="heatmap-controls" className="ctl-group" data-active={on}>
      <button
        type="button"
        className="heatmap-toggle"
        aria-pressed={on}
        onClick={() => setMode(!on)}
        title="Toggle the regional pass-quality heatmap"
      >
        Heatmap
      </button>

      {on && (
        <>
          <div className="heatmap-windows" role="group" aria-label="Heatmap window">
            {([1, 7, 14] as const).map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={windowDays === d}
                onClick={() => setWindowDays(d)}
              >
                {d}d
              </button>
            ))}
          </div>

          <div className="heatmap-metric" role="group" aria-label="Heatmap metric">
            <button
              type="button"
              aria-pressed={metric === "count"}
              onClick={() => setMetric("count")}
              title="Number of good passes (P% ≥ 50%) per location"
            >
              Good passes
            </button>
            <button
              type="button"
              aria-pressed={metric === "bestP"}
              onClick={() => setMetric("bestP")}
              title="Best single-pass probability per location"
            >
              Best P%
            </button>
          </div>

          <div className="heatmap-legend" aria-live="polite">
            {computing
              ? "Computing…"
              : metric === "count"
                ? `0–${maxCount} good passes`
                : "0–100% best pass"}
            {!cloudAvailable && !computing ? " · clouds: N/A" : ""}
          </div>
        </>
      )}
    </div>
  );
}
