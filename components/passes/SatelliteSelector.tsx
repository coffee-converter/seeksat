"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CATALOG } from "@/lib/catalog.mjs";
import { usePassFinderStore } from "@/lib/pass-finder-store";

// Custom dropdown over the satellite catalog. Trigger shows the current
// satellite + a tier badge; the list is portaled to <body> and positioned
// fixed against the trigger so the left panel's `overflow: hidden` can't
// clip it (an in-flow absolute popover got cut off after ~2 rows). Premium
// entries render disabled with a lock (dormant - none are premium yet).
export default function SatelliteSelector() {
  const selectedNoradId = usePassFinderStore((s) => s.selectedNoradId);
  const setSelectedSatellite = usePassFinderStore((s) => s.setSelectedSatellite);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const current = CATALOG.find((s) => s.noradId === selectedNoradId) ?? CATALOG[0];

  // Position the portaled list just under the trigger, in viewport coords.
  const reposition = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left, width: r.width });
  };

  useEffect(() => {
    if (!open) return;
    reposition();
    // Dismiss on outside pointer-down (trigger and list are now separate
    // DOM subtrees, so check both).
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
    };
    // Keep the list glued to the trigger if the panel scrolls or the
    // window resizes (capture=true catches scroll on any ancestor).
    const onMove = () => reposition();
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open]);

  return (
    <div className="sat-selector">
      <button
        ref={triggerRef}
        type="button"
        className="sat-selector-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="sat-name">{current.name}</span>
        {current.tier === "premium" && <span className="sat-badge pro">PRO</span>}
        <span className="sat-caret" aria-hidden="true">▾</span>
      </button>
      {open && pos && createPortal(
        <ul
          ref={listRef}
          className="sat-selector-list"
          role="listbox"
          aria-label="Satellites"
          style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width }}
        >
          {CATALOG.map((s) => {
            const locked = s.tier === "premium";
            return (
              <li key={s.noradId}>
                <button
                  type="button"
                  role="option"
                  aria-selected={s.noradId === selectedNoradId}
                  className={`sat-option${s.noradId === selectedNoradId ? " active" : ""}${locked ? " locked" : ""}`}
                  disabled={locked}
                  title={locked ? "Premium satellite - upgrade to track" : undefined}
                  onClick={() => { setSelectedSatellite(s.noradId); setOpen(false); }}
                >
                  <span className="sat-name">{s.name}</span>
                  <span className="sat-incl">{s.inclinationDeg}°</span>
                  {locked && <span className="sat-badge pro">PRO</span>}
                </button>
              </li>
            );
          })}
        </ul>,
        document.body,
      )}
    </div>
  );
}
