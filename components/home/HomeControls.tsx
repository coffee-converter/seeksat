"use client";

import { MIN_ELEV_MAX, stepMinElev } from "@/lib/home/view.mjs";
import { SKY_TYPES } from "@/lib/sky/visual-rating.mjs";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Segmented from "@/components/ui/Segmented";
import Surface from "@/components/ui/Surface";
import { Details } from "@/components/ui/Disclosure";
import { useHomeStore } from "@/lib/home/store";
import { BANDS, BAND_IDS, parseBands } from "@/lib/radio/bands.mjs";

const bandList = BANDS as ReadonlyArray<{ id: string; label: string }>;
const bandsFrom = parseBands as (v: unknown) => string[] | null;

/** Radio mode: the bands this radio covers, saved on the device. Frequencies
 *  outside them do not count: no radio mark, no default to tune to. */
function BandPicker({ ready }: { ready: boolean }) {
  const bands = useHomeStore((s) => s.prefs.bands);
  const setPrefs = useHomeStore((s) => s.setPrefs);
  const on = (id: string) => bands == null || bands.includes(id);
  const toggle = (id: string) => {
    const now = bands ?? [...(BAND_IDS as readonly string[])];
    const next = now.includes(id) ? now.filter((b) => b !== id) : [...now, id];
    setPrefs({ bands: bandsFrom(next) });
  };
  // Name the shorter list: what is on, or (when most are) what is off.
  const labels = (ids: string[]) => bandList.filter((b) => ids.includes(b.id)).map((b) => b.label).join(", ");
  const off = bands == null ? [] : (BAND_IDS as readonly string[]).filter((id) => !bands.includes(id));
  const summary = bands == null ? "all bands"
    : bands.length === 0 ? "no bands"
      : off.length < bands.length ? `all but ${labels(off)}` : labels(bands);
  return (
    <Details className="home-controls__bands" summary={<span>{`Your radio hears ${ready ? summary : "…"}`}</span>}>
      <div className="home-controls__band-row" role="group" aria-label="Bands your radio covers">
        {bandList.map((b) => (
          <Button key={b.id} size="sm" pressed={on(b.id)} disabled={!ready} onClick={() => toggle(b.id)}>
            {b.label}
          </Button>
        ))}
      </div>
    </Details>
  );
}

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
  /** "Times are Tokyo time (UTC+9)." when the place keeps another clock than the viewer's. */
  zoneNote?: string | null;
  onModeChange: (mode: "radio" | "visual") => void;
  onMinElevChange: (deg: number) => void;
  onSkyTypeChange: (skyType: string) => void;
  onChangeLocation: () => void;
}

// The settings under the map, as one group: the location the passes are for
// with its sky type (visual mode), then pass mode and minimum elevation.
export default function HomeControls({
  ready, mode, minElevDeg, skyType, locationName, zoneNote = null, onModeChange, onMinElevChange, onSkyTypeChange, onChangeLocation,
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
      {locationName != null && zoneNote && <p className="home-controls__hint home-controls__zone">{zoneNote}</p>}

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

      {mode === "radio" && <BandPicker ready={ready} />}

      {/* What the elevation setting does, under the row of controls. */}
      <p className="home-controls__hint">Min elevation hides lower passes and sizes the footprint circle.</p>

    </Surface>
  );
}
