"use client";

import { usePassFinderStore, type PassObserver } from "@/lib/pass-finder-store";
import PolarPlot from "./PolarPlot";


// One observer card. Header + buttons + the polar-plot SVG skeleton
// are all React-rendered now; the scene's painters only fill the
// dynamic groups (ISS arc, sun/moon, start/peak/end markers, ISS-dot
// position) via the SVG ref. Card-level actions go through the store
// (open polar modal) or CustomEvents (FPS toggle / remove).
export default function ObserverCard({ obs }: { obs: PassObserver }) {
  const fpsObserverId = usePassFinderStore((s) => s.fpsObserverId);
  const setPolarModalObsId = usePassFinderStore((s) => s.setPolarModalObsId);
  const isFps = fpsObserverId === obs.id;

  const stop = (ev: React.MouseEvent) => ev.stopPropagation();
  const dispatch = (name: string) => {
    window.dispatchEvent(new CustomEvent(name, { detail: { obsId: obs.id } }));
  };

  return (
    <div
      className="obs-card"
      data-obs-id={obs.id}
      title={`Open polar plot — ${obs.name}`}
      onClick={() => setPolarModalObsId(obs.id)}
    >
      <div className="obs-card-header">
        <span className="color-swatch" style={{ background: obs.color }} />
        <div className="obs-card-meta">
          <div className="obs-card-name">{obs.name}</div>
          <div className="obs-card-coords">
            {obs.latDeg.toFixed(4)}°, {obs.lonDeg.toFixed(4)}°
          </div>
        </div>
        <button
          type="button"
          className={`fps-view${isFps ? " active" : ""}`}
          title="View from here (camera at observer, looking up at ISS)"
          onClick={(ev) => { stop(ev); dispatch("passes-toggle-fps"); }}
        >
          ▲
        </button>
        <button
          type="button"
          className="remove"
          title="Remove"
          onClick={(ev) => { stop(ev); dispatch("passes-remove-observer"); }}
        >
          ✕
        </button>
      </div>
      <PolarPlot obs={obs} />
    </div>
  );
}
