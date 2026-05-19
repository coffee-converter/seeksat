"use client";

import { usePassFinderStore, type PassObserver } from "@/lib/pass-finder-store";
import { removeObserver, toggleFps } from "@/lib/scene-bridge";
import PolarPlot from "./PolarPlot";


// One observer card. Header + buttons + the polar-plot SVG skeleton
// are all React-rendered now; the scene's painters only fill the
// dynamic groups (ISS arc, sun/moon, start/peak/end markers, ISS-dot
// position) via the SVG ref. Card-level actions go through the store
// (open polar modal) or the typed scene bridge (FPS toggle, remove).
export default function ObserverCard({ obs }: { obs: PassObserver }) {
  const fpsObserverId = usePassFinderStore((s) => s.fpsObserverId);
  const setPolarModalObsId = usePassFinderStore((s) => s.setPolarModalObsId);
  const isFps = fpsObserverId === obs.id;

  const stop = (ev: React.MouseEvent) => ev.stopPropagation();

  return (
    <div
      className="obs-card"
      data-obs-id={obs.id}
      title={`Open polar plot — ${obs.name}`}
      role="button"
      tabIndex={0}
      onClick={() => setPolarModalObsId(obs.id)}
      onKeyDown={(ev) => {
        // Only the card itself opens the modal — inner buttons stop
        // propagation, so this only fires on direct card activation.
        if (ev.target === ev.currentTarget && (ev.key === "Enter" || ev.key === " ")) {
          ev.preventDefault();
          setPolarModalObsId(obs.id);
        }
      }}
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
          onClick={(ev) => { stop(ev); toggleFps(obs.id); }}
        >
          ▲
        </button>
        <button
          type="button"
          className="remove"
          title="Remove"
          onClick={(ev) => { stop(ev); removeObserver(obs.id); }}
        >
          ✕
        </button>
      </div>
      <PolarPlot obs={obs} />
    </div>
  );
}
