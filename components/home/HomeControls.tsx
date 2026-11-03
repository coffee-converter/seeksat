"use client";

import { MIN_ELEV_MAX, stepMinElev } from "@/lib/home/view.mjs";
import { SKY_TYPES } from "@/lib/sky/visual-rating.mjs";

const skyTypes = SKY_TYPES as ReadonlyArray<{ id: string; label: string }>;

interface Props {
  /** False until saved prefs are loaded: the controls show no values and are disabled. */
  ready: boolean;
  mode: "radio" | "visual";
  minElevDeg: number;
  /** How dark the sky is where the user watches; picked in visual mode only. */
  skyType: string;
  /** The saved location's name, or null when none is set. */
  locationName: string | null;
  onModeChange: (mode: "radio" | "visual") => void;
  onMinElevChange: (deg: number) => void;
  onSkyTypeChange: (skyType: string) => void;
  onChangeLocation: () => void;
}

// The settings under the map, as one group: the location the passes are for
// with its sky type (visual mode), then pass mode and minimum elevation.
export default function HomeControls({
  ready, mode, minElevDeg, skyType, locationName, onModeChange, onMinElevChange, onSkyTypeChange, onChangeLocation,
}: Props) {
  // How dark the sky is where you watch: it belongs with the location.
  const skySelect = mode === "visual" ? (
    <select
      className="home-controls__sky"
      aria-label="Sky type"
      title="Sky type"
      value={skyType}
      disabled={!ready}
      onChange={(e) => onSkyTypeChange(e.target.value)}
    >
      {skyTypes.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
    </select>
  ) : null;

  return (
    <div className="home-controls">
      {/* Where the passes are for comes first: everything below depends on it. */}
      {locationName != null && (
        <div className="home-controls__place">
          <span className="home-controls__label">Location</span>
          <span className="home-controls__name" title={locationName}>
            {locationName || "Your location"}
          </span>
          <button type="button" className="home-link" onClick={onChangeLocation}>
            Change
          </button>
          {skySelect}
        </div>
      )}

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
          Min elevation <span className={ready ? undefined : "home-controls__pending"}>{minElevDeg}°</span>
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

      {locationName == null && skySelect}

      {/* What the elevation setting does, under the row of controls. */}
      <p className="home-controls__hint">Min elevation hides lower passes and sizes the footprint circle.</p>

    </div>
  );
}
