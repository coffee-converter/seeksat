"use client";

import { usePassFinderStore } from "@/lib/pass-finder-store";

// Min-elevation stepper. 1° increments, clamped to [0, 60]. The scene
// watches store.minElevDeg and re-runs the search (debounced) when it
// changes.
const MIN_ELEV_STEP = 1;
const MIN_ELEV_MIN = 0;
const MIN_ELEV_MAX = 60;

export default function MinElevControl() {
  const minElevDeg = usePassFinderStore((s) => s.minElevDeg);
  const setMinElevDeg = usePassFinderStore((s) => s.setMinElevDeg);

  const step = (delta: number) => {
    const raw = minElevDeg + delta;
    const snapped = Math.round(raw / MIN_ELEV_STEP) * MIN_ELEV_STEP;
    const clamped = Math.max(MIN_ELEV_MIN, Math.min(MIN_ELEV_MAX, snapped));
    if (clamped !== minElevDeg) setMinElevDeg(clamped);
  };

  return (
    <div
      id="min-elev-control"
      className="min-elev"
      title="Minimum elevation every observer must clear"
    >
      <button
        type="button"
        className="min-elev-step"
        data-step="-1"
        aria-label="Decrease minimum elevation"
        disabled={minElevDeg - MIN_ELEV_STEP < MIN_ELEV_MIN}
        onClick={() => step(-MIN_ELEV_STEP)}
      >
        -
      </button>
      <span id="min-elev-value" className="min-elev-value">
        {minElevDeg}°
      </span>
      <button
        type="button"
        className="min-elev-step"
        data-step="1"
        aria-label="Increase minimum elevation"
        disabled={minElevDeg + MIN_ELEV_STEP > MIN_ELEV_MAX}
        onClick={() => step(MIN_ELEV_STEP)}
      >
        +
      </button>
    </div>
  );
}
