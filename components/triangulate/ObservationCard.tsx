"use client";

import { useTriangulateStore } from "@/lib/store";
import {
  parseDmsToDecimal,
  parseRaToHours,
  parseDecToDegrees,
} from "@/lib/coords.js";
import type { Observation, ObservationDirection } from "@/lib/types";

// One observer card. All fields write through updateObservation;
// partial/unparseable input is kept in rawLat/rawLon/rawV1/rawV2 so
// the user's keystrokes don't get clobbered between valid-parse
// boundaries.

interface ObservationCardProps {
  obs: Observation;
  idx: number;
}

export default function ObservationCard({ obs, idx }: ObservationCardProps) {
  const updateObservation = useTriangulateStore((s) => s.updateObservation);
  const removeObservation = useTriangulateStore((s) => s.removeObservation);

  const onLatLonChange = (field: "lat" | "lon", value: string) => {
    let parsed: number | null = field === "lat" ? obs.latDeg : obs.lonDeg;
    if (value.trim() === "") parsed = null;
    else {
      try {
        parsed = parseDmsToDecimal(value);
      } catch {
        // keep last successful parse; raw text below preserves keystrokes
      }
    }
    updateObservation(obs.id, {
      [field === "lat" ? "latDeg" : "lonDeg"]: parsed,
      [field === "lat" ? "rawLat" : "rawLon"]: value,
    } as Partial<Observation>);
  };

  const onElevChange = (value: string) => {
    if (value.trim() === "") {
      updateObservation(obs.id, { elevM: null });
    } else {
      const n = Number(value);
      updateObservation(obs.id, { elevM: Number.isFinite(n) ? n : 0 });
    }
  };

  const onModeChange = (mode: "radec" | "altaz") => {
    // Switching mode resets numeric fields but keeps the raw text so
    // the user can see what they had typed.
    const next: ObservationDirection =
      mode === "radec"
        ? { mode, raHours: null, decDeg: null }
        : { mode, azDeg: null, altDeg: null };
    updateObservation(obs.id, { dir: next, rawV1: "", rawV2: "" });
  };

  const onDirChange = (which: "v1" | "v2", value: string) => {
    const mode = obs.dir.mode;
    let parsedV1: number | null = which === "v1"
      ? (mode === "radec" ? (obs.dir as { raHours: number | null }).raHours
                          : (obs.dir as { azDeg: number | null }).azDeg)
      : null;
    let parsedV2: number | null = which === "v2"
      ? (mode === "radec" ? (obs.dir as { decDeg: number | null }).decDeg
                          : (obs.dir as { altDeg: number | null }).altDeg)
      : null;
    if (which === "v1") {
      if (value.trim() === "") parsedV1 = null;
      else {
        try {
          parsedV1 = mode === "radec" ? parseRaToHours(value) : parseDmsToDecimal(value);
        } catch { /* keep last */ }
      }
    } else {
      if (value.trim() === "") parsedV2 = null;
      else {
        try {
          parsedV2 = mode === "radec" ? parseDecToDegrees(value) : parseDmsToDecimal(value);
        } catch { /* keep last */ }
      }
    }
    // Build the next dir object, only overwriting the field the user
    // just edited; the other axis keeps its previous parsed value.
    const dir: ObservationDirection = mode === "radec"
      ? {
          mode: "radec",
          raHours: which === "v1" ? parsedV1 : (obs.dir as { raHours: number | null }).raHours,
          decDeg:  which === "v2" ? parsedV2 : (obs.dir as { decDeg: number | null }).decDeg,
        }
      : {
          mode: "altaz",
          azDeg:  which === "v1" ? parsedV1 : (obs.dir as { azDeg: number | null }).azDeg,
          altDeg: which === "v2" ? parsedV2 : (obs.dir as { altDeg: number | null }).altDeg,
        };
    updateObservation(obs.id, {
      dir,
      [which === "v1" ? "rawV1" : "rawV2"]: value,
    } as Partial<Observation>);
  };

  const v1Label = obs.dir.mode === "radec" ? "RA" : "Az";
  const v2Label = obs.dir.mode === "radec" ? "Dec" : "Alt";
  const v1Source = obs.dir.mode === "radec"
    ? (obs.dir as { raHours: number | null }).raHours
    : (obs.dir as { azDeg: number | null }).azDeg;
  const v2Source = obs.dir.mode === "radec"
    ? (obs.dir as { decDeg: number | null }).decDeg
    : (obs.dir as { altDeg: number | null }).altDeg;
  const v1Value = obs.rawV1 ?? (v1Source != null ? String(v1Source) : "");
  const v2Value = obs.rawV2 ?? (v2Source != null ? String(v2Source) : "");
  const latValue = obs.rawLat ?? (obs.latDeg != null ? String(obs.latDeg) : "");
  const lonValue = obs.rawLon ?? (obs.lonDeg != null ? String(obs.lonDeg) : "");
  const elevValue = obs.elevM == null ? "" : String(obs.elevM);

  return (
    <div className="obs-card" data-idx={String(idx)}>
      <div className="obs-card-header">
        <span className="color-swatch" style={{ background: obs.color }} />
        <input
          type="text"
          data-field="name"
          value={obs.name}
          onChange={(e) => updateObservation(obs.id, { name: e.target.value })}
        />
        <button
          type="button"
          className="remove"
          aria-label={`Remove ${obs.name || "observation"}`}
          title="Remove observation"
          onClick={() => removeObservation(obs.id)}
        >
          ✕
        </button>
      </div>

      <div className="obs-row">
        <label className="field">
          <span className="field-label">Lat</span>
          <input
            type="text"
            data-field="lat"
            value={latValue}
            onChange={(e) => onLatLonChange("lat", e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">Lon</span>
          <input
            type="text"
            data-field="lon"
            value={lonValue}
            onChange={(e) => onLatLonChange("lon", e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">Elev (m)</span>
          <input
            type="text"
            data-field="elev"
            value={elevValue}
            onChange={(e) => onElevChange(e.target.value)}
          />
        </label>
      </div>

      <div className="obs-row mode-row">
        <label className="field">
          <span className="field-label">Mode</span>
          <select
            data-field="mode"
            value={obs.dir.mode}
            onChange={(e) => onModeChange(e.target.value as "radec" | "altaz")}
          >
            <option value="radec">RA/Dec</option>
            <option value="altaz">Alt/Az</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">{v1Label}</span>
          <input
            type="text"
            data-field="v1"
            value={v1Value}
            onChange={(e) => onDirChange("v1", e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">{v2Label}</span>
          <input
            type="text"
            data-field="v2"
            value={v2Value}
            onChange={(e) => onDirChange("v2", e.target.value)}
          />
        </label>
      </div>
    </div>
  );
}
