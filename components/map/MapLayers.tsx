"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Button from "@/components/ui/Button";
import Segmented from "@/components/ui/Segmented";
import { useFocusTrap } from "@/components/ui/useFocusTrap";
import { PROJECTIONS } from "@/lib/map/view.mjs";
import type { Preset } from "@/components/home/FlatMap";

interface Props {
  view: "flat" | "globe";
  onViewChange: (id: string) => void;
  /** The globe camera views that can go somewhere now. */
  presets: Array<{ id: Preset; label: string }>;
  onPreset: (id: Preset) => void;
  /** The camera is following the focus (the satellite view shows pressed). */
  followOn: boolean;
  /** Mercator's way back to its home view. */
  onReset: () => void;
  /** The Share button for the whole view. */
  share: ReactNode;
  /** The map legend. */
  legend: ReactNode;
}

const VIEWS = PROJECTIONS.map((p: { id: string; label: string }) => ({ value: p.id, label: p.label }));

/**
 * The map's settings behind one button: the projection, where to look, Share
 * and the legend. A popover anchored under the button (its positioned parent
 * places it): Escape or a press outside closes it, Tab stays inside while it
 * is open, and focus goes back to the button on close.
 */
export default function MapLayers({ view, onViewChange, presets, onPreset, followOn, onReset, share, legend }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const mapId = useId();
  const viewId = useId();
  const seeId = useId();
  // Declared before the open effect: the trap notes the opener first.
  useFocusTrap(panelRef, open);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    // Caught on the way down and stopped there, so the page's own Esc
    // handlers (leaving full screen, clearing the focus) never see it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <div className="map-layers" ref={rootRef}>
      <Button
        ref={buttonRef}
        variant="overlay"
        iconOnly
        aria-label="Map layers"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">{"◱"}</span>
      </Button>
      <div
        ref={panelRef}
        id={panelId}
        className="map-layers__panel"
        role="dialog"
        aria-label="Map layers"
        tabIndex={-1}
        hidden={!open}
      >
        <section className="map-layers__group" aria-labelledby={mapId}>
          <h3 className="heading-group map-layers__title" id={mapId}>Map</h3>
          <Segmented label="Map projection" size="sm" options={VIEWS} value={view} onChange={onViewChange} />
        </section>
        {/* Choosing a view closes the menu, so the camera move shows. */}
        <section className="map-layers__group" aria-labelledby={viewId}>
          <h3 className="heading-group map-layers__title" id={viewId}>View</h3>
          <div className="map-layers__views">
            {view === "globe" ? presets.map((p) => (
              <Button
                key={p.id}
                size="sm"
                pressed={p.id === "sat" ? followOn : undefined}
                onClick={() => {
                  onPreset(p.id);
                  close();
                }}
              >
                {p.label}
              </Button>
            )) : (
              <Button
                size="sm"
                onClick={() => {
                  onReset();
                  close();
                }}
              >
                Reset view
              </Button>
            )}
          </div>
        </section>
        <div className="map-layers__group map-layers__share">{share}</div>
        <section className="map-layers__group" aria-labelledby={seeId}>
          <h3 className="heading-group map-layers__title" id={seeId}>What you see</h3>
          {legend}
        </section>
      </div>
    </div>
  );
}
