"use client";

import { useTriangulateStore } from "@/lib/store";

// Per-observation "From <Name>" camera-preset buttons. Inserted into
// the #camera-controls nav between the built-in "Top down" and "Orbit"
// buttons. Each button carries data-cam="from-observer" + data-obs-idx
// so the scene's wireCameraControls event delegation routes the click
// to viewFromObserver(idx). Subscribes to observations so add/remove/
// rename keeps the buttons in sync — no imperative DOM rebuild needed.
export default function FromObserverButtons() {
  const observations = useTriangulateStore((s) => s.observations);
  return (
    <>
      {observations.map((obs, i) => {
        const label = obs.name || `Obs ${i + 1}`;
        return (
          <button
            key={obs.id}
            type="button"
            data-cam="from-observer"
            data-obs-idx={i}
            title={`View from ${label} along their direction to the triangulated point`}
          >
            From {label}
          </button>
        );
      })}
    </>
  );
}
