"use client";

import { useEffect, useRef } from "react";
import { usePassFinderStore, type PassObserver } from "@/lib/pass-finder-store";

// One observer card. Header + buttons are React-rendered; the polar
// plot SVG itself is still built by the imperative scene (its DOM
// generation + per-frame ISS-arc updates aren't trivial to port — a
// follow-up iteration can move them). The card exposes a slot div
// that the scene mounts the SVG into via window.__passesMountPolar.
//
// Card-level actions (open polar modal, FPS toggle, remove) are
// dispatched as CustomEvents and handled by the scene, keeping the
// "React owns the chrome, scene owns the entities" boundary clean.
export default function ObserverCard({ obs }: { obs: PassObserver }) {
  const fpsObserverId = usePassFinderStore((s) => s.fpsObserverId);
  const polarSlotRef = useRef<HTMLDivElement>(null);
  const isFps = fpsObserverId === obs.id;

  useEffect(() => {
    const el = polarSlotRef.current;
    if (!el) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mount = (window as any).__passesMountPolar;
    if (typeof mount === "function") mount(el, obs.id);
    return () => {
      // React removes the slot div on unmount; the SVG goes with it.
      // No imperative cleanup needed.
    };
  }, [obs.id]);

  const stop = (ev: React.MouseEvent) => ev.stopPropagation();
  const dispatch = (name: string) => {
    window.dispatchEvent(new CustomEvent(name, { detail: { obsId: obs.id } }));
  };

  return (
    <div
      className="obs-card"
      data-obs-id={obs.id}
      title={`Open polar plot — ${obs.name}`}
      onClick={() => dispatch("passes-open-polar-modal")}
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
      <div ref={polarSlotRef} className="obs-polar-slot" />
    </div>
  );
}
