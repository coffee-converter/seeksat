"use client";

import { useTriangulateStore } from "@/lib/store";
import ObservationCard from "./ObservationCard";

// UTC timestamp input + (invalid)/local-time hint + refraction toggle
// + observer cards + add-observation button. All state lives in the
// store; the bootstrap subscribes for recompute side effects.
export default function ObservationsPanel() {
  const observations = useTriangulateStore((s) => s.observations);
  const timestampUTC = useTriangulateStore((s) => s.timestampUTC);
  const setTimestamp = useTriangulateStore((s) => s.setTimestamp);
  const refractionEnabled = useTriangulateStore((s) => s.refractionEnabled);
  const setRefractionEnabled = useTriangulateStore(
    (s) => s.setRefractionEnabled,
  );
  const addObservation = useTriangulateStore((s) => s.addObservation);

  const d = new Date(timestampUTC);
  const localHint = Number.isNaN(d.getTime())
    ? "(invalid)"
    : "(" + d.toLocaleString() + ")";

  return (
    <>
      <div className="timestamp-row">
        <label>
          UTC{" "}
          <input
            id="ts-utc"
            type="text"
            value={timestampUTC}
            onChange={(e) => setTimestamp(e.target.value)}
          />
        </label>
        <span id="ts-local" className="hint">
          {localHint}
        </span>
      </div>
      <label className="opt-row">
        <input
          type="checkbox"
          id="opt-refraction"
          checked={refractionEnabled}
          onChange={(e) => setRefractionEnabled(e.target.checked)}
        />
        <span>Correct for atmospheric refraction</span>
        <span className="hint">(Bennett 1982)</span>
      </label>
      <div id="obs-list">
        {observations.map((obs, idx) => (
          <ObservationCard key={obs.id} obs={obs} idx={idx} />
        ))}
      </div>
      <button id="add-obs" type="button" onClick={() => addObservation()}>
        + Add observation
      </button>
    </>
  );
}
