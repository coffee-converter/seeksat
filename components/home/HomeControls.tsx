"use client";

import { MIN_ELEV_MAX, stepMinElev } from "@/lib/home/view.mjs";
import { SKY_TYPES } from "@/lib/sky/visual-rating.mjs";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Segmented from "@/components/ui/Segmented";
import Surface from "@/components/ui/Surface";

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
    <div className="home-controls__sky">
      <Field label="Sky type" hideLabel>
        <select title="Sky type" value={skyType} disabled={!ready} onChange={(e) => onSkyTypeChange(e.target.value)}>
          {skyTypes.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </Field>
    </div>
  ) : null;

  return (
    <Surface className="home-controls">
      {/* Where the passes are for comes first: everything below depends on it. */}
      {locationName != null && (
        <div className="home-controls__place">
          <span className="home-controls__label">Location</span>
          <span className="home-controls__name" title={locationName}>
            {locationName || "Your location"}
          </span>
          <Button variant="link" onClick={onChangeLocation}>
            Change
          </Button>
          {skySelect}
        </div>
      )}

      <Segmented
        label="Pass mode"
        size="sm"
        options={[{ value: "radio", label: "Radio", disabled: !ready }, { value: "visual", label: "Visual", disabled: !ready }]}
        value={ready ? mode : null}
        onChange={onModeChange}
      />

      <div className="home-controls__elev" role="group" aria-label="Minimum elevation">
        <Button
          variant="quiet"
          iconOnly
          aria-label="Lower minimum elevation"
          disabled={!ready || minElevDeg <= 0}
          onClick={() => onMinElevChange(stepMinElev(minElevDeg, -1))}
        >
          {"−"}
        </Button>
        <span className="home-controls__value" aria-live="polite" title="Minimum elevation">
          {/* One inline run: the box is a flex container, which would drop the space. */}
          <span>Min elevation <span className={ready ? undefined : "home-controls__pending"}>{minElevDeg}°</span></span>
        </span>
        <Button
          variant="quiet"
          iconOnly
          aria-label="Raise minimum elevation"
          disabled={!ready || minElevDeg >= MIN_ELEV_MAX}
          onClick={() => onMinElevChange(stepMinElev(minElevDeg, 1))}
        >
          +
        </Button>
      </div>

      {locationName == null && skySelect}

      {/* What the elevation setting does, under the row of controls. */}
      <p className="home-controls__hint">Min elevation hides lower passes and sizes the footprint circle.</p>

    </Surface>
  );
}
