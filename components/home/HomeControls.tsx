"use client";

import { MIN_ELEV_MAX, stepMinElev } from "@/lib/home/view.mjs";

interface Props {
  /** False until saved prefs are loaded: the controls show no values and are disabled. */
  ready: boolean;
  mode: "radio" | "visual";
  minElevDeg: number;
  /** The saved location's name, or null when none is set. */
  locationName: string | null;
  onModeChange: (mode: "radio" | "visual") => void;
  onMinElevChange: (deg: number) => void;
  onChangeLocation: () => void;
}

// The settings row under the map: pass mode, minimum elevation and the
// location the cards are computed from.
export default function HomeControls({
  ready, mode, minElevDeg, locationName, onModeChange, onMinElevChange, onChangeLocation,
}: Props) {
  return (
    <div className="home-controls">
      <div className="home-controls__mode" role="group" aria-label="Pass mode">
        {(["radio", "visual"] as const).map((m) => (
          <button
            key={m}
            type="button"
            className="home-chip"
            aria-pressed={ready && mode === m}
            disabled={!ready}
            onClick={() => onModeChange(m)}
          >
            {m === "radio" ? "Radio" : "Visual"}
          </button>
        ))}
      </div>

      <div className="home-controls__elev" role="group" aria-label="Minimum elevation">
        <button
          type="button"
          className="home-chip"
          aria-label="Lower minimum elevation"
          disabled={!ready || minElevDeg <= 0}
          onClick={() => onMinElevChange(stepMinElev(minElevDeg, -1))}
        >
          {"−"}
        </button>
        <span className="home-controls__value" aria-live="polite" title="Minimum elevation">
          Min <span className={ready ? undefined : "home-controls__pending"}>{minElevDeg}°</span>
        </span>
        <button
          type="button"
          className="home-chip"
          aria-label="Raise minimum elevation"
          disabled={!ready || minElevDeg >= MIN_ELEV_MAX}
          onClick={() => onMinElevChange(stepMinElev(minElevDeg, 1))}
        >
          +
        </button>
      </div>

      {locationName != null && (
        <div className="home-controls__place">
          <span className="home-controls__name" title={locationName}>
            {locationName || "Your location"}
          </span>
          <button type="button" className="home-link" onClick={onChangeLocation}>
            Change
          </button>
        </div>
      )}
    </div>
  );
}
